const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(
    `hog requires Node.js >= 22 (current: ${process.version}). Install from https://nodejs.org/`,
  );
  process.exit(1);
}

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";
import { extractIssueFields, hasLlmApiKey } from "./ai.js";
import type { CompletionAction, HogConfig, RepoConfig } from "./config.js";
import {
  clearLlmAuth,
  findRepo,
  getLlmAuth,
  loadFullConfig,
  resolveProfile,
  saveFullConfig,
  saveLlmAuth,
  validateRepoName,
} from "./config.js";
import { runInit, runReposAdd } from "./init.js";
import { getActionLog } from "./log-persistence.js";
import { errorOut, jsonOut, printSuccess, setFormat, useJson } from "./output.js";

const execFileAsync = promisify(execFile);

// -- Typed option interfaces for each command --

interface GlobalOptions {
  json?: true;
  human?: true;
}

interface InitOptions {
  force?: true;
}

// -- Helpers --

async function resolveRef(
  ref: string,
  config: HogConfig,
): Promise<Awaited<ReturnType<typeof import("./pick.js").parseIssueRef>>> {
  const { parseIssueRef } = await import("./pick.js");
  try {
    return parseIssueRef(ref, config);
  } catch (err) {
    errorOut(err instanceof Error ? err.message : String(err));
  }
}

// -- Program --

const program = new Command();

program
  .name("hog")
  .description("Personal command deck — GitHub Projects dashboard with workflow orchestration")
  .version("1.20.0") // x-release-please-version
  .option("--json", "Force JSON output")
  .option("--human", "Force human-readable output")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts<GlobalOptions>();
    if (opts.json) setFormat("json");
    if (opts.human) setFormat("human");
  });

// -- Init --

program
  .command("init")
  .description("Interactive setup wizard")
  .option("--force", "Overwrite existing config without prompt")
  .action(async (opts: InitOptions) => {
    await runInit({ force: opts.force ?? false });
  });

// -- Board command --

interface BoardOptions {
  repo?: string;
  mine?: true;
  backlog?: true;
  live?: true;
  profile?: string;
}

program
  .command("board")
  .description("Show unified task dashboard")
  .option("--repo <name>", "Filter by repo (short name or full)")
  .option("--mine", "Show only my assigned issues and tasks")
  .option("--backlog", "Show only unassigned issues")
  .option("--live", "Persistent TUI with auto-refresh and keyboard navigation")
  .option("--profile <name>", "Use a named board profile")
  .action(async (opts: BoardOptions) => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg, activeProfile } = resolveProfile(rawCfg, opts.profile);
    const jsonMode = useJson();
    const fetchOptions = {
      repoFilter: opts.repo,
      mineOnly: opts.mine ?? false,
      backlogOnly: opts.backlog ?? false,
    };

    if (opts.live) {
      const { runLiveDashboard } = await import("./board/live.js");
      await runLiveDashboard(cfg, fetchOptions, activeProfile);
      return;
    }

    const { fetchDashboard } = await import("./board/fetch.js");
    const data = await fetchDashboard(cfg, fetchOptions);

    if (jsonMode) {
      const { renderBoardJson } = await import("./board/format-static.js");
      jsonOut(renderBoardJson(data, cfg.board.assignee));
    } else {
      const { renderStaticBoard } = await import("./board/format-static.js");
      renderStaticBoard(data, cfg.board.assignee, opts.backlog ?? false);
    }
  });

// -- Pick command --

program
  .command("pick <issueRef>")
  .description("Pick up an issue: assign to self on GitHub (e.g., hog pick myrepo/145)")
  .action(async (issueRef: string) => {
    const cfg = loadFullConfig();
    const { parseIssueRef, pickIssue } = await import("./pick.js");
    const ref = parseIssueRef(issueRef, cfg);
    const result = await pickIssue(cfg, ref);

    if (useJson()) {
      jsonOut({
        ok: result.success,
        data: {
          issue: result.issue,
          warning: result.warning ?? null,
        },
      });
    } else {
      console.log(`Picked ${ref.repo.shortName}#${ref.issueNumber}: ${result.issue.title}`);
      console.log(`  GitHub: assigned to @me`);
      if (result.warning) {
        console.log(`  Warning: ${result.warning}`);
      }
    }
  });

// -- Launch command --

interface LaunchOptions {
  dryRun?: true;
}

program
  .command("launch <issueRef>")
  .description("Launch Claude Code for an issue in its local repo directory")
  .option("--dry-run", "Print resolved config without spawning")
  .action(async (issueRef: string, opts: LaunchOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const rc = ref.repo;

    if (!rc.localPath) {
      errorOut(
        `Set localPath for ${rc.shortName} in ~/.config/hog/config.json to enable Claude Code launch`,
        { repo: rc.shortName },
      );
    }

    const startCommand = rc.claudeStartCommand ?? cfg.board.claudeStartCommand;
    const launchMode = cfg.board.claudeLaunchMode ?? "auto";
    const terminalApp = cfg.board.claudeTerminalApp;

    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({
          ok: true,
          dryRun: true,
          would: {
            localPath: rc.localPath,
            command: startCommand?.command ?? "claude",
            extraArgs: startCommand?.extraArgs ?? [],
            launchMode,
            terminalApp: terminalApp ?? null,
            issueNumber: ref.issueNumber,
            repo: rc.shortName,
          },
        });
      } else {
        console.log(`[dry-run] Would launch Claude Code for ${rc.shortName}#${ref.issueNumber}`);
        console.log(`  localPath:  ${rc.localPath}`);
        console.log(`  command:    ${startCommand?.command ?? "claude"}`);
        console.log(`  launchMode: ${launchMode}`);
        if (terminalApp) console.log(`  terminalApp: ${terminalApp}`);
      }
      return;
    }

    const { launchClaude } = await import("./board/launch-claude.js");
    const { fetchIssueAsync } = await import("./github.js");

    const issue = await fetchIssueAsync(rc.name, ref.issueNumber);

    const result = launchClaude({
      localPath: rc.localPath,
      issue: { number: issue.number, title: issue.title, url: issue.url },
      ...(startCommand ? { startCommand } : {}),
      launchMode,
      ...(terminalApp ? { terminalApp } : {}),
      repoFullName: rc.name,
    });

    if (!result.ok) {
      errorOut(result.error.message, { kind: result.error.kind });
    }

    if (useJson()) {
      jsonOut({ ok: true, data: { repo: rc.shortName, issue: ref.issueNumber } });
    } else {
      console.log(`Claude Code session opened in ${rc.shortName}#${ref.issueNumber}`);
    }
  });

