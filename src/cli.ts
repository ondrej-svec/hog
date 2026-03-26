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
  CONFIG_DIR,
  clearLlmAuth,
  findRepo,
  getLlmAuth,
  loadFullConfig,
  resolveProfile,
  saveFullConfig,
  saveLlmAuth,
  validateConfigSchema,
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

interface ParsedIssueRef {
  repo: RepoConfig;
  issueNumber: number;
}

function resolveRef(ref: string, config: HogConfig): ParsedIssueRef {
  const match = ref.match(/^([a-zA-Z0-9_.-]+)\/(\d+)$/);
  if (!(match?.[1] && match[2])) {
    errorOut("Invalid format. Use: shortName/number (e.g., myrepo/145)");
  }
  const repo = findRepo(config, match[1]);
  if (!repo) {
    errorOut(`Unknown repo "${match[1]}". Run: hog config repos`);
  }
  const num = Number.parseInt(match[2], 10);
  if (num < 1 || num > 999999) {
    errorOut("Invalid issue number");
  }
  return { repo, issueNumber: num };
}

// -- Program --

const program = new Command();

program
  .name("hog")
  .description("TDD-enforced AI development pipelines with structural role separation")
  .version("1.25.1") // x-release-please-version
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
  .option("--no-github", "Skip GitHub integration (pipeline-only setup)")
  .action(async (opts: InitOptions & { github?: boolean }) => {
    await runInit({ force: opts.force ?? false, noGithub: opts.github === false });
  });

// -- Cockpit command (v2 primary TUI) --

program
  .command("cockpit")
  .description("Pipeline cockpit — monitor and manage AI development pipelines")
  .action(async () => {
    const config = loadFullConfig();
    const { runCockpit } = await import("./board/live.js");
    await runCockpit(config);
  });

// -- Board command (tombstone — removed in v2) --

program
  .command("board")
  .description("(Removed in v2.0 — use hog cockpit)")
  .allowUnknownOption()
  .action(() => {
    console.log("hog board was removed in v2.0. Use: hog cockpit");
    console.log("The GitHub Issues dashboard has been replaced with the pipeline cockpit.");
  });

// -- Pick command (tombstone — removed in v2) --

