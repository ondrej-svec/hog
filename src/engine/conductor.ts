import { join } from "node:path";
import { launchClaude } from "../board/launch-claude.js";
import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import type { Bead, BeadsClient } from "./beads.js";
import type { EventBus } from "./event-bus.js";
import { PipelineStore, type SessionMapEntry } from "./pipeline-store.js";
import type { QuestionQueue } from "./question-queue.js";
import {
  enqueueQuestion,
  getPendingForFeature,
  loadQuestionQueue,
  pruneOrphaned,
  resolveQuestion as resolveQuestionInQueue,
  saveQuestionQueue,
} from "./question-queue.js";
import type { Refinery } from "./refinery.js";
import { writeRoleClaudeMd } from "./role-context.js";
import type { PipelineRole } from "./roles.js";
import { beadToRole, PIPELINE_ROLES, resolvePromptForRole } from "./roles.js";
import { getSkillContract, resolveOutputPaths, validateContract, wirePhaseInputs } from "./skill-contract.js";
import { checkSummaryForFailure } from "./summary-parser.js";
import { checkTraceability, verifyRedState } from "./tdd-enforcement.js";
import type { WorktreeManager } from "./worktree.js";

// ── Types ──

export type PipelineStatus = "running" | "paused" | "blocked" | "completed" | "failed";

export interface Pipeline {
  readonly featureId: string;
  readonly title: string;
  /** Full description the user provided when creating the pipeline. */
  readonly description?: string | undefined;
  readonly repo: string;
  readonly localPath: string;
  readonly repoConfig: RepoConfig;
  readonly beadIds: {
    brainstorm: string;
    stories: string;
    scaffold: string;
    tests: string;
    impl: string;
    redteam: string;
    merge: string;
  };
  status: PipelineStatus;
  /** Number of completed (closed) beads out of 7. Updated by conductor tick. */
  completedBeads: number;
  /** Currently active phase (if any agent is running). */
  activePhase?: string | undefined;
  readonly startedAt: string;
  completedAt?: string;
  /** Path to stories file (set by brainstorm or --stories flag). */
  storiesPath?: string | undefined;
  /** Path to architecture doc (derived from storiesPath). */
  architecturePath?: string | undefined;
  /**
   * Pipeline context — grows as stages complete. Each stage can add info
   * that subsequent stages need (test command, test dirs, created files).
   */
  context?: PipelineContext | undefined;
  /** Estimated cost tracking per phase (in USD). */
  costByPhase?: Record<string, number>;
  /** Total estimated cost (in USD). */
  totalCost?: number;
}

/** Structured feedback for retried agents. */
export interface RetryFeedback {
  /** Why the retry happened. */
  readonly reason: string;
  /** Specific missing items (story IDs, file paths, etc.). */
  readonly missing: string[];
  /** Previous agent's summary (truncated). */
  readonly previousSummary: string;
  /** 1-indexed retry attempt number. */
  readonly attempt: number;
}

// Retry loop configuration lives in retry-engine.ts (GATE_CONFIGS).
// The conductor's inline retry logic will be replaced by the engine in Phase 2.

/** Shared context between pipeline stages. Grows as stages complete. */
export interface PipelineContext {
  /** How to run tests (e.g., "cd heart-of-gold-toolkit && pytest"). Set after test phase. */
  testCommand?: string | undefined;
  /** Directory containing test files. */
  testDir?: string | undefined;
  /** List of test files created by the test agent. */
  testFiles?: string[] | undefined;
  /** Working directory for test/impl/redteam (may differ from pipeline.localPath). */
  workingDir?: string | undefined;
  /** Summary from each completed phase. */
  phaseSummaries?: Record<string, string> | undefined;
  /** Structured retry feedback per role — injected into re-spawned agent prompts. */
  retryFeedback?: Record<string, RetryFeedback> | undefined;
  /** Stories skipped by the human (excluded from coverage gates). */
  skippedStories?: string[] | undefined;
  /** Accumulated outputs from completed phases — used by contract-based wiring. */
  pipelineOutputs?: Record<string, string> | undefined;
}

export interface ConductorOptions {
  readonly pollIntervalMs?: number;
  readonly maxConcurrentPipelines?: number;
  /** Called when a pipeline phase completes. Used by GitHubSync to push labels/status. */
  readonly onPhaseCompleted?: (
    pipeline: Pipeline,
    phase: string,
    githubRepo: string,
    issueNumber: number,
  ) => Promise<void>;
}

// ── Decision Log ──

export interface DecisionLogEntry {
  readonly timestamp: string;
  readonly featureId: string;
  readonly action: string;
  readonly detail: string;
}

// ── Conductor ──

/**
 * The Conductor is the pipeline orchestrator. It is deterministic code, not an LLM.
 *
 * Core loop:
 * 1. For each active pipeline, poll bd ready to find unblocked beads
 * 2. Map each ready bead to its pipeline role via labels
 * 3. Spawn the appropriate agent with role-specific prompts
 * 4. Monitor agent completion/failure via EventBus
 * 5. Queue questions for human when specs are unclear
 */
export class Conductor {
  private readonly config: HogConfig;
  private readonly eventBus: EventBus;
  private readonly agentManager: AgentManager;
  private readonly beads: BeadsClient;
  private readonly worktrees: WorktreeManager | undefined;
  private readonly refinery: Refinery | undefined;
  private readonly store: PipelineStore;
  private readonly decisionLog: DecisionLogEntry[] = [];
  /** Maps session IDs to worktree paths for cleanup. */
  private readonly sessionWorktrees: Map<
    string,
    { worktreePath: string; branch: string; repoPath: string }
  > = new Map();
  /** Maps session IDs to pipeline feature IDs for correct completion routing. */
  private readonly sessionToPipeline: Map<string, string> = new Map();
  /** Test baselines captured before impl agent runs — for diff-based GREEN verification. */
  private readonly testBaselines: Map<string, import("./tdd-enforcement.js").TestBaseline> = new Map();
  /** Tracks pending parallel agents per bead. Bead closes when count reaches 0. */
  private readonly pendingParallelAgents: Map<string, number> = new Map();
  private questionQueue: QuestionQueue;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly pollIntervalMs: number;
  private readonly maxConcurrentPipelines: number;
  private readonly onPhaseCompleted?: ConductorOptions["onPhaseCompleted"];
  // Pipeline persistence delegated to PipelineStore (Fowler/Cherny extraction)

  constructor(
    config: HogConfig,
    eventBus: EventBus,
    agentManager: AgentManager,
    beads: BeadsClient,
    options: ConductorOptions & {
      worktrees?: WorktreeManager;
      refinery?: Refinery;
    } = {},
  ) {
    this.config = config;
    this.eventBus = eventBus;
    this.agentManager = agentManager;
    this.beads = beads;
    this.worktrees = options.worktrees;
    this.refinery = options.refinery;
    this.questionQueue = loadQuestionQueue();
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.maxConcurrentPipelines = options.maxConcurrentPipelines ?? 3;
    this.onPhaseCompleted = options.onPhaseCompleted;
    this.store = new PipelineStore(config);

    // Recover session maps from previous daemon run
    for (const entry of this.store.loadSessionMap()) {
      this.sessionToPipeline.set(entry.sessionId, entry.featureId);
      if (entry.worktreePath && entry.branch && entry.repoPath) {
        this.sessionWorktrees.set(entry.sessionId, {
          worktreePath: entry.worktreePath,
          branch: entry.branch,
          repoPath: entry.repoPath,
        });
      }
    }

    // Listen for agent completion/failure to advance pipelines
    this.eventBus.on("agent:completed", (event) => {
      this.onAgentCompleted(
        event.sessionId,
        event.repo,
        event.issueNumber,
        event.phase,
        event.summary,
      );
    });
    this.eventBus.on("agent:failed", (event) => {
      this.onAgentFailed(
        event.sessionId,
        event.repo,
        event.issueNumber,
        event.phase,
        event.exitCode,
        event.errorMessage,
      );
    });

    // Listen for refinery merge outcomes — roll back bead state on failure
    this.eventBus.on("mutation:failed", (event) => {
      if (!event.featureId) return;
      const pipeline = this.store.get(event.featureId);
      if (!pipeline) return;

      const role = event.role as PipelineRole | undefined;
      if (!role) return;

      const beadId = this.roleToBeadId(pipeline, role);
      if (!beadId) return;

      this.log(
        pipeline.featureId,
        `refinery:failed:${role}`,
        `Merge failed for ${role}: ${event.error}. Reopening bead.`,
      );

      // Re-open the bead and decrement — the agent's work didn't actually merge
      this.beads.updateStatus(pipeline.localPath, beadId, "open").catch(() => {});
      pipeline.completedBeads = Math.max(0, pipeline.completedBeads - 1);
      this.store.save();
    });

    this.eventBus.on("mutation:completed", (event) => {
      if (!event.featureId) return;
      const pipeline = this.store.get(event.featureId);
      if (!pipeline) return;

      this.log(
        pipeline.featureId,
        `refinery:merged:${event.role ?? "unknown"}`,
        event.description,
      );
    });
  }