// -- Config commands --

interface ConfigAddRepoOptions {
  projectNumber?: string;
  statusFieldId?: string;
  completionType?: string;
  completionOptionId?: string;
  completionLabel?: string;
}

const config = program.command("config").description("Manage hog configuration");

config
  .command("show")
  .description("Show full configuration")
  .action(() => {
    const cfg = loadFullConfig();
    if (useJson()) {
      jsonOut({ ok: true, data: cfg });
    } else {
      console.log("Version:", cfg.version);
      console.log("Assignee:", cfg.board.assignee);
      console.log("Refresh interval:", `${cfg.board.refreshInterval}s`);
      console.log("Backlog limit:", cfg.board.backlogLimit);
      console.log("\nRepos:");
      for (const repo of cfg.repos) {
        console.log(`  ${repo.shortName} → ${repo.name} (project #${repo.projectNumber})`);
        console.log(`    completion: ${repo.completionAction.type}`);
      }
    }
  });

config
  .command("repos")
  .description("List configured repositories")
  .action(() => {
    const cfg = loadFullConfig();
    if (useJson()) {
      jsonOut({ ok: true, data: cfg.repos });
    } else {
      if (cfg.repos.length === 0) {
        console.log("No repos configured. Run: hog config repos add <owner/repo>");
        return;
      }
      for (const repo of cfg.repos) {
        console.log(`  ${repo.shortName.padEnd(15)} ${repo.name}`);
      }
    }
  });

config
  .command("repos:add [name]")
  .description("Add a repository to track (interactive wizard, or pass flags for scripted use)")
  .option("--project-number <n>", "GitHub project number (skips interactive prompt)")
  .option("--status-field-id <id>", "Project status field ID (skips interactive prompt)")
  .option(
    "--completion-type <type>",
    "Completion action: addLabel, updateProjectStatus, closeIssue",
  )
  .option("--completion-option-id <id>", "Option ID for updateProjectStatus")
  .option("--completion-label <label>", "Label for addLabel")
  .action(async (name: string | undefined, opts: ConfigAddRepoOptions) => {
    // Interactive mode: no project-number or status-field-id provided
    if (!(opts.projectNumber && opts.statusFieldId)) {
      await runReposAdd(name);
      return;
    }

    // Non-interactive (scripted) mode: all required flags provided
    if (!name) {
      errorOut("Name argument required in non-interactive mode.");
    }
    if (!validateRepoName(name)) {
      errorOut("Invalid repo name. Use owner/repo format (e.g., myorg/myrepo)");
    }

    const cfg = loadFullConfig();
    if (findRepo(cfg, name)) {
      errorOut(`Repo "${name}" is already configured.`);
    }

    const shortName = name.split("/")[1] ?? name;

    if (!opts.completionType) {
      errorOut("--completion-type required in non-interactive mode");
    }

    let completionAction: CompletionAction;
    switch (opts.completionType) {
      case "addLabel":
        if (!opts.completionLabel) {
          errorOut("--completion-label required for addLabel type");
        }
        completionAction = { type: "addLabel", label: opts.completionLabel };
        break;
      case "updateProjectStatus":
        if (!opts.completionOptionId) {
          errorOut("--completion-option-id required for updateProjectStatus type");
        }
        completionAction = { type: "updateProjectStatus", optionId: opts.completionOptionId };
        break;
      case "closeIssue":
        completionAction = { type: "closeIssue" };
        break;
      default:
        errorOut(
          `Unknown completion type: ${opts.completionType}. Use: addLabel, updateProjectStatus, closeIssue`,
        );
    }

    const newRepo: RepoConfig = {
      name,
      shortName,
      projectNumber: Number.parseInt(opts.projectNumber, 10),
      statusFieldId: opts.statusFieldId,
      completionAction,
    };

    cfg.repos.push(newRepo);
    saveFullConfig(cfg);

    if (useJson()) {
      jsonOut({ ok: true, message: `Added ${name}`, data: newRepo });
    } else {
      console.log(`Added ${shortName} → ${name}`);
    }
  });

config
  .command("repos:rm <name>")
  .description("Remove a repository from tracking")
  .action((name: string) => {
    const cfg = loadFullConfig();
    const idx = cfg.repos.findIndex((r) => r.shortName === name || r.name === name);
    if (idx === -1) {
      errorOut(`Repo "${name}" not found. Run: hog config repos`);
    }
    const [removed] = cfg.repos.splice(idx, 1);
    if (!removed) {
      errorOut(`Repo "${name}" not found.`);
    }
    saveFullConfig(cfg);

    if (useJson()) {
      jsonOut({ ok: true, message: `Removed ${removed.name}`, data: removed });
    } else {
      console.log(`Removed ${removed.shortName} → ${removed.name}`);
    }
  });

config
  .command("ai:set-key <key>")
  .description("Store an OpenRouter API key for AI-enhanced issue creation (I key on board)")
  .action((key: string) => {
    if (!key.startsWith("sk-or-")) {
      errorOut('key must start with "sk-or-". Get one at https://openrouter.ai/keys');
    }
    saveLlmAuth(key);
    if (useJson()) {
      jsonOut({ ok: true, message: "OpenRouter key saved" });
    } else {
      printSuccess("OpenRouter key saved to ~/.config/hog/auth.json");
      console.log("  Press I on the board to create issues with natural language.");
    }
  });