program
  .command("pick")
  .argument("[issueRef]")
  .description("(Removed in v2.0)")
  .action(() => {
    console.log("hog pick was removed in v2.0.");
    console.log("Start pipelines instead: hog pipeline create --issue <ref>");
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

// -- Pipeline commands --

const pipelineCommand = program.command("pipeline").description("Pipeline management");

pipelineCommand
  .command("create <title>")
  .description("Create an autonomous development pipeline")
  .option("--description <text>", "Feature description (defaults to title)")
  .option("--stories <path>", "Path to stories file")
  .option("--brainstorm-done", "Skip brainstorm phase (mark as already completed)")
  .option("--repo <name>", "Target repo (short name or full)")
  .option("--issue <ref>", "Link to existing GitHub issue (owner/repo#123)")
  .option("--create-issue", "Create a new GitHub issue and link it to the pipeline")
  .action(
    async (
      title: string,
      opts: {
        description?: string;
        stories?: string;
        brainstormDone?: true;
        repo?: string;
        issue?: string;
        createIssue?: true;
      },
    ) => {
      const rawCfg = loadFullConfig();
      const { resolved: cfg } = resolveProfile(rawCfg);
      const { Engine } = await import("./engine/engine.js");
      const { Conductor } = await import("./engine/conductor.js");

      const engine = new Engine(cfg);

      if (!engine.beadsAvailable) {
        console.error(
          "Beads (bd) is not installed. Install it first: https://github.com/steveyegge/beads",
        );
        process.exitCode = 1;
        return;
      }

      // Resolve target repo: explicit --repo > match cwd > ad-hoc from cwd
      const cwd = process.cwd();
      let targetRepo: RepoConfig | undefined;
      let repoName: string;

      if (opts.repo) {
        targetRepo = cfg.repos.find((r) => r.shortName === opts.repo || r.name === opts.repo);
        if (!targetRepo) {
          console.error(`Repo not found: ${opts.repo}`);
          process.exitCode = 1;
          return;
        }
        repoName = targetRepo.name;
      } else {
        // Try to match cwd to a configured repo
        targetRepo = cfg.repos.find((r) => r.localPath && cwd.startsWith(r.localPath));

        if (targetRepo) {
          repoName = targetRepo.name;
        } else {
          // No configured repo — create minimal config from cwd
          // All GitHub-specific fields get safe defaults
          const { basename } = await import("node:path");
          repoName = basename(cwd);
          targetRepo = {
            name: repoName,
            shortName: repoName,
            projectNumber: 0,
            statusFieldId: "",
            localPath: cwd,
            completionAction: { type: "closeIssue" },
          } as RepoConfig;
        }
      }

      if (!targetRepo) {
        console.error("No repo configured. Run `hog init` first.");
        process.exitCode = 1;
        return;
      }

      const conductor = new Conductor(cfg, engine.eventBus, engine.agents, engine.beads);
      engine.agents.start();
      conductor.start();

      const result = await conductor.startPipeline(
        targetRepo.name,
        targetRepo,
        title,
        opts.description ?? title,
      );

      if ("error" in result) {
        console.error(`Failed: ${result.error}`);
        conductor.stop();
        engine.agents.stop();
        process.exitCode = 1;
        return;
      }

      // Close brainstorm bead if --brainstorm-done (fire-and-forget mode)
      if (opts.brainstormDone) {
        try {
          await engine.beads.close(
            targetRepo.localPath ?? cwd,
            result.beadIds.brainstorm,
            "Brainstorm completed in session",
          );
        } catch (err) {
          console.error(
            `Warning: failed to close brainstorm bead: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Link to GitHub issue if --issue or --create-issue
      let linkedIssueNumber = 0;
      let linkedRepo = "";
      if (opts.issue) {
        // Parse owner/repo#123 format
        const issueMatch = opts.issue.match(/^(.+)#(\d+)$/);
        if (issueMatch?.[1] && issueMatch[2]) {
          linkedRepo = issueMatch[1];
          linkedIssueNumber = Number.parseInt(issueMatch[2], 10);
          const { linkIssueToBead, loadBeadsSyncState, saveBeadsSyncState } = await import(
            "./engine/beads-sync.js"
          );
          const syncState = loadBeadsSyncState();
          const updated = linkIssueToBead(
            syncState,
            linkedRepo,
            linkedIssueNumber,
            result.featureId,
          );
          saveBeadsSyncState(updated);
          if (!useJson()) {
            console.log(`  Linked:  ${linkedRepo}#${linkedIssueNumber}`);
          }
        } else {
          console.error("Warning: invalid --issue format. Expected: owner/repo#123");
        }
      } else if (opts.createIssue) {
        try {
          const { createIssueAsync } = await import("./github.js");
          const issueUrl = await createIssueAsync(repoName, title, opts.description ?? title);
          // Parse issue number from URL (gh returns the URL)
          const numMatch = issueUrl.match(/\/(\d+)$/);
          if (numMatch?.[1]) {
            linkedIssueNumber = Number.parseInt(numMatch[1], 10);
            linkedRepo = repoName;
            const { linkIssueToBead, loadBeadsSyncState, saveBeadsSyncState } = await import(
              "./engine/beads-sync.js"
            );
            const syncState = loadBeadsSyncState();
            const updated = linkIssueToBead(
              syncState,
              linkedRepo,
              linkedIssueNumber,
              result.featureId,
            );
            saveBeadsSyncState(updated);
            if (!useJson()) {
              console.log(`  Issue:   ${linkedRepo}#${linkedIssueNumber} (created)`);
            }
          }
        } catch (err) {
          console.error(
            `Warning: failed to create GitHub issue: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (useJson()) {
        jsonOut({
          ok: true,
          data: {
            featureId: result.featureId,
            title: result.title,
            repo: result.repo,
            beadIds: result.beadIds,
            brainstormDone: opts.brainstormDone ?? false,
            linkedIssue:
              linkedIssueNumber > 0 ? { repo: linkedRepo, number: linkedIssueNumber } : null,
          },
        });
      } else {
        console.log(`Pipeline started: ${result.featureId}`);
        console.log(`  Repo:    ${targetRepo.shortName ?? targetRepo.name}`);
        console.log(
          `  Beads:   brainstorm${opts.brainstormDone ? " ✓" : ""} → stories → tests → impl → redteam → merge`,
        );
        if (opts.brainstormDone) {
          console.log("  Mode:    brainstorm skipped — stories agent starts next");
        }
        console.log("  Watch:   background conductor advancing phases automatically");
        console.log(`  Log:     ~/.config/hog/pipelines/${result.featureId}.log`);
        console.log("");
        console.log("You'll get system notifications as phases complete.");
        console.log(
          "Run `hog cockpit` for visual progress, or `hog pipeline list` to check status.",
        );
      }

      // Spawn a background conductor to advance the pipeline through all phases.
      // Without this, the pipeline stalls after the first agent completes.
      const { spawn: spawnProcess } = await import("node:child_process");
      const { fileURLToPath } = await import("node:url");
      const cliPath = fileURLToPath(import.meta.url).replace(/\.js$/, ".js");
      const watchArgs = ["pipeline", "watch", result.featureId, "--repo", targetRepo.name];
      const child = spawnProcess(process.execPath, [cliPath, ...watchArgs], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      // Stop the conductor in THIS process — the background watcher takes over
      conductor.stop();
      engine.agents.stop();
    },
  );

pipelineCommand
  .command("list")
  .description("Show active pipelines")
  .action(async () => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");
    const { Conductor } = await import("./engine/conductor.js");

    const engine = new Engine(cfg);
    const conductor = new Conductor(cfg, engine.eventBus, engine.agents, engine.beads);
    const pipelines = conductor.getPipelines();

    if (useJson()) {
      jsonOut({ ok: true, data: { pipelines } });
    } else if (pipelines.length === 0) {
      console.log("No active pipelines.");
    } else {
      for (const p of pipelines) {
        console.log(`${p.featureId}  ${p.status.padEnd(10)}  ${p.title}`);
      }
    }
  });

pipelineCommand
  .command("status <featureId>")
  .description("Show detailed status of a pipeline")
  .action(async (featureId: string) => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");
    const { Conductor } = await import("./engine/conductor.js");
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const engine = new Engine(cfg);
    const conductor = new Conductor(cfg, engine.eventBus, engine.agents, engine.beads);
    const pipelines = conductor.getPipelines();
    const pipeline = pipelines.find((p) => p.featureId === featureId);

    if (!pipeline) {
      // Check if there's a log file with history
      const logFile = join(CONFIG_DIR, "pipelines", `${featureId}.log`);
      if (existsSync(logFile)) {
        console.log(`Pipeline ${featureId} is no longer active. Log:`);
        console.log("");
        console.log(readFileSync(logFile, "utf-8"));
      } else {
        console.error(`Pipeline not found: ${featureId}`);
        process.exitCode = 1;
      }
      return;
    }

    const phases = ["brainstorm", "stories", "tests", "impl", "redteam", "merge"];
    const completed = pipeline.completedBeads ?? 0;

    if (useJson()) {
      jsonOut({ ok: true, data: { pipeline } });
    } else {
      console.log(`Pipeline: ${pipeline.featureId}`);
      console.log(`Title:    ${pipeline.title}`);
      console.log(`Status:   ${pipeline.status}`);
      console.log(`Repo:     ${pipeline.repo}`);
      console.log(`Started:  ${pipeline.startedAt}`);
      console.log(`Progress: ${completed}/6 phases`);
      console.log("");

      // DAG visualization
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i]!;
        let icon: string;
        if (i < completed) {
          icon = "✓";
        } else if (phase === pipeline.activePhase) {
          icon = "◐";
        } else {
          icon = "○";
        }
        console.log(`  ${icon} ${phase}`);
      }

      // Show log tail if available
      const logFile = join(CONFIG_DIR, "pipelines", `${featureId}.log`);
      if (existsSync(logFile)) {
        const logContent = readFileSync(logFile, "utf-8");
        const lines = logContent.trim().split("\n").slice(-5);
        console.log("");
        console.log("Recent log:");
        for (const line of lines) {
          console.log(`  ${line}`);
        }
      }
    }
  });

pipelineCommand
  .command("pause <featureId>")
  .description("Pause a running pipeline")
  .action(async (featureId: string) => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");
    const { Conductor } = await import("./engine/conductor.js");

    const engine = new Engine(cfg);
    const conductor = new Conductor(cfg, engine.eventBus, engine.agents, engine.beads);
    const ok = conductor.pausePipeline(featureId);
    console.log(ok ? `Paused: ${featureId}` : `Pipeline not found or not running: ${featureId}`);
  });

pipelineCommand
  .command("resume <featureId>")
  .description("Resume a paused pipeline")
  .action(async (featureId: string) => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");
    const { Conductor } = await import("./engine/conductor.js");

    const engine = new Engine(cfg);
    const conductor = new Conductor(cfg, engine.eventBus, engine.agents, engine.beads);
    const ok = conductor.resumePipeline(featureId);
    console.log(ok ? `Resumed: ${featureId}` : `Pipeline not found or not paused: ${featureId}`);
  });

pipelineCommand
  .command("clear")
  .description("Remove all pipelines")
  .action(async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const pipelinesFile = join(CONFIG_DIR, "pipelines.json");
    writeFileSync(pipelinesFile, "[]\n", { mode: 0o600 });
    console.log("All pipelines cleared.");
  });

pipelineCommand
  .command("done <featureId>")
  .description("Complete the current phase of a pipeline (closes the active bead)")
  .action(async (featureId: string) => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");
    const { Conductor } = await import("./engine/conductor.js");

    const engine = new Engine(cfg);
    if (!engine.beadsAvailable) {
      console.error("Beads (bd) is not installed.");
      process.exitCode = 1;
      return;
    }

    const conductor = new Conductor(cfg, engine.eventBus, engine.agents, engine.beads);
    const pipelines = conductor.getPipelines();
    const pipeline = pipelines.find((p) => p.featureId === featureId);

    if (!pipeline) {
      console.error(`Pipeline not found: ${featureId}`);
      process.exitCode = 1;
      return;
    }

    // Find the active phase's bead ID
    const phase = pipeline.activePhase;
    if (!phase) {
      console.error("No active phase to complete.");
      process.exitCode = 1;
      return;
    }

    const beadIdMap: Record<string, string> = {
      brainstorm: pipeline.beadIds.brainstorm,
      stories: pipeline.beadIds.stories,
      test: pipeline.beadIds.tests,
      impl: pipeline.beadIds.impl,
      redteam: pipeline.beadIds.redteam,
      merge: pipeline.beadIds.merge,
    };

    const beadId = beadIdMap[phase];
    if (!beadId) {
      console.error(`Unknown phase: ${phase}`);
      process.exitCode = 1;
      return;
    }

    try {
      await engine.beads.close(pipeline.localPath, beadId, `${phase} completed by user`);
      console.log(`Phase "${phase}" completed for pipeline ${featureId}.`);
      console.log("The conductor will advance to the next phase automatically.");
    } catch (err) {
      console.error(`Failed to close bead: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

pipelineCommand
  .command("cancel <featureId>")
  .description("Cancel and remove a pipeline")
  .action(async (featureId: string) => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");
    const { Conductor } = await import("./engine/conductor.js");

    const engine = new Engine(cfg);
    const conductor = new Conductor(cfg, engine.eventBus, engine.agents, engine.beads);
    const ok = conductor.cancelPipeline(featureId);
    console.log(ok ? `Cancelled: ${featureId}` : `Pipeline not found: ${featureId}`);
  });

pipelineCommand
  .command("watch <featureId>", { hidden: true })
  .description("Internal: keep conductor alive until a pipeline completes")
  .option("--repo <name>", "Target repo")
  .action(async (featureId: string, opts: { repo?: string }) => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");
    const { Conductor } = await import("./engine/conductor.js");
    const { sendOsNotification } = await import("./notify.js");
    const { mkdirSync, appendFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const engine = new Engine(cfg);
    if (!engine.beadsAvailable) {
      process.exitCode = 1;
      return;
    }

    // Set up progress log
    const logDir = join(CONFIG_DIR, "pipelines");
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, `${featureId}.log`);

    const log = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}\n`;
      appendFileSync(logFile, line, "utf-8");
    };

    log(`Watcher started for pipeline ${featureId}`);

    const conductor = new Conductor(cfg, engine.eventBus, engine.agents, engine.beads);
    engine.agents.start();
    conductor.start();

    // Track phase transitions for notifications
    let lastPhase: string | undefined;
    let lastCompletedBeads = 0;

    const PHASE_LABELS: Record<string, string> = {
      brainstorm: "Brainstorm",
      stories: "Stories",
      test: "Tests",
      impl: "Implementation",
      redteam: "Red Team",
      merge: "Merge",
    };

    // Poll until the pipeline completes, fails, or disappears
    const checkInterval = setInterval(() => {
      const pipelines = conductor.getPipelines();
      const pipeline = pipelines.find((p) => p.featureId === featureId);

      if (!pipeline) {
        log("Pipeline not found — watcher exiting");
        clearInterval(checkInterval);
        conductor.stop();
        engine.agents.stop();
        process.exit(0);
        return;
      }

      // Detect phase transitions
      if (pipeline.activePhase && pipeline.activePhase !== lastPhase) {
        const label = PHASE_LABELS[pipeline.activePhase] ?? pipeline.activePhase;
        log(`Phase: ${label} started (${pipeline.completedBeads}/6 complete)`);
        sendOsNotification({
          title: `hog: ${pipeline.title}`,
          body: `${label} phase started (${pipeline.completedBeads}/6)`,
        });
        lastPhase = pipeline.activePhase;
      }

      // Detect bead completions
      if (pipeline.completedBeads > lastCompletedBeads) {
        log(`Progress: ${pipeline.completedBeads}/6 beads completed`);
        lastCompletedBeads = pipeline.completedBeads;
      }

      // Terminal states
      if (pipeline.status === "completed") {
        log("Pipeline completed successfully!");
        sendOsNotification({
          title: `hog: ${pipeline.title}`,
          body: "Pipeline complete! All 6 phases done.",
        });
        // Auto-stop Dolt server — no longer needed
        engine.beads.stopDolt(pipeline.localPath).catch(() => {});
        log("Dolt server stopped (auto-cleanup)");
        clearInterval(checkInterval);
        conductor.stop();
        engine.agents.stop();
        process.exit(0);
      }

      if (pipeline.status === "failed") {
        const phase = pipeline.activePhase ?? "unknown";
        log(`Pipeline FAILED at ${phase} phase`);
        sendOsNotification({
          title: `hog: ${pipeline.title}`,
          body: `Pipeline failed at ${phase}. Run: hog pipeline list`,
        });
        // Auto-stop Dolt server on failure too
        engine.beads.stopDolt(pipeline.localPath).catch(() => {});
        clearInterval(checkInterval);
        conductor.stop();
        engine.agents.stop();
        process.exit(1);
      }

      if (pipeline.status === "blocked") {
        // Only notify once per block
        if (lastPhase !== `blocked:${pipeline.activePhase}`) {
          const phase = pipeline.activePhase ?? "unknown";
          log(`Pipeline BLOCKED at ${phase} — needs human decision`);
          sendOsNotification({
            title: `hog: ${pipeline.title}`,
            body: `Blocked at ${phase} — needs your decision. Run: hog board --live`,
          });
          lastPhase = `blocked:${pipeline.activePhase}`;
        }
      }
    }, 5_000);

    // Clean shutdown on SIGINT/SIGTERM
    const shutdown = () => {
      log("Watcher stopped (signal received)");
      clearInterval(checkInterval);
      conductor.stop();
      engine.agents.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

pipelineCommand
  .command("init")
  .description("Add pipeline instructions to your project's CLAUDE.md")
  .action(async () => {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const claudeMdPath = join(process.cwd(), "CLAUDE.md");
    const section = `
## Hog Pipelines

This project uses [hog](https://github.com/ondrejsvec/hog) for autonomous development pipelines.

When the user wants to turn a feature into autonomous work ("ship it", "build this", "/pipeline"):
1. Write user stories to \`tests/stories/{slug}.md\` using STORY-001 format with acceptance criteria
2. Run: \`hog pipeline create "Feature title" --brainstorm-done --stories tests/stories/{slug}.md\`
3. The pipeline runs autonomously: stories → tests → impl → redteam → merge

Other commands: \`hog pipeline list\`, \`hog pipeline pause <id>\`, \`hog pipeline resume <id>\`
`;

    const marker = "## Hog Pipelines";

    if (existsSync(claudeMdPath)) {
      const existing = readFileSync(claudeMdPath, "utf-8");
      if (existing.includes(marker)) {
        console.log("CLAUDE.md already has a Hog Pipelines section. No changes needed.");
        return;
      }
      writeFileSync(claudeMdPath, `${existing}\n${section}`, "utf-8");
      console.log("Added Hog Pipelines section to CLAUDE.md");
    } else {
      writeFileSync(claudeMdPath, `# CLAUDE.md\n${section}`, "utf-8");
      console.log("Created CLAUDE.md with Hog Pipelines section");
    }
  });

// -- Beads server management --

const beadsCommand = program.command("beads").description("Beads/Dolt server management");

beadsCommand
  .command("status")
  .description("Show Dolt server status")
  .option("--all", "Show ALL running Dolt servers across projects")
  .action(async (opts: { all?: true }) => {
    const { Engine } = await import("./engine/engine.js");
    const { BeadsClient, projectPort } = await import("./engine/beads.js");

    if (opts.all) {
      const servers = BeadsClient.findRunningDoltServers();
      if (servers.length === 0) {
        console.log("No running Dolt servers found.");
        return;
      }
      console.log("Running Dolt servers:");
      for (const s of servers) {
        const portStr = s.port ? `port ${s.port}` : "port unknown";
        const cwdStr = s.cwd ?? "unknown project";
        const timeStr = s.startTime ?? "";
        console.log(`  PID ${s.pid}  ${portStr.padEnd(12)}  ${cwdStr}  ${timeStr}`);
      }
      return;
    }

    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const engine = new Engine(cfg);

    if (!engine.beadsAvailable) {
      console.error("Beads (bd) is not installed.");
      process.exitCode = 1;
      return;
    }

    const cwd = process.cwd();
    const beads = engine.beads;

    if (!beads.isInitialized(cwd)) {
      console.log(`No .beads/ in ${cwd}. Run \`hog pipeline create\` to initialize.`);
      return;
    }

    const status = await beads.doltStatus(cwd);
    const expectedPort = projectPort(cwd);
    console.log(`Beads server for ${cwd}:`);
    console.log(`  Status:  ${status.running ? "running" : "stopped"}`);
    console.log(`  Port:    ${status.port ?? expectedPort} (assigned: ${expectedPort})`);
    if (status.pid) console.log(`  PID:     ${status.pid}`);
  });

beadsCommand
  .command("start")
  .description("Start Dolt server for current project")
  .action(async () => {
    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");

    const engine = new Engine(cfg);
    if (!engine.beadsAvailable) {
      console.error("Beads (bd) is not installed.");
      process.exitCode = 1;
      return;
    }

    const cwd = process.cwd();
    await engine.beads.ensureDoltRunning(cwd);
    const status = await engine.beads.doltStatus(cwd);
    console.log(`Dolt server started${status.port ? ` on port ${status.port}` : ""}.`);
  });

beadsCommand
  .command("stop")
  .description("Stop Dolt server")
  .option("--all", "Stop ALL running Dolt servers")
  .action(async (opts: { all?: true }) => {
    if (opts.all) {
      const { BeadsClient } = await import("./engine/beads.js");
      const servers = BeadsClient.findRunningDoltServers();
      if (servers.length === 0) {
        console.log("No running Dolt servers found.");
        return;
      }
      let killed = 0;
      for (const s of servers) {
        try {
          process.kill(s.pid, "SIGTERM");
          killed++;
          console.log(`Stopped PID ${s.pid}${s.cwd ? ` (${s.cwd})` : ""}`);
        } catch {
          console.error(`Failed to stop PID ${s.pid}`);
        }
      }
      console.log(`\nStopped ${killed}/${servers.length} server(s).`);
      return;
    }

    const rawCfg = loadFullConfig();
    const { resolved: cfg } = resolveProfile(rawCfg);
    const { Engine } = await import("./engine/engine.js");

    const engine = new Engine(cfg);
    if (!engine.beadsAvailable) {
      console.error("Beads (bd) is not installed.");
      process.exitCode = 1;
      return;
    }

    const cwd = process.cwd();
    const stopped = await engine.beads.stopDolt(cwd);
    console.log(stopped ? "Dolt server stopped." : "No running server found for this project.");
  });

// Deprecation alias for hog work
program
  .command("work", { hidden: true })
  .description("Deprecated: use `hog pipeline create` instead")
  .allowUnknownOption()
  .action(() => {
    console.error("'hog work' has been replaced by 'hog pipeline create'.");
    console.error("");
    console.error("Usage:");
    console.error('  hog pipeline create "Add user authentication"');
    console.error("  hog pipeline create --brainstorm-done --stories tests/stories/auth.md");
    console.error("  hog pipeline list");
    console.error("  hog pipeline pause <featureId>");
    console.error("  hog pipeline resume <featureId>");
    process.exitCode = 1;
  });

// -- Decisions command --

program
  .command("decisions")
  .description("Show and resolve pending human decisions from the pipeline")
  .option("--resolve <id>", "Resolve a specific question by ID")
  .option("--answer <text>", "Answer text (use with --resolve)")
  .action(async (opts: { resolve?: string; answer?: string }) => {
    const { loadQuestionQueue, saveQuestionQueue, getPendingQuestions, resolveQuestion } =
      await import("./engine/question-queue.js");

    const queue = loadQuestionQueue();

    if (opts.resolve) {
      if (!opts.answer) {
        console.error("Provide --answer with --resolve");
        process.exitCode = 1;
        return;
      }
      const updated = resolveQuestion(queue, opts.resolve, opts.answer);
      saveQuestionQueue(updated);
      console.log(`Resolved: ${opts.resolve}`);
      return;
    }

    const pending = getPendingQuestions(queue);
    if (pending.length === 0) {
      console.log("No pending decisions.");
      return;
    }

    console.log(`${pending.length} pending decision(s):\n`);
    for (const q of pending) {
      console.log(`  ${q.id}  [${q.source}]`);
      console.log(`  Feature: ${q.featureId}`);
      console.log(`  ${q.question}`);
      if (q.options) {
        console.log(`  Options: ${q.options.join(" | ")}`);
      }
      console.log(`  Since: ${q.createdAt}`);
      console.log("");
    }
    console.log('Resolve with: hog decisions --resolve <id> --answer "your answer"');
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
  .command("set <path> <value>")
  .description("Set a configuration value (dot-notation path, e.g. board.assignee)")
  .action((path: string, rawValue: string) => {
    const cfg = loadFullConfig();

    // Parse the value: try boolean, then number, then keep as string
    let value: unknown = rawValue;
    if (rawValue === "true") value = true;
    else if (rawValue === "false") value = false;
    else if (rawValue !== "" && !Number.isNaN(Number(rawValue))) value = Number(rawValue);

    // Walk the dot-notation path and set the value
    const keys = path.split(".");
    if (keys.length === 0) {
      errorOut("Invalid path: empty path");
    }

    // Deep-clone config to avoid mutation before validation
    const updated = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
    let target: Record<string, unknown> = updated;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i] as string;
      const next = target[key];
      if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
        errorOut(`Invalid path: "${keys.slice(0, i + 1).join(".")}" is not a nested object`);
      }
      target = next as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1] as string;
    target[lastKey] = value;

    // Validate the updated config against the Zod schema
    const result = validateConfigSchema(updated);
    if (!result.success) {
      errorOut(`Validation failed:\n${result.error}`);
    }

    saveFullConfig(result.data);

    if (useJson()) {
      jsonOut({ ok: true, path, value });
    } else {
      printSuccess(`Set ${path} = ${JSON.stringify(value)}`);
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

// -- Issue snooze command --

interface IssueSnoozeOptions {
  days: string;
  list?: true;
}

issueCommand
  .command("snooze [issueRef]")
  .description("Snooze an issue to suppress staleness nudges for N days")
  .option("--days <n>", "Number of days to snooze", "7")
  .option("--list", "List all currently snoozed issues")
  .action(async (issueRef: string | undefined, opts: IssueSnoozeOptions) => {
    const { loadEnrichment, saveEnrichment, snoozeIssue, isSnoozed } = await import(
      "./enrichment.js"
    );
    const enrichment = loadEnrichment();

    if (opts.list) {
      const snoozed = Object.entries(enrichment.nudgeState.snoozedIssues)
        .filter(([, until]) => new Date(until).getTime() > Date.now())
        .map(([key, until]) => ({ issue: key, snoozedUntil: until }));

      if (useJson()) {
        jsonOut({ ok: true, data: { snoozed } });
      } else if (snoozed.length === 0) {
        console.log("No issues currently snoozed.");
      } else {
        console.log("Snoozed issues:");
        for (const { issue, snoozedUntil } of snoozed) {
          const until = new Date(snoozedUntil).toLocaleDateString();
          console.log(`  ${issue} — until ${until}`);
        }
      }
      return;
    }

    if (!issueRef) {
      errorOut("issueRef required unless using --list");
    }

    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const days = Number.parseInt(opts.days, 10);

    if (Number.isNaN(days) || days < 1) {
      errorOut(`Invalid --days value: "${opts.days}". Must be a positive integer.`);
    }

    const alreadySnoozed = isSnoozed(enrichment, ref.repo.name, ref.issueNumber);
    const updated = snoozeIssue(enrichment, ref.repo.name, ref.issueNumber, days);
    saveEnrichment(updated);

    const until = new Date(Date.now() + days * 86_400_000).toLocaleDateString();

    if (useJson()) {
      jsonOut({
        ok: true,
        data: {
          repo: ref.repo.name,
          issueNumber: ref.issueNumber,
          days,
          snoozedUntil: new Date(Date.now() + days * 86_400_000).toISOString(),
          wasAlreadySnoozed: alreadySnoozed,
        },
      });
    } else {
      const verb = alreadySnoozed ? "Re-snoozed" : "Snoozed";
      console.log(
        `${verb} ${ref.repo.shortName}#${ref.issueNumber} for ${days} days (until ${until})`,
      );
    }
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
  .description("(Removed in v2.0 — use pipelines instead)")
  .allowUnknownOption()
  .action(() => {
    console.log("hog workflow triage was removed in v2.0.");
    console.log("Use pipelines for structured agent work: hog pipeline create");
  });

// -- Workflow launch command --

interface WorkflowLaunchOptions {
  phase: string;
  mode?: string;
}

workflowCommand
  .command("launch <issueRef>")
  .description("Launch a background Claude agent for a workflow phase on an issue")
  .requiredOption(
    "--phase <phase>",
    "Workflow phase to run (research, brainstorm, plan, implement, review, compound, completion-check)",
  )
  .option("--mode <mode>", "Launch mode: background (default)", "background")
  .action(async (issueRef: string, opts: WorkflowLaunchOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const rc = ref.repo;

    if (!rc.localPath) {
      errorOut(
        `Set localPath for ${rc.shortName} in ~/.config/hog/config.json to enable agent launch`,
        { repo: rc.shortName },
      );
    }

    const { fetchIssueAsync } = await import("./github.js");
    const issue = await fetchIssueAsync(rc.name, ref.issueNumber);

    const { spawnBackgroundAgent } = await import("./board/spawn-agent.js");
    const { DEFAULT_PHASE_PROMPTS } = await import("./board/launch-claude.js");

    const phaseTemplate = DEFAULT_PHASE_PROMPTS[opts.phase];

    const startCommand = rc.claudeStartCommand ?? cfg.board.claudeStartCommand;

    const result = spawnBackgroundAgent({
      localPath: rc.localPath,
      repoFullName: rc.name,
      issueNumber: ref.issueNumber,
      issueTitle: issue.title,
      issueUrl: issue.url,
      phase: opts.phase,
      promptTemplate: phaseTemplate,
      promptVariables: { phase: opts.phase, repo: rc.name },
      ...(startCommand ? { startCommand } : {}),
    });

    if (!result.ok) {
      errorOut(result.error.message, { kind: result.error.kind });
    }

    // Detach child so CLI can exit immediately
    result.value.child.unref();

    if (useJson()) {
      jsonOut({
        ok: true,
        data: {
          pid: result.value.pid,
          phase: opts.phase,
          repo: rc.shortName,
          issueNumber: ref.issueNumber,
          resultFile: result.value.resultFilePath,
        },
      });
    } else {
      console.log(
        `Started ${opts.phase} agent for ${rc.shortName}#${ref.issueNumber} (PID ${result.value.pid})`,
      );
      console.log(`  Result file: ${result.value.resultFilePath}`);
    }
  });

// -- Workflow resume command --

interface WorkflowResumeOptions {
  session?: string;
}

workflowCommand
  .command("resume <issueRef>")
  .description("Resume an interactive Claude Code session for an issue")
  .option("--session <id>", "Claude session ID to resume (default: latest session for issue)")
  .action(async (issueRef: string, opts: WorkflowResumeOptions) => {
    const cfg = loadFullConfig();
    const ref = await resolveRef(issueRef, cfg);
    const rc = ref.repo;

    if (!rc.localPath) {
      errorOut(
        `Set localPath for ${rc.shortName} in ~/.config/hog/config.json to enable Claude Code launch`,
        { repo: rc.shortName },
      );
    }

    let sessionId = opts.session;

    if (!sessionId) {
      const { loadEnrichment, findSessions } = await import("./enrichment.js");
      const enrichment = loadEnrichment();
      const sessions = findSessions(enrichment, rc.name, ref.issueNumber);
      const latest = sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

      if (!latest?.claudeSessionId) {
        errorOut(
          `No previous session found for ${rc.shortName}#${ref.issueNumber}. Use --session <id> to specify one.`,
          { repo: rc.shortName, issueNumber: ref.issueNumber },
        );
      }

      sessionId = latest.claudeSessionId;
    }

    const { launchClaude } = await import("./board/launch-claude.js");
    const { fetchIssueAsync } = await import("./github.js");

    const issue = await fetchIssueAsync(rc.name, ref.issueNumber);
    const startCommand = rc.claudeStartCommand ?? cfg.board.claudeStartCommand;
    const launchMode = cfg.board.claudeLaunchMode ?? "auto";
    const terminalApp = cfg.board.claudeTerminalApp;

    const result = launchClaude({
      localPath: rc.localPath,
      issue: { number: issue.number, title: issue.title, url: issue.url },
      promptTemplate: `--resume ${sessionId}`,
      ...(startCommand ? { startCommand } : {}),
      launchMode,
      ...(terminalApp ? { terminalApp } : {}),
      repoFullName: rc.name,
    });

    if (!result.ok) {
      errorOut(result.error.message, { kind: result.error.kind });
    }

    if (useJson()) {
      jsonOut({
        ok: true,
        data: { repo: rc.shortName, issueNumber: ref.issueNumber, sessionId },
      });
    } else {
      console.log(
        `Resuming Claude Code session ${sessionId} for ${rc.shortName}#${ref.issueNumber}`,
      );
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

// -- Tombstoned commands (removed in v2, print migration messages) --

program
  .command("sync")
  .description("(Removed in v2.0)")
  .allowUnknownOption()
  .action(() => {
    console.log("hog sync was removed in v2.0.");
    console.log(
      "Sync functionality (TickTick) was dropped. GitHub integration is now via pipeline phase sync.",
    );
    console.log("See: hog init --help");
  });

program
  .command("task")
  .description("(Removed in v2.0)")
  .allowUnknownOption()
  .action(() => {
    console.log("hog task was removed in v2.0.");
    console.log("Task management (TickTick) was dropped. Use pipelines instead.");
    console.log("See: hog pipeline create --help");
  });

// -- Run --

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
