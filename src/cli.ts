const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(
    `hog requires Node.js >= 22 (current: ${process.version}). Install from https://nodejs.org/`,
  );
  process.exit(1);
}

import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { extractIssueFields, hasLlmApiKey } from "./ai.js";
import { TickTickClient } from "./api.js";
import type { CompletionAction, RepoConfig } from "./config.js";
import {
  clearLlmAuth,
  findRepo,
  getConfig,
  getLlmAuth,
  loadFullConfig,
  requireAuth,
  resolveProfile,
  saveConfig,
  saveFullConfig,
  saveLlmAuth,
  validateRepoName,
} from "./config.js";
import { runInit } from "./init.js";
import {
  jsonOut,
  printProjects,
  printSuccess,
  printSyncResult,
  printSyncStatus,
  printTask,
  printTasks,
  setFormat,
  useJson,
} from "./output.js";
import { getSyncStatus, runSync } from "./sync.js";
import type { CreateTaskInput, UpdateTaskInput } from "./types.js";
import { Priority } from "./types.js";

// -- Typed option interfaces for each command --

interface GlobalOptions {
  json?: true;
  human?: true;
}

interface InitOptions {
  force?: true;
}

interface AddOptions {
  priority?: string;
  date?: string;
  start?: string;
  content?: string;
  tags?: string;
  allDay?: true;
  project?: string;
}

interface ListOptions {
  project?: string;
  all?: true;
  priority?: string;
  tag?: string;
}

interface ProjectScopedOptions {
  project?: string;
}

interface UpdateOptions extends ProjectScopedOptions {
  title?: string;
  priority?: string;
  date?: string;
  content?: string;
  tags?: string;
}

// -- Helpers --

const PRIORITY_MAP: Record<string, Priority | undefined> = {
  none: Priority.None,
  low: Priority.Low,
  medium: Priority.Medium,
  med: Priority.Medium,
  high: Priority.High,
};

function parsePriority(value: string): Priority {
  const p = PRIORITY_MAP[value.toLowerCase()];
  if (p === undefined) {
    console.error(`Invalid priority: ${value}. Use: none, low, medium, high`);
    process.exit(1);
  }
  return p;
}

function createClient(): TickTickClient {
  const auth = requireAuth();
  return new TickTickClient(auth.accessToken);
}

function resolveProjectId(projectId?: string): string {
  if (projectId) return projectId;
  const config = getConfig();
  if (config.defaultProjectId) return config.defaultProjectId;
  console.error("No project selected. Run `hog task use-project <id>` or pass --project.");
  process.exit(1);
}

// -- Program --

const program = new Command();

program
  .name("hog")
  .description("Personal command deck — unified task dashboard for GitHub Projects + TickTick")
  .version("1.6.1") // x-release-please-version
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

// -- Task commands --

const task = program.command("task").description("Manage TickTick tasks");

task
  .command("add <title>")
  .description("Create a new task")
  .option("-p, --priority <level>", "Priority: none, low, medium, high")
  .option("-d, --date <date>", "Due date (ISO 8601)")
  .option("--start <date>", "Start date (ISO 8601)")
  .option("-c, --content <text>", "Task description/content")
  .option("-t, --tags <tags>", "Comma-separated tags")
  .option("--all-day", "Mark as all-day task")
  .option("--project <id>", "Project ID (overrides default)")
  .action(async (title: string, opts: AddOptions) => {
    const api = createClient();
    const input: CreateTaskInput = {
      title,
      projectId: resolveProjectId(opts.project),
    };

    if (opts.priority) input.priority = parsePriority(opts.priority);
    if (opts.date) input.dueDate = opts.date;
    if (opts.start) input.startDate = opts.start;
    if (opts.content) input.content = opts.content;
    if (opts.tags) input.tags = opts.tags.split(",").map((t) => t.trim());
    if (opts.allDay) input.isAllDay = true;

    const created = await api.createTask(input);
    printSuccess(`Created: ${created.title}`, {
      task: created as unknown as Record<string, unknown>,
    });
  });

task
  .command("list")
  .description("List tasks in a project")
  .option("--project <id>", "Project ID (overrides default)")
  .option("--all", "Include completed tasks")
  .option("-p, --priority <level>", "Filter by minimum priority")
  .option("-t, --tag <tag>", "Filter by tag")
  .action(async (opts: ListOptions) => {
    const api = createClient();
    const projectId = resolveProjectId(opts.project);
    let tasks = await api.listTasks(projectId);

    if (!opts.all) {
      tasks = tasks.filter((t) => t.status !== 2);
    }
    if (opts.priority) {
      const minPri = parsePriority(opts.priority);
      tasks = tasks.filter((t) => t.priority >= minPri);
    }
    if (opts.tag) {
      const tag = opts.tag;
      tasks = tasks.filter((t) => t.tags.includes(tag));
    }

    printTasks(tasks);
  });