config
  .command("ai:clear-key")
  .description("Remove the stored OpenRouter API key")
  .action(() => {
    const existing = getLlmAuth();
    if (!existing) {
      if (useJson()) {
        jsonOut({ ok: true, message: "No key was stored" });
      } else {
        console.log("No OpenRouter key stored.");
      }
      return;
    }
    clearLlmAuth();
    if (useJson()) {
      jsonOut({ ok: true, message: "OpenRouter key removed" });
    } else {
      printSuccess("OpenRouter key removed from ~/.config/hog/auth.json");
    }
  });

config
  .command("ai:status")
  .description("Show whether AI-enhanced issue creation is available and which source provides it")
  .action(() => {
    const envOr = process.env["OPENROUTER_API_KEY"];
    const envAnt = process.env["ANTHROPIC_API_KEY"];
    const stored = getLlmAuth();

    if (useJson()) {
      jsonOut({
        ok: true,
        data: {
          active: !!(envOr ?? envAnt ?? stored),
          source: envOr
            ? "env:OPENROUTER_API_KEY"
            : envAnt
              ? "env:ANTHROPIC_API_KEY"
              : stored
                ? "config:auth.json"
                : null,
          provider: envOr ? "openrouter" : envAnt ? "anthropic" : stored ? "openrouter" : null,
        },
      });
    } else if (envOr) {
      console.log("AI: active (source: OPENROUTER_API_KEY env var, provider: openrouter)");
    } else if (envAnt) {
      console.log("AI: active (source: ANTHROPIC_API_KEY env var, provider: anthropic)");
    } else if (stored) {
      console.log("AI: active (source: ~/.config/hog/auth.json, provider: openrouter)");
    } else {
      console.log("AI: off — heuristic-only mode");
      console.log("  Enable with: hog config ai:set-key <sk-or-...>");
      console.log("  Or set env:  export OPENROUTER_API_KEY=sk-or-...");
    }
  });

config
  .command("profile:create <name>")
  .description("Create a board profile (copies current top-level config)")
  .action((name: string) => {
    const cfg = loadFullConfig();
    if (cfg.profiles[name]) {
      errorOut(`Profile "${name}" already exists.`);
    }

    cfg.profiles[name] = {
      repos: [...cfg.repos],
      board: { ...cfg.board },
    };
    saveFullConfig(cfg);

    if (useJson()) {
      jsonOut({ ok: true, message: `Created profile "${name}"`, data: cfg.profiles[name] });
    } else {
      printSuccess(`Created profile "${name}" (copied from current config).`);
    }
  });

config
  .command("profile:delete <name>")
  .description("Delete a board profile")
  .action((name: string) => {
    const cfg = loadFullConfig();
    if (!cfg.profiles[name]) {
      errorOut(
        `Profile "${name}" not found. Available: ${Object.keys(cfg.profiles).join(", ") || "(none)"}`,
      );
    }

    delete cfg.profiles[name];

    // Clear defaultProfile if it was the deleted one
    if (cfg.defaultProfile === name) {
      cfg.defaultProfile = undefined;
    }

    saveFullConfig(cfg);

    if (useJson()) {
      jsonOut({ ok: true, message: `Deleted profile "${name}"` });
    } else {
      printSuccess(`Deleted profile "${name}".`);
    }
  });

config
  .command("profile:default [name]")
  .description("Set or show the default board profile")
  .action((name?: string) => {
    const cfg = loadFullConfig();

    if (!name) {
      // Show current default
      if (useJson()) {
        jsonOut({
          ok: true,
          data: { defaultProfile: cfg.defaultProfile ?? null, profiles: Object.keys(cfg.profiles) },
        });
      } else {
        console.log("Default profile:", cfg.defaultProfile ?? "(none)");
        const names = Object.keys(cfg.profiles);
        if (names.length > 0) {
          console.log("Available profiles:", names.join(", "));
        } else {
          console.log("No profiles configured. Run: hog config profile:create <name>");
        }
      }
      return;
    }

    if (!cfg.profiles[name]) {
      errorOut(
        `Profile "${name}" not found. Available: ${Object.keys(cfg.profiles).join(", ") || "(none)"}`,
      );
    }

    cfg.defaultProfile = name;
    saveFullConfig(cfg);

    if (useJson()) {
      jsonOut({ ok: true, message: `Default profile set to "${name}"` });
    } else {
      printSuccess(`Default profile set to "${name}".`);
    }
  });

// -- Issue commands --

interface IssueCreateOptions {
  repo?: string;
  dryRun?: true;
}

interface IssueMoveOptions {
  dryRun?: true;
}

interface IssueAssignOptions {
  user?: string;
  dryRun?: true;
}

interface IssueUnassignOptions {
  user?: string;
  dryRun?: true;
}

interface IssueCommentOptions {
  dryRun?: true;
}

interface IssueEditOptions {
  title?: string;
  body?: string;
  label?: string[];
  removeLabel?: string[];
  assignee?: string;
  removeAssignee?: string;
  dryRun?: true;
}

interface IssueLabelOptions {
  remove?: boolean;
  dryRun?: true;
}

const issueCommand = new Command("issue").description("GitHub issue utilities");