  /** Start the conductor polling loop. */
  start(): void {
    // Clean up stale questions from pipelines that no longer exist
    const activeIds = new Set(this.store.getAll().map((p) => p.featureId));
    this.questionQueue = pruneOrphaned(this.questionQueue, activeIds);
    saveQuestionQueue(this.questionQueue);

    // Immediate tick so loaded pipelines don't wait pollIntervalMs
    this.tick().catch(() => {});

    this.pollTimer = setInterval(() => {
      this.tick().catch(() => {
        // error handling inside tick
      });
    }, this.pollIntervalMs);
  }

  /** Stop the conductor. In-flight ticks will not persist after stop. */
  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Get all active pipelines. */
  getPipelines(): Pipeline[] {
    return this.store.getAll();
  }

  /** Get the decision log. */
  getDecisionLog(): DecisionLogEntry[] {
    return [...this.decisionLog];
  }

  /** Get session-to-pipeline mapping (for agent.list RPC). */
  getSessionToPipeline(): ReadonlyMap<string, string> {
    return this.sessionToPipeline;
  }

  /** Persist session → pipeline/worktree maps for crash recovery. */
  private persistSessionMaps(): void {
    const entries: SessionMapEntry[] = [];
    for (const [sessionId, featureId] of this.sessionToPipeline) {
      const wt = this.sessionWorktrees.get(sessionId);
      entries.push({
        sessionId,
        featureId,
        worktreePath: wt?.worktreePath,
        branch: wt?.branch,
        repoPath: wt?.repoPath,
      });
    }
    this.store.saveSessionMap(entries);
  }

  /** Get the current question queue. */
  getQuestionQueue(): QuestionQueue {
    return this.questionQueue;
  }

  /** Resolve a pending question. Updates in-memory queue and persists. */
  resolveQuestion(questionId: string, answer: string): void {
    this.questionQueue = resolveQuestionInQueue(this.questionQueue, questionId, answer);
    saveQuestionQueue(this.questionQueue);
  }