task
  .command("show <taskId>")
  .description("Show task details")
  .option("--project <id>", "Project ID (overrides default)")
  .action(async (taskId: string, opts: ProjectScopedOptions) => {
    const api = createClient();
    const projectId = resolveProjectId(opts.project);
    const t = await api.getTask(projectId, taskId);
    printTask(t);
  });

task
  .command("complete <taskId>")
  .description("Mark a task as completed")
  .option("--project <id>", "Project ID (overrides default)")
  .action(async (taskId: string, opts: ProjectScopedOptions) => {
    const api = createClient();
    const projectId = resolveProjectId(opts.project);
    await api.completeTask(projectId, taskId);
    printSuccess(`Completed task ${taskId}`, { taskId });
  });

task
  .command("update <taskId>")
  .description("Update a task")
  .option("--title <title>", "New title")
  .option("-p, --priority <level>", "New priority")
  .option("-d, --date <date>", "New due date (ISO 8601)")
  .option("-c, --content <text>", "New content")
  .option("-t, --tags <tags>", "New comma-separated tags")
  .option("--project <id>", "Project ID (overrides default)")
  .action(async (taskId: string, opts: UpdateOptions) => {
    const api = createClient();
    const projectId = resolveProjectId(opts.project);
    const input: UpdateTaskInput = { id: taskId, projectId };

    if (opts.title) input.title = opts.title;
    if (opts.priority) input.priority = parsePriority(opts.priority);
    if (opts.date) input.dueDate = opts.date;
    if (opts.content) input.content = opts.content;
    if (opts.tags) input.tags = opts.tags.split(",").map((t) => t.trim());

    const updated = await api.updateTask(input);
    printSuccess(`Updated: ${updated.title}`, {
      task: updated as unknown as Record<string, unknown>,
    });
  });

task
  .command("delete <taskId>")
  .description("Delete a task")
  .option("--project <id>", "Project ID (overrides default)")
  .action(async (taskId: string, opts: ProjectScopedOptions) => {
    const api = createClient();
    const projectId = resolveProjectId(opts.project);
    await api.deleteTask(projectId, taskId);
    printSuccess(`Deleted task ${taskId}`, { taskId });
  });

task
  .command("projects")
  .description("List all projects")
  .action(async () => {
    const api = createClient();
    const projects = await api.listProjects();
    printProjects(projects);
  });

task
  .command("use-project <projectId>")
  .description("Set the default project for task commands")
  .action(async (projectId: string) => {
    const api = createClient();
    try {
      const project = await api.getProject(projectId);
      saveConfig({ defaultProjectId: project.id, defaultProjectName: project.name });
      printSuccess(`Default project: ${project.name} (${project.id})`, {
        projectId: project.id,
        projectName: project.name,
      });
    } catch {
      saveConfig({ defaultProjectId: projectId });
      printSuccess(`Default project: ${projectId}`, { projectId });
    }
  });

// -- Sync commands --

interface SyncRunOptions {
  dryRun?: true;
}

const sync = program.command("sync").description("Sync GitHub issues with TickTick");

sync
  .command("run", { isDefault: true })
  .description("Run GitHub-TickTick sync")
  .option("--dry-run", "Preview changes without applying them")
  .action(async (opts: SyncRunOptions) => {
    const dryRun = opts.dryRun ?? false;
    const result = await runSync({ dryRun });
    printSyncResult(result, dryRun);
  });

sync
  .command("status")
  .description("Show sync status and mappings")
  .action(() => {
    const { state, repos } = getSyncStatus();
    printSyncStatus(state, repos);
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
  .description("Pick up an issue: assign to self + sync to TickTick (e.g., hog pick aibility/145)")
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
          ticktickTask: result.ticktickTask ?? null,
          warning: result.warning ?? null,
        },
      });
    } else {
      console.log(`Picked ${ref.repo.shortName}#${ref.issueNumber}: ${result.issue.title}`);
      console.log(`  GitHub: assigned to @me`);
      if (result.ticktickTask) {
        console.log(`  TickTick: task created`);
      }
      if (result.warning) {
        console.log(`  Warning: ${result.warning}`);
      }
    }
  });

// -- Config commands --