issueCommand
  .command("create <text>")
  .description("Create a GitHub issue from natural language text")
  .option("--repo <repo>", "Target repository (owner/name)")
  .option("--dry-run", "Print parsed fields without creating the issue")
  .action(async (text: string, opts: IssueCreateOptions) => {
    const config = loadFullConfig();
    const repo = opts.repo ?? config.repos[0]?.name;
    if (!repo) {
      errorOut("No repo specified. Use --repo owner/name or configure repos in hog init.");
    }

    const json = useJson();

    if (!json && hasLlmApiKey()) {
      console.error("[info] LLM parsing enabled");
    }

    const parsed = await extractIssueFields(text, {
      onLlmFallback: json ? undefined : (msg) => console.error(`[warn] ${msg}`),
    });

    if (!parsed) {
      errorOut("Could not parse a title from input. Ensure your text has a non-empty title.");
    }

    const labels = [...parsed.labels];
    if (parsed.dueDate) labels.push(`due:${parsed.dueDate}`);

    // Show parsed fields (only in human mode)
    if (!json) {
      console.error(`Title:    ${parsed.title}`);
      if (labels.length > 0) console.error(`Labels:   ${labels.join(", ")}`);
      if (parsed.assignee) console.error(`Assignee: @${parsed.assignee}`);
      if (parsed.dueDate) console.error(`Due:      ${parsed.dueDate}`);
      console.error(`Repo:     ${repo}`);
    }

    if (opts.dryRun) {
      if (json) {
        jsonOut({
          ok: true,
          dryRun: true,
          parsed: {
            title: parsed.title,
            labels,
            assignee: parsed.assignee,
            dueDate: parsed.dueDate,
            repo,
          },
        });
      } else {
        console.error("[dry-run] Skipping issue creation.");
      }
      return;
    }

    const ghArgs = ["issue", "create", "--repo", repo, "--title", parsed.title, "--body", ""];
    for (const label of labels) {
      ghArgs.push("--label", label);
    }

    try {
      if (json) {
        const output = await execFileAsync("gh", ghArgs, { encoding: "utf-8", timeout: 60_000 });
        const url = output.stdout.trim();
        const issueNumber = Number.parseInt(url.split("/").pop() ?? "0", 10);
        jsonOut({ ok: true, data: { url, issueNumber, repo } });
      } else {
        execFileSync("gh", ghArgs, { stdio: "inherit" });
      }
    } catch (err) {
      errorOut(`gh issue create failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

issueCommand
  .command("show <issueRef>")
  .description("Show issue details (format: shortname/number, e.g. myrepo/42)")
  .action(async (issueRef: string) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const { fetchIssueAsync } = await import("./github.js");
    const issue = await fetchIssueAsync(ref.repo.name, ref.issueNumber);
    if (useJson()) {
      jsonOut({ ok: true, data: issue });
    } else {
      console.log(`#${issue.number} ${issue.title}`);
      if (issue.projectStatus) console.log(`  Status:   ${issue.projectStatus}`);
      const labels = issue.labels.map((l) => l.name).join(", ");
      if (labels) console.log(`  Labels:   ${labels}`);
      const assignees = (issue.assignees ?? []).map((a) => `@${a.login}`).join(", ");
      if (assignees) console.log(`  Assignee: ${assignees}`);
      console.log(`  URL:      ${issue.url}`);
      if (issue.body) {
        console.log();
        console.log(issue.body);
      }
    }
  });

issueCommand
  .command("close <issueRef>")
  .description("Close a GitHub issue")
  .action(async (issueRef: string) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const { closeIssueAsync } = await import("./github.js");
    await closeIssueAsync(ref.repo.name, ref.issueNumber);
    printSuccess(`Closed ${ref.repo.shortName}#${ref.issueNumber}`, {
      repo: ref.repo.name,
      issueNumber: ref.issueNumber,
    });
  });

issueCommand
  .command("reopen <issueRef>")
  .description("Reopen a closed GitHub issue")
  .action(async (issueRef: string) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const { reopenIssueAsync } = await import("./github.js");
    await reopenIssueAsync(ref.repo.name, ref.issueNumber);
    printSuccess(`Reopened ${ref.repo.shortName}#${ref.issueNumber}`, {
      repo: ref.repo.name,
      issueNumber: ref.issueNumber,
    });
  });

issueCommand
  .command("move <issueRef> <status>")
  .description("Change project status (e.g. hog issue move myrepo/42 'In Review')")
  .option("--dry-run", "Print what would change without mutating")
  .action(async (issueRef: string, status: string, opts: IssueMoveOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const rc = ref.repo;
    if (!(rc.statusFieldId && rc.projectNumber)) {
      errorOut(`${rc.name} is not configured with a project board. Run: hog init`, {
        repo: rc.name,
      });
    }
    const { fetchProjectStatusOptions, updateProjectItemStatusAsync } = await import("./github.js");
    const options = fetchProjectStatusOptions(rc.name, rc.projectNumber, rc.statusFieldId);
    const target = options.find((o) => o.name.toLowerCase() === status.toLowerCase());
    if (!target) {
      const valid = options.map((o) => o.name).join(", ");
      errorOut(`Invalid status "${status}". Valid: ${valid}`, { status, validStatuses: valid });
    }
    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({
          ok: true,
          dryRun: true,
          would: {
            action: "move",
            issue: ref.issueNumber,
            repo: rc.shortName,
            status: target.name,
          },
        });
      } else {
        console.log(`[dry-run] Would move ${rc.shortName}#${ref.issueNumber} → "${target.name}"`);
      }
      return;
    }
    await updateProjectItemStatusAsync(rc.name, ref.issueNumber, {
      projectNumber: rc.projectNumber,
      statusFieldId: rc.statusFieldId,
      optionId: target.id,
    });
    if (useJson()) {
      jsonOut({ ok: true, data: { issue: ref.issueNumber, status: target.name } });
    } else {
      console.log(`Moved ${rc.shortName}#${ref.issueNumber} → ${target.name}`);
    }
  });

issueCommand
  .command("assign <issueRef>")
  .description("Assign issue to self or a specific user")
  .option("--user <username>", "GitHub username to assign (default: configured assignee)")
  .option("--dry-run", "Print what would change without mutating")
  .action(async (issueRef: string, opts: IssueAssignOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const user = opts.user ?? cfg.board.assignee;
    if (!user) {
      console.error("Error: no user specified. Use --user or configure board.assignee in hog init");
      process.exit(1);
    }
    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({
          ok: true,
          dryRun: true,
          would: { action: "assign", issue: ref.issueNumber, repo: ref.repo.shortName, user },
        });
      } else {
        console.log(`[dry-run] Would assign ${ref.repo.shortName}#${ref.issueNumber} to @${user}`);
      }
      return;
    }
    const { assignIssueToAsync } = await import("./github.js");
    await assignIssueToAsync(ref.repo.name, ref.issueNumber, user);
    if (useJson()) {
      jsonOut({ ok: true, data: { issue: ref.issueNumber, assignee: user } });
    } else {
      console.log(`Assigned ${ref.repo.shortName}#${ref.issueNumber} to @${user}`);
    }
  });