  /**
   * Start a new feature pipeline.
   *
   * Creates a Beads DAG and begins orchestrating agents through
   * brainstorm → stories → tests → implementation → red team → merge.
   */
  async startPipeline(
    repo: string,
    repoConfig: RepoConfig,
    title: string,
    description: string,
    storiesPath?: string,
    architecturePath?: string,
  ): Promise<Pipeline | { error: string }> {
    if (!repoConfig.localPath) {
      return { error: `No localPath configured for ${repo}` };
    }

    if (!this.beads.isInstalled()) {
      return { error: "Beads (bd) is not installed. Run: brew install beads" };
    }

    if (!this.beads.isInitialized(repoConfig.localPath)) {
      try {
        await this.beads.init(repoConfig.localPath);
      } catch (err) {
        return {
          error: `Beads init failed in ${repoConfig.localPath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const activePipelines = this.store.getAll().filter((p) => p.status === "running");
    if (activePipelines.length >= this.maxConcurrentPipelines) {
      return {
        error: `Max concurrent pipelines (${this.maxConcurrentPipelines}) reached`,
      };
    }

    // Ensure Dolt server is running before creating beads
    await this.beads.ensureDoltRunning(repoConfig.localPath);

    // Create the feature DAG in Beads (retry once — Dolt may need a moment after start)
    let dag: Awaited<ReturnType<typeof this.beads.createFeatureDAG>>;
    try {
      dag = await this.beads.createFeatureDAG(repoConfig.localPath, title, description);
    } catch (firstErr) {
      // Retry once after a short wait — Dolt server may still be starting
      this.log("", "beads:retry", "First DAG creation failed, retrying after 2s...");
      await new Promise((r) => setTimeout(r, 2_000));
      try {
        await this.beads.ensureDoltRunning(repoConfig.localPath);
        dag = await this.beads.createFeatureDAG(repoConfig.localPath, title, description);
      } catch (retryErr) {
        return {
          error: `Failed to create Beads DAG: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
        };
      }
    }

    const featureId = `feat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const pipeline: Pipeline = {
      featureId,
      title,
      description,
      repo,
      localPath: repoConfig.localPath,
      repoConfig,
      beadIds: {
        brainstorm: dag.brainstorm.id,
        stories: dag.stories.id,
        scaffold: dag.scaffold.id,
        tests: dag.tests.id,
        impl: dag.impl.id,
        redteam: dag.redteam.id,
        merge: dag.merge.id,
      },
      status: "running",
      completedBeads: 0,
      activePhase: "brainstorm",
      ...(storiesPath ? { storiesPath } : {}),
      ...(architecturePath
        ? { architecturePath }
        : storiesPath
          ? { architecturePath: storiesPath.replace(/\.md$/, ".architecture.md") }
          : {}),
      startedAt: new Date().toISOString(),
    };

    this.store.set(featureId, pipeline);
    this.store.save();

    // Write safety deny rules to .claude/settings.json in the project (fire-and-forget)
    import("./safety-rules.js")
      .then(({ writeSafetyRules }) => writeSafetyRules(repoConfig.localPath ?? ""))
      .catch(() => {});

    this.log(featureId, "pipeline:started", `Heart of Gold launched. Course: "${title}"`);

    // Don't tick here — the watcher process handles advancement.
    // This prevents the brainstorm tmux session from opening before
    // --brainstorm-done can close the bead.

    return pipeline;
  }

  /** Pause a pipeline. Agents keep running but no new ones are spawned. */
  pausePipeline(featureId: string): boolean {
    const pipeline = this.store.get(featureId);
    if (!pipeline || pipeline.status !== "running") return false;
    pipeline.status = "paused";
    this.store.save();
    this.log(featureId, "pipeline:paused", "Paused by user");
    return true;
  }

  /** Resume a paused pipeline. */
  resumePipeline(featureId: string): boolean {
    const pipeline = this.store.get(featureId);
    if (!pipeline || pipeline.status !== "paused") return false;
    pipeline.status = "running";
    this.store.save();
    this.log(featureId, "pipeline:resumed", "Resumed by user");
    return true;
  }

  /** Cancel and remove a pipeline, cleaning up active agents and worktrees. */
  cancelPipeline(featureId: string): boolean {
    const pipeline = this.store.get(featureId);
    if (!pipeline) return false;

    // Clean up any active sessions for this pipeline
    for (const [sessionId, pipelineId] of this.sessionToPipeline) {
      if (pipelineId === featureId) {
        this.sessionToPipeline.delete(sessionId);
        // Clean up worktree if it exists
        const worktreeInfo = this.sessionWorktrees.get(sessionId);
        if (worktreeInfo && this.worktrees) {
          this.worktrees.remove(worktreeInfo.repoPath, worktreeInfo.worktreePath).catch(() => {});
        }
        this.sessionWorktrees.delete(sessionId);
      }
    }

    this.store.delete(featureId);
    this.store.save();
    this.log(featureId, "pipeline:cancelled", `Cancelled: ${pipeline.title}`);
    return true;
  }

  /**
   * Sync pipelines from disk — picks up new pipelines created by other processes
   * Delegated to PipelineStore (Fowler extraction).
   */

  // ── Core Loop ──

  /** One tick of the conductor — check all running pipelines for ready work. */
  private async tick(): Promise<void> {
    if (this.stopped) return;

    try {
      await this.tickInner();
    } catch (err) {
      console.error(`[conductor] Tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async tickInner(): Promise<void> {
    // Pick up pipelines created by other processes (CLI, watcher)
    this.store.syncFromDisk();

    for (const pipeline of this.store.getAll()) {
      // Skip completed/failed pipelines
      if (pipeline.status === "completed" || pipeline.status === "failed") continue;
      // Skip paused pipelines
      if (pipeline.status === "paused") continue;

      // Self-healing: reconcile state before making decisions
      await this.healPipeline(pipeline);

      // Check if blocked pipeline can be unblocked
      if (pipeline.status === "blocked") {
        if (getPendingForFeature(this.questionQueue, pipeline.featureId).length === 0) {
          pipeline.status = "running";
          this.log(pipeline.featureId, "pipeline:unblocked", "All questions resolved — resuming");
        } else {
          continue;
        }
      }

      // Block running pipelines that have unanswered questions
      if (getPendingForFeature(this.questionQueue, pipeline.featureId).length > 0) {
        pipeline.status = "blocked";
        this.log(pipeline.featureId, "pipeline:blocked", "Waiting for human decisions");
        continue;
      }

      await this.tickPipeline(pipeline);
    }

    // Detect stuck agents across all pipelines
    this.detectStuckAgents();

    // Persist any state changes from this tick cycle (but not if stopped)
    if (!this.stopped) {
      this.store.save();
    }
  }

  // ── Self-Healing ──

  /**
   * Heal a pipeline by reconciling in-memory state against ground truth.
   * Runs on every tick — all operations are idempotent.
   */
  private async healPipeline(pipeline: Pipeline): Promise<void> {
    // 1. Reconcile completedBeads from actual bead state
    try {
      let closedCount = 0;
      const beadStatuses: Record<string, string> = {};
      for (const [role, id] of Object.entries(pipeline.beadIds)) {
        const bead = await this.beads.show(pipeline.localPath, id);
        beadStatuses[role] = bead.status;
        if (bead.status === "closed") closedCount++;
      }

      if (pipeline.completedBeads !== closedCount) {
        const old = pipeline.completedBeads;
        pipeline.completedBeads = closedCount;
        this.log(
          pipeline.featureId,
          "heal:beads-reconciled",
          `Bead count corrected: ${old} → ${closedCount} (from actual bead state)`,
        );
      }

      // 2. Fix activePhase drift — find what's actually running
      const activeAgents = this.getActiveAgentsForPipeline(pipeline.featureId);
      if (activeAgents.length > 0) {
        // An agent is running — activePhase should match
        const agentPhase = activeAgents[0]!.phase;
        if (pipeline.activePhase !== agentPhase) {
          pipeline.activePhase = agentPhase;
        }
      } else {
        // No agents running — find the next ready phase from bead state
        const phaseOrder: Array<[string, PipelineRole]> = [
          ["brainstorm", "brainstorm"],
          ["stories", "stories"],
          ["scaffold", "scaffold"],
          ["tests", "test"],
          ["impl", "impl"],
          ["redteam", "redteam"],
          ["merge", "merge"],
        ];
        let nextPhase: string | undefined;
        for (const [beadKey, role] of phaseOrder) {
          const status = beadStatuses[beadKey];
          if (status === "in_progress" || status === "open") {
            nextPhase = role;
            break;
          }
        }
        if (nextPhase && pipeline.activePhase !== nextPhase) {
          pipeline.activePhase = nextPhase;
        }
      }

      // 3. Unstick in_progress beads with no active agent
      for (const [role, id] of Object.entries(pipeline.beadIds)) {
        if (beadStatuses[role] !== "in_progress") continue;
        const pipelineRole = role === "tests" ? "test" : (role as PipelineRole);
        const hasAgent = activeAgents.some((a) => a.phase === pipelineRole);
        // Don't unstick beads with pending parallel agents — some agents finished but others are still running
        const hasPendingParallel = (this.pendingParallelAgents.get(id) ?? 0) > 0;
        if (!hasAgent && !hasPendingParallel) {
          // Bead claimed but agent is gone — re-open for retry
          await this.beads.updateStatus(pipeline.localPath, id, "open").catch(() => {});
          this.log(
            pipeline.featureId,
            `heal:bead-unstuck:${role}`,
            `Re-opened stuck bead (was in_progress with no active agent)`,
          );
        }
      }
    } catch {
      // Beads not available — skip healing
    }
  }

  /** Find agents that belong to a specific pipeline. */
  private getActiveAgentsForPipeline(featureId: string): Array<{ sessionId: string; phase: string }> {
    const result: Array<{ sessionId: string; phase: string }> = [];
    for (const [sessionId, pipelineId] of this.sessionToPipeline) {
      if (pipelineId !== featureId) continue;
      const agent = this.agentManager.getAgents().find((a) => a.sessionId === sessionId);
      if (agent?.monitor.isRunning) {
        result.push({ sessionId, phase: agent.phase });
      }
    }
    return result;
  }

  /** Detect agents stuck for too long with no tool use changes. */
  private detectStuckAgents(): void {
    const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();

    for (const agent of this.agentManager.getAgents()) {
      if (!agent.monitor.isRunning) continue;
      const elapsed = now - new Date(agent.startedAt).getTime();
      if (elapsed < STUCK_THRESHOLD_MS) continue;

      // Agent has been running > 30 min — check if it's making progress
      // We can't easily track "last progress time" without new state,
      // so just log a warning for the user
      const featureId = this.sessionToPipeline.get(agent.sessionId);
      if (featureId) {
        const alreadyWarned = this.decisionLog.some(
          (e) => e.featureId === featureId && e.action === `heal:stuck-warning:${agent.phase}`,
        );
        if (!alreadyWarned) {
          this.log(
            featureId,
            `heal:stuck-warning:${agent.phase}`,
            `${PIPELINE_ROLES[agent.phase as PipelineRole]?.label ?? agent.phase} has been running for ${Math.round(elapsed / 60_000)}m — may be stuck`,
          );
        }
      }
    }
  }

  /**
   * Build a context section to append to an agent's prompt.
   * Injects operational facts from previous stages.
   */
  private buildContextSection(pipeline: Pipeline, role: PipelineRole): string | undefined {
    const ctx = pipeline.context;
    if (!ctx) return undefined;

    const lines: string[] = [];

    // impl, redteam, merge need test context
    if ((role === "impl" || role === "redteam" || role === "merge") && ctx.testCommand) {
      lines.push("");
      lines.push("<prior_stage_context>");
      lines.push("<test_environment>");
      if (ctx.testCommand) {
        lines.push(`  <test_command>${ctx.testCommand}</test_command>`);
      }
      if (ctx.workingDir) {
        lines.push(`  <working_directory>${ctx.workingDir}</working_directory>`);
      }
      if (ctx.testDir) {
        lines.push(`  <test_directory>${ctx.testDir}</test_directory>`);
      }
      if (ctx.testFiles && ctx.testFiles.length > 0) {
        lines.push(`  <test_files count="${ctx.testFiles.length}">`);
        for (const f of ctx.testFiles.slice(0, 10)) {
          lines.push(`    <file>${f}</file>`);
        }
        if (ctx.testFiles.length > 10) {
          lines.push(`    <!-- +${ctx.testFiles.length - 10} more files -->`);
        }
        lines.push("  </test_files>");
      }
      lines.push("</test_environment>");
    }

    // impl and redteam get summaries from earlier phases
    if ((role === "impl" || role === "redteam") && ctx.phaseSummaries) {
      const relevantPhases = role === "impl" ? ["test"] : ["test", "impl"];
      for (const phase of relevantPhases) {
        const summary = ctx.phaseSummaries[phase];
        if (summary) {
          lines.push(`<phase_summary phase="${phase}">${summary.slice(0, 300)}</phase_summary>`);
        }
      }
    }

    if (lines.length > 0) {
      lines.push("</prior_stage_context>");
    }

    return lines.length > 0 ? lines.join("\n") : undefined;
  }

  /**
   * Capture test context after the test phase completes.
   * Uses git diff (ground truth) to find test files created and test runner config.
   * Stores context on the pipeline AND on the bead metadata.
   */
  private async captureTestContext(pipeline: Pipeline): Promise<void> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { existsSync } = await import("node:fs");
    const execFileAsync = promisify(execFile);
    const cwd = pipeline.localPath;

    if (!pipeline.context) pipeline.context = {};

    // 1. Find test files via git diff
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--diff-filter=A", "HEAD~1", "HEAD"], {
        cwd,
        encoding: "utf-8",
        timeout: 10_000,
      });
      const newFiles = stdout.trim().split("\n").filter(Boolean);
      const testFiles = newFiles.filter((f) =>
        f.includes("test") || f.endsWith(".test.ts") || f.endsWith(".test.py") || f.endsWith("_test.py") || f.endsWith("_test.go"),
      );
      if (testFiles.length > 0) {
        pipeline.context.testFiles = testFiles;
        // Derive testDir from common prefix
        const dirs = [...new Set(testFiles.map((f) => f.split("/").slice(0, -1).join("/")))];
        pipeline.context.testDir = dirs.length === 1 ? dirs[0] : dirs.join(", ");
      }
    } catch {
      // No commits or git error — try unstaged
      try {
        const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--diff-filter=A"], {
          cwd,
          encoding: "utf-8",
          timeout: 10_000,
        });
        const newFiles = stdout.trim().split("\n").filter(Boolean);
        const testFiles = newFiles.filter((f) => f.includes("test"));
        if (testFiles.length > 0) {
          pipeline.context.testFiles = testFiles;
        }
      } catch {
        // best-effort
      }
    }

    // 2. Find test command from config files in the project (search subdirectories)
    try {
      const { stdout } = await execFileAsync(
        "find",
        [cwd, "-maxdepth", "4", "-name", "vitest.config.*", "-o", "-name", "jest.config.*", "-o", "-name", "pytest.ini", "-o", "-name", "pyproject.toml", "-o", "-name", "Cargo.toml", "-o", "-name", "go.mod"],
        { cwd, encoding: "utf-8", timeout: 10_000 },
      );
      const configFiles = stdout.trim().split("\n").filter(Boolean);

      for (const configFile of configFiles) {
        const relDir = configFile.replace(cwd + "/", "").split("/").slice(0, -1).join("/");
        const cdPrefix = relDir ? `cd ${relDir} && ` : "";

        if (configFile.includes("vitest.config")) {
          pipeline.context.testCommand = `${cdPrefix}npx vitest run`;
          pipeline.context.workingDir = relDir || undefined;
          break;
        }
        if (configFile.includes("jest.config")) {
          pipeline.context.testCommand = `${cdPrefix}npx jest`;
          pipeline.context.workingDir = relDir || undefined;
          break;
        }
        if (configFile.includes("pytest.ini") || configFile.includes("pyproject.toml")) {
          pipeline.context.testCommand = `${cdPrefix}python -m pytest`;
          pipeline.context.workingDir = relDir || undefined;
          break;
        }
        if (configFile.includes("Cargo.toml")) {
          pipeline.context.testCommand = `${cdPrefix}cargo test`;
          pipeline.context.workingDir = relDir || undefined;
          break;
        }
        if (configFile.includes("go.mod")) {
          pipeline.context.testCommand = `${cdPrefix}go test ./...`;
          pipeline.context.workingDir = relDir || undefined;
          break;
        }
      }
    } catch {
      // best-effort
    }

    // 3. Store context on the bead metadata
    const beadId = pipeline.beadIds.tests;
    try {
      await this.beads.updateMetadata(pipeline.localPath, beadId, {
        testCommand: pipeline.context.testCommand,
        testDir: pipeline.context.testDir,
        testFiles: pipeline.context.testFiles,
        workingDir: pipeline.context.workingDir,
      });
    } catch {
      // best-effort — bead metadata is supplementary
    }

    this.store.save();
    this.log(
      pipeline.featureId,
      "context:test-captured",
      `Test context: command="${pipeline.context.testCommand ?? "auto"}", ${pipeline.context.testFiles?.length ?? 0} test files in ${pipeline.context.testDir ?? "project root"}`,
    );
  }

  /** Detect stub/scaffolding patterns in recently changed files. */
  private async detectStubs(
    cwd: string,
  ): Promise<{ stubRatio: number; stubFiles: string[] }> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { readFileSync } = await import("node:fs");
    const execFileAsync = promisify(execFile);

    // Get files changed vs HEAD~1
    let changedFiles: string[];
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD~1", "HEAD"], {
        cwd,
        encoding: "utf-8",
        timeout: 10_000,
      });
      changedFiles = stdout.trim().split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
    } catch {
      // No commits or git error — check unstaged changes
      try {
        const { stdout } = await execFileAsync("git", ["diff", "--name-only"], {
          cwd,
          encoding: "utf-8",
          timeout: 10_000,
        });
        changedFiles = stdout.trim().split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
      } catch {
        return { stubRatio: 0, stubFiles: [] };
      }
    }

    if (changedFiles.length === 0) return { stubRatio: 0, stubFiles: [] };

    // Check each file for stub patterns
    const stubPatterns = [
      /return\s*\{[^}]{0,50}\}\s*;/g, // Short hardcoded object returns
      /return\s*["'`][^"'`]{20,}["'`]/g, // Hardcoded string returns >20 chars
      /\/\/\s*(stub|mock|todo|hack|placeholder|fixme)/gi, // Stub comments
      /throw new Error\(["'`](not implemented|todo)/gi, // Not implemented errors
    ];

    const stubFiles: string[] = [];
    for (const file of changedFiles) {
      if (file.includes(".test.")) continue; // Skip test files
      try {
        const content = readFileSync(`${cwd}/${file}`, "utf-8");
        const lines = content.split("\n").length;
        if (lines < 10) continue; // Skip tiny files

        let stubHits = 0;
        for (const pattern of stubPatterns) {
          const matches = content.match(pattern);
          if (matches) stubHits += matches.length;
        }

        // If >20% of lines have stub patterns, flag it
        if (stubHits > 0 && stubHits / lines > 0.05) {
          stubFiles.push(file);
        }
      } catch {
        // skip unreadable files
      }
    }

    return {
      stubRatio: changedFiles.length > 0 ? stubFiles.length / changedFiles.length : 0,
      stubFiles,
    };
  }

  /** Check a single pipeline for ready beads and spawn agents. */
  private async tickPipeline(pipeline: Pipeline): Promise<void> {
    let readyBeads: Bead[];
    try {
      readyBeads = await this.beads.ready(pipeline.localPath);
    } catch {
      return; // Beads not available, skip
    }

    // Filter to beads that belong to this pipeline
    const pipelineBeadIds = new Set(Object.values(pipeline.beadIds));
    const pipelineReady = readyBeads.filter((b) => pipelineBeadIds.has(b.id));

    // Bead state reconciliation is now handled by healPipeline() in the tick loop

    // Build reverse lookup: bead ID → role (Cherny: avoid title-parsing)
    const beadIdToRole: Record<string, PipelineRole> = {};
    for (const [role, id] of Object.entries(pipeline.beadIds)) {
      // Map: brainstorm→brainstorm, stories→stories, tests→test, impl→impl, redteam→redteam, merge→merge
      const pipelineRole = role === "tests" ? "test" : (role as PipelineRole);
      beadIdToRole[id] = pipelineRole;
    }

    for (const bead of pipelineReady) {
      // Skip beads already being worked on
      if (bead.status === "in_progress") continue;

      // Use pipeline.beadIds reverse lookup instead of title parsing (Cherny)
      const role = beadIdToRole[bead.id] ?? beadToRole(bead);
      if (!role) continue;

      // Check if this phase should run parallel agents
      const { isParallelizablePhase, splitIntoChunks, findStoriesFile, extractStoryIds } =
        await import("./story-splitter.js");

      if (
        isParallelizablePhase(role) &&
        this.config.pipeline?.maxConcurrentAgents > 1 &&
        !this.pendingParallelAgents.has(bead.id)
      ) {
        const resolvedStories =
          pipeline.storiesPath ??
          findStoriesFile(
            pipeline.localPath,
            pipeline.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          );
        const storyIds = resolvedStories ? extractStoryIds(resolvedStories) : [];

        if (storyIds.length > 1 && resolvedStories) {
          const maxAgents = this.config.pipeline.maxConcurrentAgents;
          const outputDir = join(pipeline.localPath, ".hog", "parallel");
          const chunks = splitIntoChunks(
            resolvedStories,
            storyIds,
            maxAgents,
            outputDir,
            role,
          );

          if (chunks.length > 1) {
            // Claim bead ONCE for all parallel agents
            try {
              await this.beads.claim(pipeline.localPath, bead.id);
            } catch {
              continue; // Another agent already claimed it
            }

            this.log(
              pipeline.featureId,
              `parallel:${role}`,
              `Splitting ${storyIds.length} stories into ${chunks.length} parallel agents (filtered files)`,
            );
            this.pendingParallelAgents.set(bead.id, chunks.length);

            for (let ci = 0; ci < chunks.length; ci++) {
              const chunk = chunks[ci]!;
              // Each agent gets its own filtered stories file as STORIES_PATH
              await this.spawnForRole(pipeline, bead, role, undefined, true, ci, chunk.filteredStoriesPath);
            }
            continue; // Don't fall through to single spawn
          }
        }
      }

      await this.spawnForRole(pipeline, bead, role);
    }

    // Check if all beads are closed → pipeline complete
    await this.checkPipelineCompletion(pipeline);
  }

  /** Spawn an agent for a specific role. */
  private async spawnForRole(
    pipeline: Pipeline,
    bead: Bead,
    role: PipelineRole,
    _unused?: undefined,
    skipClaim?: boolean,
    parallelIndex?: number,
    storiesPathOverride?: string,
  ): Promise<void> {
    const roleConfig = PIPELINE_ROLES[role];

    this.log(pipeline.featureId, `agent:preparing:${role}`, `Preparing to spawn ${roleConfig.label}`);

    // Brainstorm is a HUMAN activity — only launched by the user pressing Z
    // in the cockpit. The watcher/conductor never auto-launches it.
    if (role === "brainstorm") {
      return;
    }

    // Skip stories phase if stories file already exists (from brainstorm or --stories flag)
    if (role === "stories") {
      const { existsSync } = await import("node:fs");
      const { findStoriesFile } = await import("./story-splitter.js");
      const slug = pipeline.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      // Check pipeline.storiesPath first (explicit --stories flag), then search by slug
      const existing =
        (pipeline.storiesPath && existsSync(pipeline.storiesPath) ? pipeline.storiesPath : null) ??
        findStoriesFile(pipeline.localPath, slug);
      if (existing) {
        this.log(
          pipeline.featureId,
          "phase:skipped:stories",
          `Stories already exist (from brainstorm) — advancing to scaffold`,
        );
        await this.beads.close(pipeline.localPath, bead.id, "Stories already written by brainstorm");
        pipeline.completedBeads = Math.min(7, pipeline.completedBeads + 1);
        this.store.save();
        return;
      }
    }

    // RED verification: before spawning impl agent, verify tests fail
    if (role === "impl") {
      const testCwd = pipeline.context?.workingDir
        ? join(pipeline.localPath, pipeline.context.workingDir)
        : pipeline.localPath;
      const redResult = await verifyRedState(testCwd, {
        testCommand: pipeline.context?.testCommand,
      });
      if (!redResult.passed) {
        // Only log RED failure once per attempt (not every tick)
        const alreadyLogged = this.decisionLog.some(
          (e) =>
            e.featureId === pipeline.featureId &&
            e.action === "tdd:red-failed" &&
            Date.now() - new Date(e.timestamp).getTime() < this.pollIntervalMs * 2,
        );
        if (!alreadyLogged) {
          this.log(
            pipeline.featureId,
            "tdd:red-failed",
            `42. But what was the question? Tests pass without implementation — reopening test phase.`,
          );
        }
        // Re-open the test bead so tests get rewritten
        try {
          await this.beads.updateStatus(pipeline.localPath, pipeline.beadIds.tests, "open");
        } catch {
          // best-effort
        }
        return;
      }

      // Only log RED verified once (not every tick while waiting to spawn)
      const alreadyVerified = this.decisionLog.some(
        (e) =>
          e.featureId === pipeline.featureId &&
          e.action === "tdd:red-verified" &&
          Date.now() - new Date(e.timestamp).getTime() < 60_000,
      );
      if (!alreadyVerified) {
        this.log(pipeline.featureId, "tdd:red-verified", redResult.detail);

        // Traceability check (only once with RED verification)
        try {
          const { checkTraceability } = await import("./tdd-enforcement.js");
          const traceStoriesPath = pipeline.storiesPath ?? join(pipeline.localPath, "docs", "stories");
          const traceability = await checkTraceability(testCwd, traceStoriesPath);
          if (traceability.uncoveredStories.length > 0) {
            this.log(
              pipeline.featureId,
              "tdd:traceability-warning",
              `${traceability.uncoveredStories.length} stories without tests: ${traceability.uncoveredStories.join(", ")}`,
            );
          }
          if (traceability.orphanTests.length > 0) {
            this.log(
              pipeline.featureId,
              "tdd:orphan-tests",
              `${traceability.orphanTests.length} tests without stories: ${traceability.orphanTests.join(", ")}`,
            );
          }
        } catch {
          // Traceability is advisory — don't block on failures
        }
      }
    }

    // Claim the bead (skip if already claimed by parallel block)
    if (!skipClaim) {
      try {
        await this.beads.claim(pipeline.localPath, bead.id);
      } catch (err) {
        this.log(
          pipeline.featureId,
          `agent:claim-failed:${role}`,
          `Failed to claim bead ${bead.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }

    // Build the prompt with variable substitution
    const slug = pipeline.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Resolve actual paths to stories and architecture files
    const { findStoriesFile } = await import("./story-splitter.js");
    const resolvedStoriesPath =
      pipeline.storiesPath ??
      findStoriesFile(pipeline.localPath, slug) ??
      `docs/stories/${slug}.md`;
    const archPath =
      pipeline.architecturePath ??
      resolvedStoriesPath.replace(/\.md$/, ".architecture.md");

    // Resolve prompt: skill invocation (if toolkit installed) or fallback prompt
    const { prompt: resolvedPrompt, usingSkill } = resolvePromptForRole(role);

    let basePrompt: string;
    if (usingSkill) {
      // When using a skill, the prompt is just the slash command.
      // Context is passed via env vars (see pipelineEnv below).
      basePrompt = resolvedPrompt;
    } else {
      // Fallback: substitute variables into the bundled prompt template
      basePrompt = resolvedPrompt
        .replace(/\{title\}/g, pipeline.title)
        .replace(/\{slug\}/g, slug)
        .replace(/\{spec\}/g, bead.description ?? pipeline.title)
        .replace(/\{storiesPath\}/g, resolvedStoriesPath)
        .replace(/\{archPath\}/g, archPath)
        .replace(/\{featureId\}/g, pipeline.featureId);
    }

    // Inject pipeline context from previous stages
    const contextSection = this.buildContextSection(pipeline, role);

    // Inject retry context if this is a re-spawn (completeness gate feedback)
    let retrySection = "";
    const feedback = pipeline.context?.retryFeedback?.[role];
    if (feedback) {
      retrySection = `\n\n## Retry Context (attempt ${feedback.attempt})\n\nYour previous run did not complete all required work.\n\nIssue: ${feedback.reason}\nMissing: ${feedback.missing.slice(0, 20).join(", ")}\n\nPrevious agent's summary:\n> ${feedback.previousSummary.slice(0, 300)}\n\nFocus on completing the missing work. Do not redo work that was already done.\n`;
    }

    const prompt = basePrompt + (contextSection ?? "") + retrySection;

    // Build env vars for skill context using contract-based wiring
    const pipelineEnv: Record<string, string> = {
      STORIES_PATH: resolvedStoriesPath,
      ARCH_PATH: archPath,
      FEATURE_ID: pipeline.featureId,
    };
    if (role === "merge") {
      pipelineEnv["MERGE_CHECK"] = "true";
    }
    // BRAINSTORM_PATH is handled by contract-based wiring below (wirePhaseInputs).
    // Do NOT set it from phaseSummaries — that's a truncated summary string, not a file path.

    // For parallel agents: override STORIES_PATH with the filtered file
    if (storiesPathOverride) {
      pipelineEnv["STORIES_PATH"] = storiesPathOverride;
    }

    // Contract-based wiring: auto-wire outputs from previous phases as inputs
    const skillContract = usingSkill ? getSkillContract(roleConfig.skill) : undefined;
    if (skillContract && pipeline.context?.pipelineOutputs) {
      const wiredEnv = wirePhaseInputs(pipeline.context.pipelineOutputs, skillContract);
      Object.assign(pipelineEnv, wiredEnv);
    }

    // Validate contract inputs (advisory logging — don't block on warnings)
    if (skillContract) {
      const validation = validateContract(skillContract, pipelineEnv);
      if (!validation.valid) {
        this.log(
          pipeline.featureId,
          `contract:missing:${role}`,
          `Missing required inputs: ${validation.missing.join(", ")}`,
        );
      }
      for (const warning of validation.warnings) {
        this.log(pipeline.featureId, `contract:info:${role}`, warning);
      }
    }

    // Create worktree for isolation (if worktree manager available)
    let agentCwd = pipeline.localPath;
    let worktreePath: string | undefined;
    let branchName: string | undefined;

    if (this.worktrees) {
      branchName = this.worktrees.branchName(pipeline.featureId, role);
      try {
        worktreePath = await this.worktrees.create(pipeline.localPath, branchName);
        agentCwd = worktreePath;
        // Write role-specific CLAUDE.md to restrict agent behavior
        writeRoleClaudeMd(worktreePath, role, {
          storiesPath: resolvedStoriesPath,
          archPath,
        }, usingSkill);
        this.log(
          pipeline.featureId,
          `worktree:created:${role}`,
          `Worktree at ${worktreePath} with ${role} CLAUDE.md`,
        );
      } catch (err) {
        // Clean up leftover directory from failed worktree creation
        worktreePath = undefined;
        branchName = undefined;
        agentCwd = pipeline.localPath;
        try {
          const { rmSync, existsSync } = await import("node:fs");
          const worktreeDir = `${pipeline.localPath}/.hog-worktrees`;
          if (existsSync(worktreeDir)) {
            const { readdirSync } = await import("node:fs");
            const entries = readdirSync(worktreeDir);
            if (entries.length === 0) {
              rmSync(worktreeDir, { recursive: true, force: true });
            }
          }
        } catch {
          // best-effort cleanup
        }
      }
    }

    // Capture test baseline before impl runs (for diff-based GREEN verification)
    if (role === "impl" && !this.testBaselines.has(pipeline.featureId)) {
      try {
        const { captureTestBaseline } = await import("./tdd-enforcement.js");
        const baselineCwd = pipeline.context?.workingDir
          ? join(pipeline.localPath, pipeline.context.workingDir)
          : pipeline.localPath;
        const baseline = await captureTestBaseline(baselineCwd, pipeline.context?.testCommand);
        this.testBaselines.set(pipeline.featureId, baseline);
        this.log(
          pipeline.featureId,
          "tdd:baseline-captured",
          `Test baseline: ${baseline.totalFailing} pre-existing failures in ${baseline.failingFiles.size} files`,
        );
      } catch {
        // best-effort — GREEN will still work without baseline
      }
    }

    // Resolve model from config for this role
    let roleModel = this.config.pipeline?.models?.[role];

    // Enforce redteam model divergence — prevents mode collapse (Andrew Ng)
    if (role === "redteam" && roleModel) {
      const implModel = this.config.pipeline?.models?.impl;
      if (implModel && roleModel === implModel) {
        // Use a different model to prevent shared blind spots
        roleModel = implModel.includes("opus") ? "claude-sonnet-4-6" : "claude-opus-4-6";
        this.log(
          pipeline.featureId,
          "model:divergence",
          `Redteam model same as impl (${implModel}) — switched to ${roleModel} to prevent mode collapse`,
        );
      }
    }

    // Spawn the agent
    const result = this.agentManager.launchAgent({
      localPath: agentCwd,
      repoFullName: pipeline.repo,
      issueNumber: 0,
      issueTitle: `[${roleConfig.label}] ${pipeline.title}`,
      issueUrl: "",
      phase: role,
      promptTemplate: prompt,
      model: roleModel,
      permissionMode: this.config.pipeline?.permissionMode,
      env: pipelineEnv,
      parallelSuffix: parallelIndex !== undefined ? String(parallelIndex) : undefined,
    });

    if (typeof result === "string") {
      // Track worktree for this session so we can submit to refinery on completion
      if (worktreePath && branchName) {
        this.sessionWorktrees.set(result, {
          worktreePath,
          branch: branchName,
          repoPath: pipeline.localPath,
        });
      }
      // Map session to pipeline for correct completion routing
      this.sessionToPipeline.set(result, pipeline.featureId);
      this.persistSessionMaps();
      pipeline.activePhase = role;
      this.log(
        pipeline.featureId,
        `agent:spawned:${role}`,
        `Spawned ${roleConfig.label} agent (session: ${result}) for bead ${bead.id}`,
      );
    } else {
      this.log(
        pipeline.featureId,
        `agent:spawn-failed:${role}`,
        `Failed to spawn ${roleConfig.label}: ${result.error}`,
      );
      // Clean up worktree on spawn failure
      if (worktreePath && this.worktrees) {
        this.worktrees.remove(pipeline.localPath, worktreePath).catch(() => {});
      }
      // Unblock the bead so it can be retried
      try {
        await this.beads.updateStatus(pipeline.localPath, bead.id, "open");
      } catch {
        // best-effort
      }
    }
  }

  /** Launch an interactive brainstorm session in tmux. */
  private async launchBrainstormSession(pipeline: Pipeline, bead: Bead): Promise<void> {
    // Claim the bead
    try {
      await this.beads.claim(pipeline.localPath, bead.id);
    } catch {
      return; // Already claimed
    }

    const slug = pipeline.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const { prompt: resolvedBrainstormPrompt, usingSkill: brainstormUsingSkill } = resolvePromptForRole("brainstorm");
    const prompt = brainstormUsingSkill
      ? resolvedBrainstormPrompt
      : resolvedBrainstormPrompt
          .replace(/\{title\}/g, pipeline.title)
          .replace(/\{slug\}/g, slug)
          .replace(/\{spec\}/g, bead.description ?? pipeline.title)
          .replace(/\{featureId\}/g, pipeline.featureId);

    const result = launchClaude({
      localPath: pipeline.localPath,
      issue: { number: 0, title: pipeline.title, url: "" },
      promptTemplate: prompt,
    });

    if (result.ok) {
      pipeline.activePhase = "brainstorm";
      this.log(
        pipeline.featureId,
        "brainstorm:launched",
        `Interactive brainstorm session opened for bead ${bead.id}`,
      );
    } else {
      this.log(
        pipeline.featureId,
        "brainstorm:failed",
        `Failed to launch brainstorm: ${result.error.message}`,
      );
      // Unblock the bead so it can be retried
      try {
        await this.beads.updateStatus(pipeline.localPath, bead.id, "open");
      } catch {
        // best-effort
      }
    }
  }

  // syncCompletedBeads removed — replaced by healPipeline()

  /** Check if all pipeline beads are closed. */
  private async checkPipelineCompletion(pipeline: Pipeline): Promise<void> {
    try {
      const allIds = Object.values(pipeline.beadIds);
      let allClosed = true;
      for (const id of allIds) {
        const bead = await this.beads.show(pipeline.localPath, id);
        if (bead.status !== "closed") {
          allClosed = false;
          break;
        }
      }

      if (allClosed) {
        pipeline.status = "completed";
        pipeline.completedAt = new Date().toISOString();
        this.store.save();
        this.log(
          pipeline.featureId,
          "pipeline:completed",
          `Pan Galactic Gargle Blaster served. ${pipeline.title} is ready to merge.`,
        );
      }
    } catch {
      // Beads query failed, skip completion check
    }
  }

  // ── Event Handlers ──

  private async onAgentCompleted(
    sessionId: string,
    _repo: string,
    _issueNumber: number,
    phase: string,
    summary?: string,
  ): Promise<void> {
    // Find the specific pipeline this session belongs to
    const featureId = this.sessionToPipeline.get(sessionId);
    const pipeline = featureId ? this.store.get(featureId) : undefined;
    if (!pipeline) return;

    const beadId = this.roleToBeadId(pipeline, phase as PipelineRole);
    if (!beadId) return;

    this.sessionToPipeline.delete(sessionId);

    // Capture worktree info now — submission to refinery deferred until gates pass
    const worktreeInfo = this.sessionWorktrees.get(sessionId);
    this.persistSessionMaps();

    // Check if this is a parallel agent — don't close bead until all are done
    const pending = this.pendingParallelAgents.get(beadId);
    if (pending !== undefined && pending > 1) {
      this.pendingParallelAgents.set(beadId, pending - 1);
      this.log(
        pipeline.featureId,
        `parallel:agent-done:${phase}`,
        `Parallel agent completed (${pending - 1} remaining)`,
      );
      return; // Don't close bead yet — wait for all agents
    }
    // Last parallel agent (or single agent) — close the bead
    if (pending !== undefined) {
      this.pendingParallelAgents.delete(beadId);
    }

    // ── Pre-close gates (run BEFORE closing the bead) ──

    // Gate: Summary sentiment — exit 0 ≠ success
    const sentiment = checkSummaryForFailure(summary, phase as PipelineRole);
    if (sentiment.failed) {
      this.log(
        pipeline.featureId,
        `gate:summary-sentiment:blocked`,
        `Agent said "${sentiment.matchedPattern}" — escalating to human`,
      );
      const result = enqueueQuestion(this.questionQueue, {
        featureId: pipeline.featureId,
        question: `${PIPELINE_ROLES[phase as PipelineRole]?.label ?? phase} agent reported: "${summary?.slice(0, 200)}". What should we do?`,
        options: ["Retry this phase", "Continue anyway", "Cancel pipeline"],
        source: "conductor",
        ...(summary ? { context: summary.slice(0, 500) } : {}),
      });
      this.questionQueue = result.queue;
      saveQuestionQueue(this.questionQueue);
      pipeline.status = "blocked";
      this.store.save();
      return; // Don't close the bead — wait for human decision
    }

    // Gate: Story coverage — after test phase, check >25% stories are covered
    if (phase === "test" && pipeline.storiesPath) {
      try {
        const traceability = await checkTraceability(pipeline.localPath, pipeline.storiesPath);
        const skipped = pipeline.context?.skippedStories ?? [];
        const adjustedTotal = traceability.coveredStories.length + traceability.uncoveredStories.length - skipped.length;
        const uncoveredCount = traceability.uncoveredStories.filter((s) => !skipped.includes(s)).length;

        if (adjustedTotal > 0 && uncoveredCount / adjustedTotal > 0.25) {
          const retryAttempt = (pipeline.context?.retryFeedback?.["test"]?.attempt ?? 0) + 1;
          if (retryAttempt <= 2) {
            if (!pipeline.context) pipeline.context = {};
            if (!pipeline.context.retryFeedback) pipeline.context.retryFeedback = {};
            pipeline.context.retryFeedback["test"] = {
              reason: `Story coverage: ${traceability.coveredStories.length}/${adjustedTotal} stories covered (${Math.round((1 - uncoveredCount / adjustedTotal) * 100)}%)`,
              missing: traceability.uncoveredStories.filter((s) => !skipped.includes(s)).slice(0, 20),
              previousSummary: summary?.slice(0, 300) ?? "",
              attempt: retryAttempt,
            };
            this.log(
              pipeline.featureId,
              "gate:story-coverage:failed",
              `${uncoveredCount}/${adjustedTotal} stories uncovered — reopening test phase (attempt ${retryAttempt}/2)`,
            );
            this.store.save();
            await this.beads.updateStatus(pipeline.localPath, beadId, "open").catch(() => {});
            return; // Don't close — retry
          }
          // Max retries — escalate to human
          this.log(pipeline.featureId, "gate:story-coverage:exhausted", "Max retries reached. Escalating.");
          const escResult = enqueueQuestion(this.questionQueue, {
            featureId: pipeline.featureId,
            question: `Test writer covered only ${traceability.coveredStories.length}/${adjustedTotal} stories after 2 attempts. Missing: ${traceability.uncoveredStories.slice(0, 5).join(", ")}`,
            options: ["Retry tests", "Continue with partial coverage", "Cancel pipeline"],
            source: "conductor",
          });
          this.questionQueue = escResult.queue;
          saveQuestionQueue(this.questionQueue);
          pipeline.status = "blocked";
          this.store.save();
          return;
        }
      } catch {
        // Traceability check failed — proceed (don't block on check failure)
      }
    }

    // Gate: Stub detection — after impl, block if >5% stubs
    if (phase === "impl") {
      try {
        const stubResult = await this.detectStubs(pipeline.localPath);
        if (stubResult.stubRatio > 0.05) {
          const retryAttempt = (pipeline.context?.retryFeedback?.["impl"]?.attempt ?? 0) + 1;
          if (retryAttempt <= 2) {
            if (!pipeline.context) pipeline.context = {};
            if (!pipeline.context.retryFeedback) pipeline.context.retryFeedback = {};
            pipeline.context.retryFeedback["impl"] = {
              reason: `Stub detection: ${Math.round(stubResult.stubRatio * 100)}% of files appear to be scaffolding`,
              missing: stubResult.stubFiles.slice(0, 20),
              previousSummary: summary?.slice(0, 300) ?? "",
              attempt: retryAttempt,
            };
            this.log(
              pipeline.featureId,
              "gate:stub-detection:failed",
              `${Math.round(stubResult.stubRatio * 100)}% stubs detected — reopening impl (attempt ${retryAttempt}/2)`,
            );
            this.store.save();
            await this.beads.updateStatus(pipeline.localPath, beadId, "open").catch(() => {});
            return;
          }
          // Max retries exhausted — escalate to human
          this.log(pipeline.featureId, "gate:stub-detection:exhausted", "Max retries reached. Escalating.");
          const stubEscResult = enqueueQuestion(this.questionQueue, {
            featureId: pipeline.featureId,
            question: `Implementation still has ${Math.round(stubResult.stubRatio * 100)}% stubs after 2 attempts. Files: ${stubResult.stubFiles.slice(0, 5).join(", ")}`,
            options: ["Retry impl", "Continue with stubs", "Cancel pipeline"],
            source: "conductor",
          });
          this.questionQueue = stubEscResult.queue;
          saveQuestionQueue(this.questionQueue);
          pipeline.status = "blocked";
          this.store.save();
          return;
        }
      } catch {
        // best-effort
      }
    }

    // Submit to refinery AFTER all gates pass (not before)
    if (worktreeInfo && this.refinery) {
      const mergeId = this.refinery.submit(
        pipeline.featureId,
        worktreeInfo.branch,
        worktreeInfo.worktreePath,
        worktreeInfo.repoPath,
        phase,
      );
      this.log(
        pipeline.featureId,
        `refinery:submitted:${phase}`,
        `Branch ${worktreeInfo.branch} submitted to merge queue (${mergeId})`,
      );
      this.sessionWorktrees.delete(sessionId);
    }

    // Close the bead (all pre-close gates passed)
    this.beads
      .close(pipeline.localPath, beadId, `Completed by ${phase} agent`)
      .then(async () => {
        pipeline.completedBeads = Math.min(7, pipeline.completedBeads + 1);
        const phaseLabel = PIPELINE_ROLES[phase as PipelineRole]?.label ?? phase;
        // Strip session markers (from user's CLAUDE.md) from agent summary
        const cleanSummary = summary
          ?.split("\n")
          .filter((l) => !l.includes("═══") && !l.includes("──~") && !l.includes("── ·") && !l.includes("── !") && !l.includes("── ✓") && !l.includes("Gargle Blaster"))
          .join(" ")
          .trim();
        const summaryLine = cleanSummary
          ? ` — ${cleanSummary.slice(0, 150)}`
          : "";
        this.log(
          pipeline.featureId,
          `phase:completed:${phase}`,
          `${phaseLabel} done (${pipeline.completedBeads}/7)${summaryLine}`,
        );

        // Store phase summary in pipeline context
        if (!pipeline.context) {
          pipeline.context = {};
        }
        if (!pipeline.context.phaseSummaries) {
          pipeline.context.phaseSummaries = {};
        }
        if (summary) {
          pipeline.context.phaseSummaries[phase] = summary.slice(0, 500);
        }

        // Store contract outputs for downstream phase wiring
        const phaseRole = phase as PipelineRole;
        const phaseContract = getSkillContract(PIPELINE_ROLES[phaseRole]?.skill ?? "");
        if (phaseContract && Object.keys(phaseContract.outputs).length > 0) {
          const slug = pipeline.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          const outputs = resolveOutputPaths(phaseContract, { slug });
          if (!pipeline.context.pipelineOutputs) {
            pipeline.context.pipelineOutputs = {};
          }
          // Only store outputs that actually exist on disk
          const { existsSync: fileExists } = await import("node:fs");
          for (const [name, filePath] of Object.entries(outputs)) {
            const fullPath = join(pipeline.localPath, filePath);
            if (fileExists(fullPath)) {
              pipeline.context.pipelineOutputs[name] = filePath;
            } else {
              this.log(
                pipeline.featureId,
                `contract:output-missing:${phase}`,
                `Expected output ${name} at ${filePath} not found — downstream skills will search`,
              );
            }
          }
        }

        // After test phase: detect test command and clean up parallel files
        if (phase === "test") {
          await this.captureTestContext(pipeline);
          const { cleanupParallelFiles } = await import("./story-splitter.js");
          cleanupParallelFiles(pipeline.localPath);
        }

        // GREEN verification after impl completes (Farley)
        // Uses baseline comparison — only NEW failures count, pre-existing ones are ignored
        if (phase === "impl") {
          const { verifyGreenState } = await import("./tdd-enforcement.js");
          const baseline = this.testBaselines.get(pipeline.featureId);
          const greenCwd = pipeline.context?.workingDir
            ? join(pipeline.localPath, pipeline.context.workingDir)
            : pipeline.localPath;
          const green = await verifyGreenState(greenCwd, { baseline, testCommand: pipeline.context?.testCommand }).catch(() => ({
            passed: true,
            detail: "GREEN check failed to run — skipping",
          }));
          if (!green.passed) {
            // Track green failures to prevent infinite loops
            const greenRetries = this.decisionLog.filter(
              (e) => e.featureId === pipeline.featureId && e.action === "tdd:green-failed",
            ).length;
            if (greenRetries < 2) {
              this.log(pipeline.featureId, "tdd:green-failed", `${green.detail} (attempt ${greenRetries + 1}/2)`);
              await this.beads.updateStatus(pipeline.localPath, beadId, "open").catch(() => {});
              pipeline.completedBeads = Math.max(0, pipeline.completedBeads - 1);
              return;
            }
            // Max green retries exhausted — escalate to human
            this.log(pipeline.featureId, "tdd:green-exhausted", "Tests still failing after 2 impl retries. Escalating.");
            const greenEscResult = enqueueQuestion(this.questionQueue, {
              featureId: pipeline.featureId,
              question: `Tests still failing after 2 impl attempts. Failures: ${green.detail.slice(0, 200)}`,
              options: ["Retry impl", "Skip green check", "Cancel pipeline"],
              source: "conductor",
            });
            this.questionQueue = greenEscResult.queue;
            saveQuestionQueue(this.questionQueue);
            pipeline.status = "blocked";
            this.store.save();
            return;
          }
          this.log(pipeline.featureId, "tdd:green-verified", green.detail);

          // Stub detection gate — warn if implementation looks like scaffolding
          try {
            const stubResult = await this.detectStubs(pipeline.localPath);
            if (stubResult.stubRatio > 0.3) {
              this.log(
                pipeline.featureId,
                "quality:stub-warning",
                `${Math.round(stubResult.stubRatio * 100)}% of changed files appear to be scaffolding (${stubResult.stubFiles.join(", ")}). Redteam should catch this.`,
              );
            } else if (stubResult.stubFiles.length > 0) {
              this.log(
                pipeline.featureId,
                "quality:stub-info",
                `${stubResult.stubFiles.length} file(s) with stub patterns detected: ${stubResult.stubFiles.join(", ")}`,
              );
            }
          } catch {
            // best-effort — don't block pipeline on detection failure
          }
        }

        // Redteam→impl feedback loop (Farley)
        // After redteam, check if new tests are failing. If so, re-open impl.
        if (phase === "redteam") {
          const { verifyGreenState } = await import("./tdd-enforcement.js");
          const baseline = this.testBaselines.get(pipeline.featureId);
          const greenCwd = pipeline.context?.workingDir
            ? join(pipeline.localPath, pipeline.context.workingDir)
            : pipeline.localPath;
          const green = await verifyGreenState(greenCwd, { baseline, testCommand: pipeline.context?.testCommand }).catch(() => ({
            passed: true,
            detail: "GREEN check failed to run — skipping",
          }));
          if (!green.passed) {
            // Track redteam→impl iterations to prevent infinite loops
            const implRetries = this.decisionLog.filter(
              (e) => e.featureId === pipeline.featureId && e.action === "redteam:impl-loop",
            ).length;
            if (implRetries < 2) {
              this.log(
                pipeline.featureId,
                "redteam:impl-loop",
                `Redteam wrote failing tests — re-opening impl (attempt ${implRetries + 1}/2)`,
              );
              // Re-open impl AND merge so merge doesn't run while impl is re-doing work
              const implBeadId = pipeline.beadIds.impl;
              const mergeBeadId = pipeline.beadIds.merge;
              await this.beads.updateStatus(pipeline.localPath, implBeadId, "open").catch(() => {});
              await this.beads.updateStatus(pipeline.localPath, mergeBeadId, "open").catch(() => {});
              pipeline.completedBeads = Math.max(0, pipeline.completedBeads - 2);
              return; // Don't proceed — impl needs to fix the new failures
            }
            // Max iterations reached — escalate to human
            this.log(
              pipeline.featureId,
              "redteam:impl-loop-exhausted",
              "Max redteam→impl iterations reached. Escalating to human.",
            );
            const result = enqueueQuestion(this.questionQueue, {
              featureId: pipeline.featureId,
              question: `Red team found issues that impl couldn't fix after 2 attempts. Manual intervention needed.`,
              options: ["Retry impl", "Skip redteam issues", "Cancel pipeline"],
              source: "conductor",
            });
            this.questionQueue = result.queue;
            saveQuestionQueue(this.questionQueue);
            pipeline.status = "blocked";
            this.store.save();
          }
        }

        // Merge→impl feedback loop
        // After merge review, if agent reports BLOCK, re-invoke impl to fix issues
        if (phase === "merge") {
          const mergeBlocked = summary?.includes("BLOCK") || summary?.includes("FAIL");
          if (mergeBlocked) {
            const mergeRetries = this.decisionLog.filter(
              (e) => e.featureId === pipeline.featureId && e.action === "merge:impl-loop",
            ).length;
            if (mergeRetries < 2) {
              this.log(
                pipeline.featureId,
                "merge:impl-loop",
                `Merge review blocked — re-opening impl (attempt ${mergeRetries + 1}/2)`,
              );
              // Re-open impl bead so it can fix the issues
              const implBeadId = pipeline.beadIds.impl;
              await this.beads.updateStatus(pipeline.localPath, implBeadId, "open").catch(() => {});
              // Re-open merge bead too so it re-runs after impl fixes
              await this.beads.updateStatus(pipeline.localPath, beadId, "open").catch(() => {});
              pipeline.completedBeads = Math.max(0, pipeline.completedBeads - 2);

              // Inject merge review findings as retry context for impl
              if (!pipeline.context) pipeline.context = {};
              if (!pipeline.context.retryFeedback) pipeline.context.retryFeedback = {};
              pipeline.context.retryFeedback["impl"] = {
                reason: "Merge review reported BLOCK. Fix the issues and make all tests pass.",
                missing: [],
                previousSummary: summary?.slice(0, 300) ?? "",
                attempt: (pipeline.context.retryFeedback["impl"]?.attempt ?? 0) + 1,
              };
              this.store.save();
              return; // Don't proceed — impl needs to fix first
            }
            // Max iterations reached — escalate to human
            this.log(
              pipeline.featureId,
              "merge:impl-loop-exhausted",
              "Max merge→impl iterations reached. Escalating to human.",
            );
            const mergeEscResult = enqueueQuestion(this.questionQueue, {
              featureId: pipeline.featureId,
              question: `Merge review blocked after 2 impl retries. Manual intervention needed. Last review: ${summary?.slice(0, 200)}`,
              options: ["Retry impl", "Force merge", "Cancel pipeline"],
              source: "conductor",
            });
            this.questionQueue = mergeEscResult.queue;
            saveQuestionQueue(this.questionQueue);
            pipeline.status = "blocked";
            this.store.save();
          }
        }

        // Notify GitHub sync (if configured)
        if (this.onPhaseCompleted) {
          const { findGitHubIssue, loadBeadsSyncState } = await import("./beads-sync.js");
          const syncState = loadBeadsSyncState();
          const linked = findGitHubIssue(syncState, pipeline.featureId);
          if (linked) {
            await this.onPhaseCompleted(pipeline, phase, linked.repo, linked.issueNumber).catch(
              () => {
                // best-effort — GitHub sync never blocks pipeline
              },
            );
          }
        }
      })
      .catch(() => {
        // best-effort
      });
  }

  private onAgentFailed(
    sessionId: string,
    _repo: string,
    _issueNumber: number,
    phase: string,
    exitCode: number,
    errorMessage?: string,
  ): void {
    // Clean up worktree for failed agent
    const worktreeInfo = this.sessionWorktrees.get(sessionId);
    if (worktreeInfo && this.worktrees) {
      this.worktrees.remove(worktreeInfo.repoPath, worktreeInfo.worktreePath).catch(() => {});
      this.sessionWorktrees.delete(sessionId);
    }

    // Find the specific pipeline this session belongs to
    const featureId = this.sessionToPipeline.get(sessionId);
    this.sessionToPipeline.delete(sessionId);
    this.persistSessionMaps();

    const matchedPipelines = featureId
      ? ([this.store.get(featureId)].filter(Boolean) as Pipeline[])
      : this.store.getAll(); // fallback for sessions without mapping

    for (const pipeline of matchedPipelines) {
      const beadId = this.roleToBeadId(pipeline, phase as PipelineRole);
      if (!beadId) continue;

      const errorDetail = errorMessage || `Process exited with code ${exitCode}`;

      const phaseLabel = PIPELINE_ROLES[phase as PipelineRole]?.label ?? phase;
      const failureCount = this.decisionLog.filter(
        (e) => e.featureId === pipeline.featureId && e.action === `agent:failed:${phase}`,
      ).length + 1; // +1 for current failure

      this.log(
        pipeline.featureId,
        `agent:failed:${phase}`,
        `${phaseLabel} failed (attempt ${failureCount}/3): ${errorDetail.slice(0, 200)}`,
      );

      // Detect rate limit errors — pause pipeline instead of burning retries
      const isRateLimit =
        errorDetail.includes("out of extra usage") ||
        errorDetail.includes("rate limit") ||
        errorDetail.includes("resets ") ||
        errorDetail.includes("429");
      if (isRateLimit) {
        pipeline.status = "paused";
        this.store.save();
        this.log(
          pipeline.featureId,
          "pipeline:rate-limited",
          `Paused — API rate limit hit. Resume when usage resets: ${errorDetail.match(/resets\s+\S+/)?.[0] ?? "check your plan"}`,
        );
        return;
      }

      // Mark bead as open so it can be retried on next tick
      this.beads.updateStatus(pipeline.localPath, beadId, "open").catch(() => {
        // best-effort
      });

      if (pipeline.status === "blocked") return; // already blocked, don't add more questions

      if (failureCount < 3) {
        // Auto-retry with message — next tick will pick up the open bead
        this.log(
          pipeline.featureId,
          `agent:retry:${phase}`,
          `${phaseLabel} will retry automatically on next tick (~10s)`,
        );
        return;
      }

      // 3+ failures — escalate to human
      const existingQuestion = this.questionQueue.questions.find(
        (q) => q.featureId === pipeline.featureId && !q.resolvedAt && q.question.includes(phase),
      );
      if (existingQuestion) return;

      const result = enqueueQuestion(this.questionQueue, {
        featureId: pipeline.featureId,
        question: `${phaseLabel} has failed ${failureCount} times for "${pipeline.title}". What should I do?`,
        options: ["Retry", "Skip phase", "Stop pipeline"],
        source: "conductor",
      });
      this.questionQueue = result.queue;
      saveQuestionQueue(this.questionQueue);
      pipeline.status = "blocked";
      this.store.save();
      this.log(
        pipeline.featureId,
        "pipeline:blocked",
        `${phaseLabel} failed ${failureCount} times — waiting for your decision`,
      );
    }
  }

  // ── Helpers ──

  private roleToBeadId(pipeline: Pipeline, role: PipelineRole): string | undefined {
    switch (role) {
      case "brainstorm":
        return pipeline.beadIds.brainstorm;
      case "stories":
        return pipeline.beadIds.stories;
      case "scaffold":
        return pipeline.beadIds.scaffold;
      case "test":
        return pipeline.beadIds.tests;
      case "impl":
        return pipeline.beadIds.impl;
      case "redteam":
        return pipeline.beadIds.redteam;
      case "merge":
        return pipeline.beadIds.merge;
      default:
        return undefined;
    }
  }

  private log(featureId: string, action: string, detail: string): void {
    this.decisionLog.push({
      timestamp: new Date().toISOString(),
      featureId,
      action,
      detail,
    });
  }
}