interface ConfigAddRepoOptions {
  projectNumber: string;
  statusFieldId: string;
  completionType: string;
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
      console.log("Default project:", cfg.defaultProjectId ?? "(none)");
      console.log("Assignee:", cfg.board.assignee);
      console.log("Refresh interval:", `${cfg.board.refreshInterval}s`);
      console.log("Backlog limit:", cfg.board.backlogLimit);
      console.log("TickTick:", cfg.ticktick.enabled ? "enabled" : "disabled");
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
  .command("repos:add <name>")
  .description("Add a repository to track (owner/repo format)")
  .requiredOption("--project-number <n>", "GitHub project number")
  .requiredOption("--status-field-id <id>", "Project status field ID")
  .requiredOption(
    "--completion-type <type>",
    "Completion action: addLabel, updateProjectStatus, closeIssue",
  )
  .option("--completion-option-id <id>", "Option ID for updateProjectStatus")
  .option("--completion-label <label>", "Label for addLabel")
  .action((name: string, opts: ConfigAddRepoOptions) => {
    if (!validateRepoName(name)) {
      console.error("Invalid repo name. Use owner/repo format (e.g., myorg/myrepo)");
      process.exit(1);
    }

    const cfg = loadFullConfig();
    if (findRepo(cfg, name)) {
      console.error(`Repo "${name}" is already configured.`);
      process.exit(1);
    }

    const shortName = name.split("/")[1] ?? name;

    let completionAction: CompletionAction;
    switch (opts.completionType) {
      case "addLabel":
        if (!opts.completionLabel) {
          console.error("--completion-label required for addLabel type");
          process.exit(1);
        }
        completionAction = { type: "addLabel", label: opts.completionLabel };
        break;
      case "updateProjectStatus":
        if (!opts.completionOptionId) {
          console.error("--completion-option-id required for updateProjectStatus type");
          process.exit(1);
        }
        completionAction = { type: "updateProjectStatus", optionId: opts.completionOptionId };
        break;
      case "closeIssue":
        completionAction = { type: "closeIssue" };
        break;
      default:
        console.error(
          `Unknown completion type: ${opts.completionType}. Use: addLabel, updateProjectStatus, closeIssue`,
        );
        process.exit(1);
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
      console.error(`Repo "${name}" not found. Run: hog config repos`);
      process.exit(1);
    }
    const [removed] = cfg.repos.splice(idx, 1);
    if (!removed) {
      process.exit(1);
    }
    saveFullConfig(cfg);

    if (useJson()) {
      jsonOut({ ok: true, message: `Removed ${removed.name}`, data: removed });
    } else {
      console.log(`Removed ${removed.shortName} → ${removed.name}`);
      console.log("Note: Existing sync mappings for this repo remain in sync-state.json.");
    }
  });

config
  .command("ticktick:enable")
  .description("Enable TickTick integration in the board")
  .action(() => {
    const cfg = loadFullConfig();
    cfg.ticktick = { enabled: true };
    saveFullConfig(cfg);
    if (useJson()) {
      jsonOut({ ok: true, message: "TickTick enabled" });
    } else {
      printSuccess("TickTick integration enabled.");
    }
  });

config
  .command("ticktick:disable")
  .description("Disable TickTick integration in the board")
  .action(() => {
    const cfg = loadFullConfig();
    cfg.ticktick = { enabled: false };
    saveFullConfig(cfg);
    if (useJson()) {
      jsonOut({ ok: true, message: "TickTick disabled" });
    } else {
      printSuccess("TickTick integration disabled. Board will no longer show TickTick tasks.");
    }
  });

config
  .command("ai:set-key <key>")
  .description("Store an OpenRouter API key for AI-enhanced issue creation (I key on board)")
  .action((key: string) => {
    if (!key.startsWith("sk-or-")) {
      console.error('Error: key must start with "sk-or-". Get one at https://openrouter.ai/keys');
      process.exit(1);
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
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential if/else for display only
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
      console.error(`Profile "${name}" already exists.`);
      process.exit(1);
    }

    cfg.profiles[name] = {
      repos: [...cfg.repos],
      board: { ...cfg.board },
      ticktick: { ...cfg.ticktick },
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
      console.error(
        `Profile "${name}" not found. Available: ${Object.keys(cfg.profiles).join(", ") || "(none)"}`,
      );
      process.exit(1);
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
      console.error(
        `Profile "${name}" not found. Available: ${Object.keys(cfg.profiles).join(", ") || "(none)"}`,
      );
      process.exit(1);
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
  dryRun?: boolean;
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
      console.error(
        "Error: no repo specified. Use --repo owner/name or configure repos in hog init.",
      );
      process.exit(1);
    }

    if (hasLlmApiKey()) {
      console.error("[info] LLM parsing enabled");
    }

    const parsed = await extractIssueFields(text, {
      onLlmFallback: (msg) => console.error(`[warn] ${msg}`),
    });

    if (!parsed) {
      console.error(
        "Error: could not parse a title from input. Ensure your text has a non-empty title.",
      );
      process.exit(1);
    }

    const labels = [...parsed.labels];
    if (parsed.dueDate) labels.push(`due:${parsed.dueDate}`);

    // Show parsed fields
    console.error(`Title:    ${parsed.title}`);
    if (labels.length > 0) console.error(`Labels:   ${labels.join(", ")}`);
    if (parsed.assignee) console.error(`Assignee: @${parsed.assignee}`);
    if (parsed.dueDate) console.error(`Due:      ${parsed.dueDate}`);
    console.error(`Repo:     ${repo}`);

    if (opts.dryRun) {
      console.error("[dry-run] Skipping issue creation.");
      return;
    }

    const args = ["issue", "create", "--repo", repo, "--title", parsed.title, "--body", ""];
    for (const label of labels) {
      args.push("--label", label);
    }

    try {
      execFileSync("gh", args, { stdio: "inherit" });
    } catch (err) {
      console.error(
        `Error: gh issue create failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

program.addCommand(issueCommand);

// -- Run --

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