issueCommand
  .command("unassign <issueRef>")
  .description("Remove assignee from issue")
  .option("--user <username>", "GitHub username to remove (default: configured assignee)")
  .option("--dry-run", "Print what would change without mutating")
  .action(async (issueRef: string, opts: IssueUnassignOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const user = opts.user ?? cfg.board.assignee;
    if (!user) {
      console.error("Error: no user specified. Use --user or configure board.assignee in hog init");
      process.exit(1);
    }
    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({
          ok: true,
          dryRun: true,
          would: { action: "unassign", issue: ref.issueNumber, repo: ref.repo.shortName, user },
        });
      } else {
        console.log(
          `[dry-run] Would remove @${user} from ${ref.repo.shortName}#${ref.issueNumber}`,
        );
      }
      return;
    }
    const { unassignIssueAsync } = await import("./github.js");
    await unassignIssueAsync(ref.repo.name, ref.issueNumber, user);
    if (useJson()) {
      jsonOut({ ok: true, data: { issue: ref.issueNumber, removedAssignee: user } });
    } else {
      console.log(`Removed @${user} from ${ref.repo.shortName}#${ref.issueNumber}`);
    }
  });

issueCommand
  .command("comment <issueRef> <text>")
  .description("Post a comment on an issue")
  .option("--dry-run", "Print what would be posted without mutating")
  .action(async (issueRef: string, text: string, opts: IssueCommentOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({
          ok: true,
          dryRun: true,
          would: { action: "comment", issue: ref.issueNumber, repo: ref.repo.shortName, text },
        });
      } else {
        console.log(
          `[dry-run] Would comment on ${ref.repo.shortName}#${ref.issueNumber}: "${text}"`,
        );
      }
      return;
    }
    const { addCommentAsync } = await import("./github.js");
    await addCommentAsync(ref.repo.name, ref.issueNumber, text);
    if (useJson()) {
      jsonOut({ ok: true, data: { issue: ref.issueNumber, comment: text } });
    } else {
      console.log(`Commented on ${ref.repo.shortName}#${ref.issueNumber}`);
    }
  });

issueCommand
  .command("edit <issueRef>")
  .description("Edit issue fields (title, body, labels, assignees)")
  .option("--title <title>", "New title")
  .option("--body <body>", "New body")
  .option(
    "--label <label>",
    "Add label (repeatable)",
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option(
    "--remove-label <label>",
    "Remove label (repeatable)",
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option("--assignee <user>", "Add assignee")
  .option("--remove-assignee <user>", "Remove assignee")
  .option("--dry-run", "Print what would change without mutating")
  .action(async (issueRef: string, opts: IssueEditOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);

    const changes: string[] = [];
    if (opts.title) changes.push(`title → "${opts.title}"`);
    if (opts.body !== undefined) changes.push("body updated");
    if (opts.label?.length) changes.push(`add labels: ${opts.label.join(", ")}`);
    if (opts.removeLabel?.length) changes.push(`remove labels: ${opts.removeLabel.join(", ")}`);
    if (opts.assignee) changes.push(`add assignee: @${opts.assignee}`);
    if (opts.removeAssignee) changes.push(`remove assignee: @${opts.removeAssignee}`);

    if (changes.length === 0) {
      console.error("Error: no changes specified. Use --title, --body, --label, etc.");
      process.exit(1);
    }

    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({
          ok: true,
          dryRun: true,
          would: { action: "edit", issue: ref.issueNumber, repo: ref.repo.shortName, changes },
        });
      } else {
        console.log(
          `[dry-run] Would edit ${ref.repo.shortName}#${ref.issueNumber}: ${changes.join("; ")}`,
        );
      }
      return;
    }

    const ghArgs = ["issue", "edit", String(ref.issueNumber), "--repo", ref.repo.name];
    if (opts.title) ghArgs.push("--title", opts.title);
    if (opts.body !== undefined) ghArgs.push("--body", opts.body);
    for (const l of opts.label ?? []) ghArgs.push("--add-label", l);
    for (const l of opts.removeLabel ?? []) ghArgs.push("--remove-label", l);
    if (opts.assignee) ghArgs.push("--add-assignee", opts.assignee);
    if (opts.removeAssignee) ghArgs.push("--remove-assignee", opts.removeAssignee);

    if (useJson()) {
      await execFileAsync("gh", ghArgs, { encoding: "utf-8", timeout: 30_000 });
      jsonOut({ ok: true, data: { issue: ref.issueNumber, changes } });
    } else {
      execFileSync("gh", ghArgs, { stdio: "inherit" });
      console.log(`Updated ${ref.repo.shortName}#${ref.issueNumber}: ${changes.join("; ")}`);
    }
  });

issueCommand
  .command("label <issueRef> <label>")
  .description("Add or remove a label on an issue")
  .option("--remove", "Remove the label instead of adding it")
  .option("--dry-run", "Print what would change without mutating")
  .action(async (issueRef: string, label: string, opts: IssueLabelOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const verb = opts.remove ? "remove" : "add";
    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({
          ok: true,
          dryRun: true,
          would: {
            action: `${verb}Label`,
            issue: ref.issueNumber,
            repo: ref.repo.shortName,
            label,
          },
        });
      } else {
        console.log(
          `[dry-run] Would ${verb} label "${label}" on ${ref.repo.shortName}#${ref.issueNumber}`,
        );
      }
      return;
    }
    if (opts.remove) {
      const { removeLabelAsync } = await import("./github.js");
      await removeLabelAsync(ref.repo.name, ref.issueNumber, label);
    } else {
      const { addLabelAsync } = await import("./github.js");
      await addLabelAsync(ref.repo.name, ref.issueNumber, label);
    }
    if (useJson()) {
      jsonOut({ ok: true, data: { issue: ref.issueNumber, label, action: verb } });
    } else {
      console.log(
        `${opts.remove ? "Removed" : "Added"} label "${label}" on ${ref.repo.shortName}#${ref.issueNumber}`,
      );
    }
  });

issueCommand
  .command("statuses")
  .description("List available project statuses for a repo")
  .argument("<repo>", "repo short name (e.g. myrepo)")
  .action(async (repo: string) => {
    const config = loadFullConfig();
    const repoConfig = config.repos.find((r) => r.shortName === repo || r.name === repo);
    if (!repoConfig) {
      errorOut(`Repo "${repo}" is not configured`, { repo });
    }
    const { fetchProjectStatusOptions } = await import("./github.js");
    const statuses = fetchProjectStatusOptions(
      repoConfig.name,
      repoConfig.projectNumber,
      repoConfig.statusFieldId,
    );
    if (useJson()) {
      jsonOut({ ok: true, data: { repo, statuses: statuses.map((s) => s.name) } });
    } else {
      console.log(`Available statuses for ${repo}: ${statuses.map((s) => s.name).join(", ")}`);
    }
  });

// -- Bulk issue commands --

type BulkResult = { ref: string; success: true } | { ref: string; success: false; error: string };

async function moveSingleIssue(r: string, status: string, cfg: HogConfig): Promise<BulkResult> {
  try {
    const ref = await resolveRef(r, cfg);
    const rc = ref.repo;
    if (!(rc.statusFieldId && rc.projectNumber)) {
      throw new Error(`${rc.name} is not configured with a project board. Run: hog init`);
    }
    const { fetchProjectStatusOptions, updateProjectItemStatusAsync } = await import("./github.js");
    const options = fetchProjectStatusOptions(rc.name, rc.projectNumber, rc.statusFieldId);
    const target = options.find((o) => o.name.toLowerCase() === status.toLowerCase());
    if (!target) {
      const valid = options.map((o) => o.name).join(", ");
      throw new Error(`Invalid status "${status}". Valid: ${valid}`);
    }
    await updateProjectItemStatusAsync(rc.name, ref.issueNumber, {
      projectNumber: rc.projectNumber,
      statusFieldId: rc.statusFieldId,
      optionId: target.id,
    });
    return { ref: r, success: true };
  } catch (err) {
    return { ref: r, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function outputBulkResults(results: BulkResult[]): void {
  const allOk = results.every((r) => r.success);
  if (useJson()) {
    jsonOut({ ok: allOk, results });
  } else {
    for (const r of results) {
      if (!r.success) {
        console.error(
          `Failed ${r.ref}: ${(r as { ref: string; success: false; error: string }).error}`,
        );
      }
    }
  }
}

interface IssueBulkAssignOptions {
  user?: string;
  dryRun?: true;
}

interface IssueBulkUnassignOptions {
  user?: string;
  dryRun?: true;
}

interface IssueBulkMoveOptions {
  dryRun?: true;
}

issueCommand
  .command("bulk-assign <refs...>")
  .description(
    "Assign multiple issues to self or a specific user (e.g., hog issue bulk-assign myrepo/42 myrepo/43)",
  )
  .option("--user <username>", "GitHub username to assign (default: configured assignee)")
  .option("--dry-run", "Print what would change without mutating")
  .action(async (refs: string[], opts: IssueBulkAssignOptions) => {
    const cfg = loadFullConfig();
    const user = opts.user ?? cfg.board.assignee;
    if (!user) {
      errorOut("no user specified. Use --user or configure board.assignee in hog init");
    }

    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({ ok: true, dryRun: true, would: { action: "bulk-assign", refs, user } });
      } else {
        for (const r of refs) {
          console.log(`[dry-run] Would assign ${r} to @${user}`);
        }
      }
      return;
    }

    const { assignIssueToAsync } = await import("./github.js");
    const results: BulkResult[] = [];
    for (const r of refs) {
      try {
        const ref = await resolveRef(r, cfg);
        await assignIssueToAsync(ref.repo.name, ref.issueNumber, user);
        results.push({ ref: r, success: true });
        if (!useJson()) console.log(`Assigned ${r} to @${user}`);
      } catch (err) {
        results.push({
          ref: r,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    outputBulkResults(results);
  });

issueCommand
  .command("bulk-unassign <refs...>")
  .description(
    "Remove assignee from multiple issues (e.g., hog issue bulk-unassign myrepo/42 myrepo/43)",
  )
  .option("--user <username>", "GitHub username to remove (default: configured assignee)")
  .option("--dry-run", "Print what would change without mutating")
  .action(async (refs: string[], opts: IssueBulkUnassignOptions) => {
    const cfg = loadFullConfig();
    const user = opts.user ?? cfg.board.assignee;
    if (!user) {
      errorOut("no user specified. Use --user or configure board.assignee in hog init");
    }

    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({ ok: true, dryRun: true, would: { action: "bulk-unassign", refs, user } });
      } else {
        for (const r of refs) {
          console.log(`[dry-run] Would remove @${user} from ${r}`);
        }
      }
      return;
    }

    const { unassignIssueAsync } = await import("./github.js");
    const results: BulkResult[] = [];
    for (const r of refs) {
      try {
        const ref = await resolveRef(r, cfg);
        await unassignIssueAsync(ref.repo.name, ref.issueNumber, user);
        results.push({ ref: r, success: true });
        if (!useJson()) console.log(`Removed @${user} from ${r}`);
      } catch (err) {
        results.push({
          ref: r,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    outputBulkResults(results);
  });

issueCommand
  .command("bulk-move <status> <refs...>")
  .description(
    "Move multiple issues to a project status (e.g., hog issue bulk-move 'In Review' myrepo/42 myrepo/43)",
  )
  .option("--dry-run", "Print what would change without mutating")
  .action(async (status: string, refs: string[], opts: IssueBulkMoveOptions) => {
    const cfg = loadFullConfig();

    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({ ok: true, dryRun: true, would: { action: "bulk-move", refs, status } });
      } else {
        for (const r of refs) {
          console.log(`[dry-run] Would move ${r} → "${status}"`);
        }
      }
      return;
    }

    const results: BulkResult[] = await Promise.all(
      refs.map((r) => moveSingleIssue(r, status, cfg)),
    );
    if (!useJson()) {
      for (const r of results) {
        if (r.success) console.log(`Moved ${r.ref} → ${status}`);
      }
    }
    outputBulkResults(results);
  });

program.addCommand(issueCommand);

// -- Log commands --

interface LogShowOptions {
  limit: string;
}

const logCommand = program.command("log").description("Action log commands");

logCommand
  .command("show")
  .description("Show recent action log entries")
  .option("--limit <n>", "number of entries to show", "50")
  .action((opts: LogShowOptions) => {
    const limit = Number.parseInt(opts.limit, 10) || 50;
    const entries = getActionLog(limit);
    if (useJson()) {
      jsonOut({ ok: true, data: { entries, count: entries.length } });
    } else {
      if (entries.length === 0) {
        console.log("No action log entries.");
        return;
      }
      for (const e of entries) {
        const prefix = e.status === "success" ? "✓" : e.status === "error" ? "✗" : "…";
        const ts = new Date(e.timestamp).toLocaleString();
        console.log(`${prefix} [${ts}] ${e.description}`);
      }
    }
  });

// -- Workflow commands --

const workflowCommand = program.command("workflow").description("Workflow orchestration commands");

workflowCommand
  .command("status [issueRef]")
  .description("Show workflow session history for an issue or all tracked issues")
  .action(async (issueRef?: string) => {
    const { loadEnrichment, findSessions } = await import("./enrichment.js");
    const enrichment = loadEnrichment();

    if (issueRef) {
      const cfg = loadFullConfig();
      const ref = await resolveRef(issueRef, cfg);
      const sessions = findSessions(enrichment, ref.repo.name, ref.issueNumber);

      if (useJson()) {
        jsonOut({
          ok: true,
          data: {
            repo: ref.repo.name,
            issueNumber: ref.issueNumber,
            sessions,
          },
        });
      } else {
        if (sessions.length === 0) {
          console.log(`No workflow sessions for ${ref.repo.shortName}#${ref.issueNumber}`);
          return;
        }
        console.log(`Workflow sessions for ${ref.repo.shortName}#${ref.issueNumber}:\n`);
        for (const s of sessions) {
          const status = s.exitedAt ? `exited (code ${s.exitCode ?? "?"})` : "active";
          const started = new Date(s.startedAt).toLocaleString();
          console.log(`  ${s.phase} [${s.mode}] — ${status}`);
          console.log(`    started: ${started}`);
          if (s.exitedAt) console.log(`    exited:  ${new Date(s.exitedAt).toLocaleString()}`);
          if (s.claudeSessionId) console.log(`    session: ${s.claudeSessionId}`);
          console.log();
        }
      }
    } else {
      // Show all sessions grouped by issue
      if (useJson()) {
        jsonOut({ ok: true, data: { sessions: enrichment.sessions } });
      } else {
        if (enrichment.sessions.length === 0) {
          console.log("No workflow sessions recorded.");
          return;
        }

        const grouped = new Map<string, typeof enrichment.sessions>();
        for (const s of enrichment.sessions) {
          const key = `${s.repo}#${s.issueNumber}`;
          const list = grouped.get(key) ?? [];
          list.push(s);
          grouped.set(key, list);
        }

        for (const [key, sessions] of grouped) {
          console.log(`${key}:`);
          for (const s of sessions) {
            const status = s.exitedAt ? `exited (code ${s.exitCode ?? "?"})` : "active";
            console.log(
              `  ${s.phase} [${s.mode}] — ${status} — ${new Date(s.startedAt).toLocaleString()}`,
            );
          }
          console.log();
        }
      }
    }
  });

workflowCommand
  .command("triage")
  .description("List stale issues and optionally launch background agents")
  .option("-r, --repo <name>", "Filter to a specific repo")
  .option("-p, --phase <phase>", "Phase to run (research, plan, review)", "research")
  .option("-l, --launch", "Launch background agents for all stale issues")
  .action(async (opts: { repo?: string; phase?: string; launch?: boolean }) => {
    const cfg = loadFullConfig();
    const { loadEnrichment, isSnoozed } = await import("./enrichment.js");
    const { fetchDashboard } = await import("./board/fetch.js");

    const data = await fetchDashboard(cfg, {});
    const enrichment = loadEnrichment();
    const warningDays = cfg.board.workflow?.staleness?.warningDays ?? 7;

    type StaleIssue = {
      repo: string;
      number: number;
      title: string;
      url: string;
      ageDays: number;
    };

    const staleIssues: StaleIssue[] = [];
    for (const rd of data.repos) {
      if (opts.repo && rd.repo.name !== opts.repo && rd.repo.shortName !== opts.repo) continue;
      for (const issue of rd.issues) {
        if (isSnoozed(enrichment, rd.repo.name, issue.number)) continue;
        const ageDays = Math.floor((Date.now() - new Date(issue.updatedAt).getTime()) / 86_400_000);
        if (ageDays >= warningDays) {
          staleIssues.push({
            repo: rd.repo.name,
            number: issue.number,
            title: issue.title,
            url: issue.url,
            ageDays,
          });
        }
      }
    }

    staleIssues.sort((a, b) => b.ageDays - a.ageDays);

    if (useJson()) {
      jsonOut({ ok: true, data: { issues: staleIssues } });
      return;
    }

    if (staleIssues.length === 0) {
      console.log("No stale issues found.");
      return;
    }

    console.log(`Found ${staleIssues.length} stale issue${staleIssues.length > 1 ? "s" : ""}:\n`);
    for (const issue of staleIssues) {
      const color = issue.ageDays >= 14 ? "\x1b[31m" : "\x1b[33m";
      console.log(
        `  ${color}[${issue.ageDays}d]\x1b[0m #${issue.number} ${issue.title} (${issue.repo})`,
      );
    }

    if (opts.launch) {
      const { spawnBackgroundAgent } = await import("./board/spawn-agent.js");
      const phase = opts.phase ?? "research";
      console.log(`\nLaunching ${phase} agents...\n`);

      let launched = 0;
      for (const issue of staleIssues) {
        const rc = cfg.repos.find((r) => r.name === issue.repo);
        if (!rc?.localPath) {
          console.log(`  Skip #${issue.number} — no localPath configured for ${issue.repo}`);
          continue;
        }
        const result = spawnBackgroundAgent({
          localPath: rc.localPath,
          repoFullName: issue.repo,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueUrl: issue.url,
          phase,
        });
        if (result.ok) {
          const pid = result.value.pid;
          console.log(`  Started ${phase} agent for #${issue.number} (PID ${pid})`);
          // Detach child so CLI can exit
          result.value.child.unref();
          launched++;
        } else {
          console.log(`  Failed #${issue.number}: ${result.error.message}`);
        }
      }
      console.log(`\nLaunched ${launched} agent${launched !== 1 ? "s" : ""}.`);
    } else {
      console.log(`\nRun with --launch to start background agents.`);
    }
  });

workflowCommand
  .command("show")
  .description("Show current workflow config for a repo")
  .argument("[repo]", "Repo short name or owner/repo")
  .action(async (repoRef?: string) => {
    const cfg = loadFullConfig();

    if (repoRef) {
      const repo = findRepo(cfg, repoRef);
      if (!repo) {
        errorOut(`Repo "${repoRef}" not found in config`);
      }
      if (useJson()) {
        jsonOut({
          ok: true,
          data: {
            repo: repo.name,
            workflow: repo.workflow,
            autoStatus: repo.autoStatus,
            boardWorkflow: cfg.board.workflow,
          },
        });
      } else {
        console.log(`Workflow config for ${repo.name}:\n`);
        console.log(`  Repo-level workflow:`);
        console.log(`    ${JSON.stringify(repo.workflow ?? {}, null, 2).replace(/\n/g, "\n    ")}`);
        console.log(`\n  Auto-status:`);
        console.log(
          `    ${JSON.stringify(repo.autoStatus ?? {}, null, 2).replace(/\n/g, "\n    ")}`,
        );
        console.log(`\n  Board-level workflow:`);
        console.log(
          `    ${JSON.stringify(cfg.board.workflow ?? {}, null, 2).replace(/\n/g, "\n    ")}`,
        );
      }
    } else if (useJson()) {
      // Show board-level workflow config
      jsonOut({ ok: true, data: { boardWorkflow: cfg.board.workflow } });
    } else {
      console.log("Board-level workflow config:\n");
      console.log(`  ${JSON.stringify(cfg.board.workflow ?? {}, null, 2).replace(/\n/g, "\n  ")}`);
    }
  });

workflowCommand
  .command("export")
  .description("Export workflow config as a shareable template")
  .argument("<repo>", "Repo short name or owner/repo")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .option("-n, --name <name>", "Template name", "Exported Workflow")
  .action(async (repoRef: string, opts: { output?: string; name?: string }) => {
    const cfg = loadFullConfig();
    const repo = findRepo(cfg, repoRef);
    if (!repo) {
      errorOut(`Repo "${repoRef}" not found in config`);
    }

    const { exportTemplate } = await import("./workflow-template.js");
    const template = exportTemplate(opts.name ?? "Exported Workflow", repo, cfg.board);

    if (opts.output) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(opts.output, `${JSON.stringify(template, null, 2)}\n`);
      if (useJson()) {
        jsonOut({ ok: true, data: { file: opts.output, template } });
      } else {
        printSuccess(`Template exported to ${opts.output}`);
      }
    } else if (useJson()) {
      jsonOut({ ok: true, data: template });
    } else {
      console.log(JSON.stringify(template, null, 2));
    }
  });

workflowCommand
  .command("import")
  .description("Import a workflow template into config")
  .argument("<file>", "Path to template JSON file")
  .option("-r, --repo <name>", "Apply to specific repo (otherwise board-level only)")
  .option("--dry-run", "Show what would change without modifying config")
  .action(async (file: string, opts: { repo?: string; dryRun?: true }) => {
    const { importTemplate, applyTemplateToBoard, applyTemplateToRepo } = await import(
      "./workflow-template.js"
    );

    const result = importTemplate(file);
    if ("error" in result) {
      errorOut(result.error);
    }

    const cfg = loadFullConfig();

    if (opts.dryRun) {
      if (useJson()) {
        jsonOut({ ok: true, data: { dryRun: true, template: result } });
      } else {
        console.log("Template validated successfully:\n");
        console.log(`  Name: ${result.name}`);
        if (result.description) console.log(`  Description: ${result.description}`);
        console.log(`  Phases: ${result.workflow.phases.join(", ")}`);
        console.log(`  Mode: ${result.workflow.mode}`);
        if (result.staleness) {
          console.log(
            `  Staleness: warning ${result.staleness.warningDays}d, critical ${result.staleness.criticalDays}d`,
          );
        }
        if (result.autoStatus) {
          console.log(`  Auto-status triggers: ${Object.keys(result.autoStatus).join(", ")}`);
        }
        console.log("\nRun without --dry-run to apply.");
      }
      return;
    }

    // Apply to board config
    const updatedBoard = applyTemplateToBoard(result, cfg.board);
    const updatedConfig = { ...cfg, board: updatedBoard };

    // Optionally apply to a specific repo
    if (opts.repo) {
      const repoIdx = updatedConfig.repos.findIndex(
        (r) => r.shortName === opts.repo || r.name === opts.repo,
      );
      if (repoIdx < 0) {
        errorOut(`Repo "${opts.repo}" not found in config`);
      }
      const existingRepo = updatedConfig.repos[repoIdx];
      if (existingRepo) {
        updatedConfig.repos = [...updatedConfig.repos];
        updatedConfig.repos[repoIdx] = applyTemplateToRepo(result, existingRepo);
      }
    }

    saveFullConfig(updatedConfig);

    if (useJson()) {
      jsonOut({ ok: true, data: { imported: result.name, repo: opts.repo ?? null } });
    } else {
      printSuccess(`Imported template "${result.name}"`);
      if (opts.repo) {
        console.log(`  Applied to repo: ${opts.repo}`);
      }
      console.log("  Applied to board-level workflow config.");
    }
  });

// -- Run --

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
