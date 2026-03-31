import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchClaude } from "../board/launch-claude.js";
import type { HogConfig, RepoConfig } from "../config.js";
import { buildBrainstormLaunchContext } from "./brainstorm-context.js";
import { detectStack as detectStackSync } from "./stack-detection.js";
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
import type { EscalationAction, RetryAction } from "./retry-engine.js";
import { evaluateGate, GATE_CONFIGS } from "./retry-engine.js";
import { writeRoleClaudeMd } from "./role-context.js";
import type { PipelineRole } from "./roles.js";
import { beadToRole, PIPELINE_ROLES, resolvePromptForRole } from "./roles.js";
import {
  getSkillContract,
  resolveOutputPaths,
  validateContract,
  wirePhaseInputs,
} from "./skill-contract.js";
import { checkSummaryForFailure } from "./summary-parser.js";
import { checkTraceability, verifyRedState } from "./tdd-enforcement.js";
import type { WorktreeManager } from "./worktree.js";

// Gate config lookup by ID for quick access in runGate()
const GATE_CONFIGS_LOOKUP = Object.fromEntries(GATE_CONFIGS.map((g) => [g.id, g]));

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
  readonly beadIds: Record<string, string>;
  status: PipelineStatus;
  /** Number of completed (closed) beads. Updated by conductor tick. */
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
// Gate evaluation is handled by evaluateGate() — conductor applies the side effects.

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
  /** Detected stack framework (cached from first detection). */
  stackInfo?: string | undefined;
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
  private readonly testBaselines: Map<string, import("./tdd-enforcement.js").TestBaseline> =
    new Map();
  private questionQueue: QuestionQueue;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Pipelines currently processing agent completion — tick() skips them to prevent races. */
  private readonly completionInProgress: Set<string> = new Set();
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

      this.log(pipeline.featureId, `refinery:merged:${event.role ?? "unknown"}`, event.description);
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

    // Collect active bead IDs from running pipelines to protect from orphan cleanup
    const activeBeadIds = new Set<string>();
    for (const p of this.store.getAll()) {
      if (p.status !== "completed" && p.status !== "failed") {
        for (const id of Object.values(p.beadIds)) {
          if (id) activeBeadIds.add(id);
        }
      }
    }

    // Create the feature DAG in Beads (retry once — Dolt may need a moment after start)
    let dag: Awaited<ReturnType<typeof this.beads.createFeatureDAG>>;
    try {
      dag = await this.beads.createFeatureDAG(repoConfig.localPath, title, description, undefined, activeBeadIds);
    } catch (firstErr) {
      // Retry once after a short wait — Dolt server may still be starting
      this.log("", "beads:retry", "First DAG creation failed, retrying after 2s...");
      await new Promise((r) => setTimeout(r, 2_000));
      try {
        await this.beads.ensureDoltRunning(repoConfig.localPath);
        dag = await this.beads.createFeatureDAG(repoConfig.localPath, title, description, undefined, activeBeadIds);
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
      beadIds: Object.fromEntries(
        Object.entries(dag).map(([key, bead]) => [key, bead.id]),
      ),
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

  private tickRunning = false;

  /** One tick of the conductor — check all running pipelines for ready work. */
  private async tick(): Promise<void> {
    if (this.stopped) return;
    // Prevent re-entrant ticks — setInterval can fire while previous tick is still running
    if (this.tickRunning) return;
    this.tickRunning = true;

    try {
      await this.tickInner();
    } catch (err) {
      console.error(`[conductor] Tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.tickRunning = false;
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
    // Skip pipelines with ongoing agent completion — prevents reopening beads mid-completion
    if (this.completionInProgress.has(pipeline.featureId)) return;

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
        // Data-driven: iterate over pipeline's actual bead keys
        let nextPhase: string | undefined;
        for (const beadKey of Object.keys(pipeline.beadIds)) {
          const role = beadKey === "tests" ? "test" : beadKey;
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
        if (!hasAgent) {
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
  private getActiveAgentsForPipeline(
    featureId: string,
  ): Array<{ sessionId: string; phase: string }> {
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
    let hasContext = false;

    // impl, redteam, merge, ship need test context
    if ((role === "impl" || role === "redteam" || role === "merge" || role === "ship") && ctx.testCommand) {
      if (!hasContext) { lines.push(""); lines.push("<prior_stage_context>"); hasContext = true; }
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

    // impl, redteam, and ship get summaries from earlier phases
    if ((role === "impl" || role === "redteam" || role === "ship") && ctx.phaseSummaries) {
      if (!hasContext) { lines.push(""); lines.push("<prior_stage_context>"); hasContext = true; }
      const relevantPhases = role === "impl" ? ["test"] : role === "redteam" ? ["test", "impl"] : ["test", "impl", "redteam", "merge"];
      for (const phase of relevantPhases) {
        const summary = ctx.phaseSummaries[phase];
        if (summary) {
          lines.push(`<phase_summary phase="${phase}">${summary.slice(0, 2000)}</phase_summary>`);
        }
      }
    }

    // impl and ship get inline architecture doc content (don't make the agent discover it)
    if ((role === "impl" || role === "ship") && pipeline.architecturePath && existsSync(pipeline.architecturePath)) {
      if (!hasContext) { lines.push(""); lines.push("<prior_stage_context>"); hasContext = true; }
      try {
        const archContent = readFileSync(pipeline.architecturePath, "utf-8").slice(0, 3000);
        lines.push(`<architecture path="${pipeline.architecturePath}">`);
        lines.push(archContent);
        lines.push("</architecture>");
      } catch {
        // Architecture doc not readable — agent will read it from path
      }
    }

    // Stack-aware context for test, impl, and ship roles
    if (role === "test" || role === "impl" || role === "ship") {
      try {
        const stackCwd = ctx?.workingDir
          ? join(pipeline.localPath, ctx.workingDir)
          : pipeline.localPath;
        const stack = detectStackSync(stackCwd);
        if (stack) {
          if (!hasContext) { lines.push(""); lines.push("<prior_stage_context>"); hasContext = true; }
          if (role === "test") {
            lines.push(`<stack_context framework="${stack.framework}">`);
            lines.push(stack.testingGuidance);
            lines.push("</stack_context>");
          } else if (role === "impl") {
            const checks = [
              stack.typecheckCommand ? `- Run \`${stack.typecheckCommand}\` — must pass` : "",
              ...stack.buildCommands.map((c) => `- Run \`${c}\` — must succeed`),
              ...stack.conventionChecks.map((c) => `- ${c.description}`),
            ].filter(Boolean);
            if (checks.length > 0) {
              lines.push(`<build_requirements framework="${stack.framework}">`);
              lines.push("Before finishing, verify:");
              lines.push(...checks);
              lines.push("The build-gate will run these checks automatically after you complete.");
              lines.push("</build_requirements>");
            }
          } else if (role === "ship") {
            lines.push(`<stack_context framework="${stack.framework}" />`);
          }
        }
      } catch {
        // best-effort — stack detection failure shouldn't block context building
      }
    }

    if (hasContext) {
      lines.push("</prior_stage_context>");
    }

    return hasContext ? lines.join("\n") : undefined;
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

    // On retry after gate rejection, recapture — test writer committed new files.
    // On first run with pre-existing testFiles, preserve them.
    const isRetry = pipeline.context.retryFeedback && (
      pipeline.context.retryFeedback["spec-quality"] ??
      pipeline.context.retryFeedback["coverage-gate"]
    );
    if (!isRetry && pipeline.context.testFiles && pipeline.context.testFiles.length > 0) return;

    // 1. Find test files via git diff
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--name-only", "--diff-filter=A", "HEAD~1", "HEAD"],
        {
          cwd,
          encoding: "utf-8",
          timeout: 10_000,
        },
      );
      const newFiles = stdout.trim().split("\n").filter(Boolean);
      const testFiles = newFiles.filter(
        (f) =>
          f.includes("test") ||
          f.endsWith(".test.ts") ||
          f.endsWith(".test.py") ||
          f.endsWith("_test.py") ||
          f.endsWith("_test.go"),
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
        [
          cwd,
          "-maxdepth",
          "4",
          "-name",
          "vitest.config.*",
          "-o",
          "-name",
          "jest.config.*",
          "-o",
          "-name",
          "pytest.ini",
          "-o",
          "-name",
          "pyproject.toml",
          "-o",
          "-name",
          "Cargo.toml",
          "-o",
          "-name",
          "go.mod",
        ],
        { cwd, encoding: "utf-8", timeout: 10_000 },
      );
      const configFiles = stdout.trim().split("\n").filter(Boolean);

      for (const configFile of configFiles) {
        const relDir = configFile
          .replace(cwd + "/", "")
          .split("/")
          .slice(0, -1)
          .join("/");
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
    const beadId = pipeline.beadIds["tests"];
    if (!beadId) return;
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
  private async detectStubs(cwd: string): Promise<{ stubRatio: number; stubFiles: string[] }> {
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
      changedFiles = stdout
        .trim()
        .split("\n")
        .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
    } catch {
      // No commits or git error — check unstaged changes
      try {
        const { stdout } = await execFileAsync("git", ["diff", "--name-only"], {
          cwd,
          encoding: "utf-8",
          timeout: 10_000,
        });
        changedFiles = stdout
          .trim()
          .split("\n")
          .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
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
    // Skip pipelines with ongoing agent completion — prevents race conditions where
    // tick sees reopened beads before onAgentCompleted finishes gate processing
    if (this.completionInProgress.has(pipeline.featureId)) return;

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

    // Only spawn one agent per pipeline at a time — prevents merge+impl from
    // running simultaneously after a gate reopens both beads
    const hasRunningAgent = this.agentManager
      .getAgents()
      .some((a) => a.monitor.isRunning && this.sessionToPipeline.get(a.sessionId) === pipeline.featureId);
    if (hasRunningAgent) return;

    for (const bead of pipelineReady) {
      // Skip beads already being worked on
      if (bead.status === "in_progress") continue;

      // Use pipeline.beadIds reverse lookup instead of title parsing (Cherny)
      const role = beadIdToRole[bead.id] ?? beadToRole(bead);
      if (!role) continue;

      // Parallelism is handled by the agent itself (via Claude Code's Agent tool),
      // not by the orchestrator. One agent per phase, all stories.

      await this.spawnForRole(pipeline, bead, role);
    }

    // Check if all beads are closed → pipeline complete
    await this.checkPipelineCompletion(pipeline);
  }

  /** Spawn an agent for a specific role. */
  private async spawnForRole(pipeline: Pipeline, bead: Bead, role: PipelineRole): Promise<void> {
    const roleConfig = PIPELINE_ROLES[role];

    this.log(
      pipeline.featureId,
      `agent:preparing:${role}`,
      `Preparing to spawn ${roleConfig.label}`,
    );

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
        await this.beads.close(
          pipeline.localPath,
          bead.id,
          "Stories already written by brainstorm",
        );
        pipeline.completedBeads = Math.min(Object.keys(pipeline.beadIds).length, pipeline.completedBeads + 1);
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

        // Escalation ceiling: after 5 RED failures, ask human instead of looping forever
        const redFailCount = this.decisionLog.filter(
          (e) => e.featureId === pipeline.featureId && e.action === "tdd:red-failed",
        ).length;
        if (redFailCount >= 5) {
          this.log(pipeline.featureId, "tdd:red-exhausted", "Test writer keeps producing passing tests after 5 attempts. Escalating.");
          const result = enqueueQuestion(this.questionQueue, {
            featureId: pipeline.featureId,
            question: `Test writer has produced passing tests 5 times — tests should FAIL before implementation. What should we do?`,
            options: ["Retry tests", "Skip RED check", "Cancel pipeline"],
            source: "conductor",
          });
          this.questionQueue = result.queue;
          saveQuestionQueue(this.questionQueue);
          pipeline.status = "blocked";
          this.store.save();
          return;
        }

        // Re-open the test bead so tests get rewritten
        try {
          const testBeadId = pipeline.beadIds["tests"];
          if (testBeadId) await this.beads.updateStatus(pipeline.localPath, testBeadId, "open");
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
          const traceStoriesPath =
            pipeline.storiesPath ?? join(pipeline.localPath, "docs", "stories");
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

    // Claim the bead
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
      pipeline.architecturePath ?? resolvedStoriesPath.replace(/\.md$/, ".architecture.md");

    // Resolve prompt: skill invocation (if toolkit installed) or fallback prompt
    const { prompt: resolvedPrompt, usingSkill } = resolvePromptForRole(role);

    let basePrompt: string;
    if (usingSkill) {
      // Skill prompt: slash command + explicit context in the prompt itself.
      // Env vars alone are unreliable — the agent may not check them.
      // Putting paths directly in the prompt ensures the skill sees them.
      const implPlanStep = role === "impl"
        ? [
            "",
            "BEFORE running /marvin:work, first:",
            `1. Read the architecture doc at ${archPath}`,
            `2. Read the stories at ${resolvedStoriesPath}`,
            "3. Run the test suite to see all failing tests",
            "4. Write .hog/impl-plan.md — a markdown plan with checkbox tasks grouped by story",
            "   Each task references specific failing tests and architecture constraints.",
            "   Acceptance criteria: All tests pass. No stubs. Architecture conformance verified.",
            "5. Then run: /marvin:work .hog/impl-plan.md",
          ]
        : [];
      basePrompt = [
        resolvedPrompt,
        "",
        `Stories file: ${resolvedStoriesPath}`,
        `Architecture doc: ${archPath}`,
        `Feature: ${pipeline.title}`,
        role === "merge" ? "Mode: merge readiness check (MERGE_CHECK=true)" : "",
        ...implPlanStep,
      ]
        .filter(Boolean)
        .join("\n");
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
    // Merge all feedback entries targeting this role (keyed by gate ID, not role)
    let retrySection = "";
    const allFeedback = pipeline.context?.retryFeedback;
    if (allFeedback) {
      const roleFeedback: RetryFeedback[] = [];
      for (const [key, fb] of Object.entries(allFeedback)) {
        // Match by gate ID → retryRole, or by legacy role key
        const gateConfig = GATE_CONFIGS_LOOKUP[key];
        if (gateConfig?.retryRole === role || key === role) {
          roleFeedback.push(fb);
        }
      }
      if (roleFeedback.length > 0) {
        const maxAttempt = Math.max(...roleFeedback.map((f) => f.attempt));
        const issues = roleFeedback.map((f) => f.reason).join("\n");
        const missing = roleFeedback.flatMap((f) => f.missing).slice(0, 20).join(", ");
        const lastSummary = roleFeedback[roleFeedback.length - 1]?.previousSummary ?? "";
        retrySection = `\n\n## Retry Context (attempt ${maxAttempt})\n\nYour previous run did not complete all required work.\n\nIssues:\n${issues}\nMissing: ${missing}\n\nPrevious output:\n> ${lastSummary.slice(0, 2000)}\n\nUpdate .hog/impl-plan.md with tasks to fix these issues, then run /marvin:work .hog/impl-plan.md\n`;
      }
    }

    // Sanitize retry section — strip potential instruction injection from test output
    const sanitizedRetry = retrySection
      .replace(/<\/?(?:system|instructions|role|constraints|context)>/gi, "[tag-stripped]")
      .replace(/(?:^|\n)#{1,3}\s+(?:System|Instructions|Role|You are)/gim, "[heading-stripped]");
    const prompt = basePrompt + (contextSection ?? "") + sanitizedRetry;

    // Build env vars for skill context using contract-based wiring
    const pipelineEnv: Record<string, string> = {
      STORIES_PATH: resolvedStoriesPath,
      ARCH_PATH: archPath,
      FEATURE_ID: pipeline.featureId,
      HOG_PIPELINE: "1",
    };
    if (role === "merge") {
      pipelineEnv["MERGE_CHECK"] = "true";
    }
    // BRAINSTORM_PATH is handled by contract-based wiring below (wirePhaseInputs).
    // Do NOT set it from phaseSummaries — that's a truncated summary string, not a file path.

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

    const agentCwd = pipeline.localPath;

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
    });

    if (typeof result === "string") {
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

    const { prompt, env: brainstormEnv } = buildBrainstormLaunchContext({
      title: pipeline.title,
      description: pipeline.description ?? bead.description ?? pipeline.title,
      featureId: pipeline.featureId,
      cwd: pipeline.localPath,
    });

    const result = launchClaude({
      localPath: pipeline.localPath,
      issue: { number: 0, title: pipeline.title, url: "" },
      promptTemplate: prompt,
      env: brainstormEnv,
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
          `Pan Galactic Gargle Blaster served. ${pipeline.title} — pipeline complete.`,
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

    // Lock: prevent tick() from spawning agents or healing beads for this pipeline
    // while we process gates and potentially reopen beads for retry.
    // Released in the finally block at the end of this method.
    this.completionInProgress.add(pipeline.featureId);
    try {

    this.sessionToPipeline.delete(sessionId);

    // Capture worktree info now — submission to refinery deferred until gates pass
    const worktreeInfo = this.sessionWorktrees.get(sessionId);
    this.persistSessionMaps();

    // ── Pre-close setup ──

    // Capture test context early — spec-quality gate needs testFiles before bead close
    if (phase === "test") {
      try {
        await this.captureTestContext(pipeline);
      } catch {
        // best-effort — don't block agent completion on context capture failure
      }
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
        const adjustedTotal =
          traceability.coveredStories.length +
          traceability.uncoveredStories.length -
          skipped.length;
        const uncovered = traceability.uncoveredStories.filter((s) => !skipped.includes(s));

        if (adjustedTotal > 0 && uncovered.length / adjustedTotal > 0.25) {
          const blocked = await this.runGate(
            pipeline,
            beadId,
            "coverage-gate",
            {
              passed: false,
              reason: `Story coverage: ${traceability.coveredStories.length}/${adjustedTotal} stories covered (${Math.round((1 - uncovered.length / adjustedTotal) * 100)}%)`,
              missing: uncovered.slice(0, 20),
            },
            summary,
            "retryFeedback",
            "gate:story-coverage:failed",
          );
          if (blocked) return;
        }
      } catch {
        // Traceability check failed — proceed (don't block on check failure)
      }
    }

    // Gate: Spec quality — after test phase, reject string-matching tests
    if (phase === "test") {
      try {
        const testFiles = pipeline.context?.testFiles ?? [];
        if (testFiles.length === 0) {
          this.log(pipeline.featureId, "gate:spec-quality:skipped", "No test files detected — spec-quality gate cannot run. Check captureTestContext.");
        }
        if (testFiles.length > 0) {
          const { analyzeTestQuality } = await import("./tdd-enforcement.js");
          const testCwd = pipeline.context?.workingDir
            ? join(pipeline.localPath, pipeline.context.workingDir)
            : pipeline.localPath;
          const quality = analyzeTestQuality(testFiles, testCwd);
          if (quality.ratio < 0.8 && quality.stringMatching.length > 0) {
            const blocked = await this.runGate(
              pipeline,
              beadId,
              "spec-quality",
              {
                passed: false,
                reason: `${quality.stringMatching.length}/${quality.stringMatching.length + quality.behavioral.length} test files are string-matching (readFileSync+toMatch), not behavioral (import+call). Tests must be tracer bullets that prove the architecture works.`,
                missing: quality.stringMatching.slice(0, 20),
              },
              summary,
              "retryFeedback",
              "gate:spec-quality:failed",
            );
            if (blocked) return;
          }
        }
      } catch {
        // best-effort — don't block on analysis failure
      }
    }

    // Gates: Stub detection + Architecture conformance — run BOTH, aggregate feedback.
    // Running both prevents the agent from fixing stubs only to discover conformance failures
    // on the next loop — it gets the full picture in one pass.
    let implGateBlocked = false;

    // Gate: Stub detection — after impl, block if >5% stubs
    if (phase === "impl") {
      try {
        const stubResult = await this.detectStubs(pipeline.localPath);
        if (stubResult.stubRatio > 0.05) {
          const blocked = await this.runGate(
            pipeline,
            beadId,
            "stub-gate",
            {
              passed: false,
              reason: `Stub detection: ${Math.round(stubResult.stubRatio * 100)}% of files appear to be scaffolding`,
              missing: stubResult.stubFiles.slice(0, 20),
            },
            summary,
            "retryFeedback",
            "gate:stub-detection:failed",
          );
          if (blocked) implGateBlocked = true;
        }
      } catch {
        // best-effort
      }
    }

    // Gate: Architecture conformance — after impl, verify arch doc is realized
    if (phase === "impl" && pipeline.architecturePath) {
      try {
        const { checkArchitectureConformance } = await import("./conformance.js");
        const conformCwd = pipeline.context?.workingDir
          ? join(pipeline.localPath, pipeline.context.workingDir)
          : pipeline.localPath;
        const conformResult = await checkArchitectureConformance(conformCwd, pipeline.architecturePath);
        if (!conformResult.passed) {
          const blocked = await this.runGate(
            pipeline,
            beadId,
            "conform-gate",
            {
              passed: false,
              reason: conformResult.detail,
              missing: [...conformResult.missingDeps, ...conformResult.missingFiles, ...conformResult.stubs].slice(0, 20),
            },
            summary,
            "retryFeedback",
            "gate:conformance:failed",
          );
          if (blocked) implGateBlocked = true;
        }
        if (conformResult.passed) {
          this.log(pipeline.featureId, "gate:conformance:verified", conformResult.detail);
        }
      } catch {
        // best-effort — don't block on conformance check failure
      }
    }

    // Gate: Build validation — after impl, verify the project builds and follows conventions
    if (phase === "impl") {
      try {
        const { detectStack, runBuildValidation } = await import("./stack-detection.js");
        const buildCwd = pipeline.context?.workingDir
          ? join(pipeline.localPath, pipeline.context.workingDir)
          : pipeline.localPath;
        const stack = detectStack(buildCwd);
        if (stack) {
          // Cache stack info on pipeline context for downstream phases
          if (!pipeline.context) pipeline.context = {};
          (pipeline.context as Record<string, unknown>)["stackInfo"] = stack.framework;
          const buildResult = runBuildValidation(buildCwd, stack);
          if (!buildResult.passed) {
            const blocked = await this.runGate(
              pipeline,
              beadId,
              "build-gate",
              {
                passed: false,
                reason: buildResult.reason ?? "Build validation failed",
                missing: [...(buildResult.missing ?? [])],
                ...(buildResult.context ? { context: buildResult.context } : {}),
              },
              summary,
              "retryFeedback",
              "gate:build:failed",
            );
            if (blocked) implGateBlocked = true;
          } else {
            this.log(pipeline.featureId, "gate:build:passed", `Build validation passed (${stack.framework})`);
          }
        }
      } catch {
        // best-effort — don't block on build validation failure
      }
    }

    // If any impl pre-close gate blocked, return now (feedback from all gates was aggregated)
    if (implGateBlocked) return;

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
    try {
      await this.beads.close(pipeline.localPath, beadId, `Completed by ${phase} agent`);
    } catch {
      return; // try/finally releases the lock
    }
        pipeline.completedBeads = Math.min(Object.keys(pipeline.beadIds).length, pipeline.completedBeads + 1);
        const phaseLabel = PIPELINE_ROLES[phase as PipelineRole]?.label ?? phase;
        // Strip session markers (from user's CLAUDE.md) from agent summary
        const cleanSummary = summary
          ?.split("\n")
          .filter(
            (l) =>
              !(
                l.includes("═══") ||
                l.includes("──~") ||
                l.includes("── ·") ||
                l.includes("── !") ||
                l.includes("── ✓") ||
                l.includes("Gargle Blaster")
              ),
          )
          .join(" ")
          .trim();
        const summaryLine = cleanSummary ? ` — ${cleanSummary.slice(0, 150)}` : "";
        this.log(
          pipeline.featureId,
          `phase:completed:${phase}`,
          `${phaseLabel} done (${pipeline.completedBeads}/${Object.keys(pipeline.beadIds).length})${summaryLine}`,
        );

        // Store phase summary in pipeline context
        if (!pipeline.context) {
          pipeline.context = {};
        }
        if (!pipeline.context.phaseSummaries) {
          pipeline.context.phaseSummaries = {};
        }
        if (summary) {
          pipeline.context.phaseSummaries[phase] = summary.slice(0, 2000);
        }

        // Backfill storiesPath/architecturePath if not set (e.g., stories generated by pipeline)
        if (!pipeline.storiesPath && (phase === "stories" || phase === "brainstorm")) {
          const { findStoriesFile } = await import("./story-splitter.js");
          const slug = pipeline.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const found = findStoriesFile(pipeline.localPath, slug);
          if (found) {
            (pipeline as { storiesPath: string }).storiesPath = found;
            const archCandidate = found.replace(/\.md$/, ".architecture.md");
            if (!pipeline.architecturePath && existsSync(archCandidate)) {
              (pipeline as { architecturePath: string }).architecturePath = archCandidate;
            }
            this.store.save();
          }
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

        // captureTestContext already ran pre-close (needed by spec-quality gate)

        // GREEN verification after impl completes (Farley)
        // Uses FULL test suite (not just test-phase command) to catch redteam tests too
        if (phase === "impl") {
          const { verifyGreenState, resolveFullTestCommand } = await import("./tdd-enforcement.js");
          const baseline = this.testBaselines.get(pipeline.featureId);
          const greenCwd = pipeline.context?.workingDir
            ? join(pipeline.localPath, pipeline.context.workingDir)
            : pipeline.localPath;
          const fullTestCmd = resolveFullTestCommand(greenCwd) ?? pipeline.context?.testCommand;
          const green = await verifyGreenState(greenCwd, {
            baseline,
            testCommand: fullTestCmd,
          }).catch(() => ({
            passed: true,
            detail: "GREEN check failed to run — skipping",
          }));
          if (!green.passed) {
            const blocked = await this.runGate(
              pipeline,
              beadId,
              "green-gate",
              {
                passed: false,
                reason: green.detail,
                ...("testOutput" in green && green.testOutput ? { context: green.testOutput } : {}),
              },
              summary,
              "decisionLog",
              "tdd:green-failed",
            );
            if (blocked) return;
          }
          if (green.passed) {
            this.log(pipeline.featureId, "tdd:green-verified", green.detail);
          }

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
        // Uses FULL test suite to catch redteam test files (not just test-phase command).
        if (phase === "redteam") {
          const { verifyGreenState, resolveFullTestCommand } = await import("./tdd-enforcement.js");
          const baseline = this.testBaselines.get(pipeline.featureId);
          const greenCwd = pipeline.context?.workingDir
            ? join(pipeline.localPath, pipeline.context.workingDir)
            : pipeline.localPath;
          const fullTestCmd = resolveFullTestCommand(greenCwd) ?? pipeline.context?.testCommand;
          const green = await verifyGreenState(greenCwd, {
            baseline,
            testCommand: fullTestCmd,
          }).catch(() => ({
            passed: true,
            detail: "GREEN check failed to run — skipping",
          }));
          if (!green.passed) {
            const blocked = await this.runGate(
              pipeline,
              beadId,
              "redteam-gate",
              {
                passed: false,
                reason: `Redteam wrote failing tests: ${green.detail}`,
                ...("testOutput" in green && green.testOutput ? { context: green.testOutput } : {}),
              },
              summary,
              "decisionLog",
              "redteam:impl-loop",
            );
            if (blocked) return;
          }
        }

        // Merge→impl feedback loop
        // After merge review, if agent reports BLOCK, re-invoke impl to fix issues
        if (phase === "merge") {
          const upperSummary = summary?.toUpperCase() ?? "";
          const mergeBlocked = upperSummary.includes("BLOCK") || upperSummary.includes("FAIL");
          if (mergeBlocked) {
            // Extract a concise reason from the merge agent's summary.
            // First non-empty line that isn't just "BLOCK" or "FAIL" gives
            // the human a clue about what actually went wrong.
            const mergeReason = summary
              ?.split("\n")
              .map((l) => l.trim())
              .find((l) => l.length > 10 && !/^(BLOCK|FAIL)\b/i.test(l))
              ?? "Merge review reported issues";
            const blocked = await this.runGate(
              pipeline,
              beadId,
              "merge-gate",
              {
                passed: false,
                reason: mergeReason,
                ...(summary ? { context: summary.slice(0, 500) } : {}),
              },
              summary,
              "decisionLog",
              "merge:impl-loop",
            );
            if (blocked) return;
          }
        }

        // Ship operational readiness gate
        // After ship phase, check if code changes are needed (impl loop)
        if (phase === "ship") {
          const { checkOperationalReadiness, detectDeploymentNeed } = await import("./ship-detection.js");
          let archDoc: string | undefined;
          if (pipeline.architecturePath && existsSync(pipeline.architecturePath)) {
            try { archDoc = readFileSync(pipeline.architecturePath, "utf-8").slice(0, 5000); } catch { /* best-effort */ }
          }
          const deployResult = detectDeploymentNeed(pipeline.localPath, archDoc);
          const readiness = checkOperationalReadiness(pipeline.localPath, {
            hasDeploymentConfig: deployResult.needed,
          });
          if (readiness.gaps.needsImpl.length > 0) {
            const blocked = await this.runGate(
              pipeline,
              beadId,
              "ship-gate",
              {
                passed: false,
                reason: `Operational readiness gaps require code changes: ${readiness.gaps.needsImpl.join(", ")}`,
                ...(summary ? { context: summary.slice(0, 500) } : {}),
              },
              summary,
              "retryFeedback",
              "ship:impl-loop",
            );
            if (blocked) return;
          }

          // Log ship artifacts — surface what was actually produced
          const artifacts: string[] = [];
          const readmePath = join(pipeline.localPath, "README.md");
          if (existsSync(readmePath)) {
            artifacts.push("README.md");
          } else {
            this.log(
              pipeline.featureId,
              "ship:warning",
              "Ship completed but README.md not found — manual documentation may be needed",
            );
          }
          // Check for changelog entries
          const changelogDir = join(pipeline.localPath, "docs", "changelog");
          if (existsSync(changelogDir)) {
            try {
              const entries = readdirSync(changelogDir).filter((f) => f.endsWith(".md"));
              if (entries.length > 0) artifacts.push(`${entries.length} changelog entr${entries.length === 1 ? "y" : "ies"}`);
            } catch { /* best-effort */ }
          }
          if (existsSync(join(pipeline.localPath, "CHANGELOG.md"))) {
            artifacts.push("CHANGELOG.md");
          }
          // Check for knowledge docs
          const solutionsDir = join(pipeline.localPath, "docs", "solutions");
          if (existsSync(solutionsDir)) {
            try {
              const docs = readdirSync(solutionsDir, { recursive: true })
                .filter((f) => String(f).endsWith(".md"));
              if (docs.length > 0) artifacts.push(`${docs.length} knowledge doc${docs.length === 1 ? "" : "s"}`);
            } catch { /* best-effort */ }
          }
          // Check for .env.example
          if (existsSync(join(pipeline.localPath, ".env.example"))) {
            artifacts.push(".env.example");
          }

          if (artifacts.length > 0) {
            this.log(
              pipeline.featureId,
              "ship:artifacts",
              `Ship produced: ${artifacts.join(", ")}`,
            );
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
    } finally {
      // Release completion lock — tick() can now process this pipeline again
      this.completionInProgress.delete(pipeline.featureId);
    }
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
      const failureCount =
        this.decisionLog.filter(
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
    // "test" role maps to "tests" bead key (historical naming)
    const key = role === "test" ? "tests" : role;
    return pipeline.beadIds[key];
  }

  /**
   * Reopen a bead and verify it's actually open. If verification fails,
   * escalate to human instead of silently proceeding.
   */
  private async reopenAndVerify(pipeline: Pipeline, beadId: string, role: string): Promise<void> {
    try {
      await this.beads.updateStatus(pipeline.localPath, beadId, "open");
      // Verify the bead is actually open
      const bead = await this.beads.show(pipeline.localPath, beadId);
      if (bead.status !== "open") {
        this.log(
          pipeline.featureId,
          `bead:reopen-failed:${role}`,
          `Bead ${beadId} is '${bead.status}' after reopen attempt — expected 'open'. Escalating.`,
        );
        const result = enqueueQuestion(this.questionQueue, {
          featureId: pipeline.featureId,
          question: `Failed to reopen ${role} bead for retry. Bead is '${bead.status}' instead of 'open'. Manual intervention needed.`,
          options: ["Retry", "Skip", "Cancel pipeline"],
          source: "conductor",
        });
        this.questionQueue = result.queue;
        saveQuestionQueue(this.questionQueue);
        pipeline.status = "blocked";
        this.store.save();
      }
    } catch (err) {
      this.log(
        pipeline.featureId,
        `bead:reopen-error:${role}`,
        `Failed to reopen bead ${beadId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Escalate — don't silently proceed with a broken retry
      pipeline.status = "blocked";
      this.store.save();
    }
  }

  /**
   * Apply a retry decision from evaluateGate(): set feedback, reopen beads, decrement.
   * Returns true if retry was applied (caller should return early).
   */
  private async applyRetry(
    pipeline: Pipeline,
    _beadId: string,
    retry: RetryAction,
    summary: string | undefined,
  ): Promise<void> {
    if (!pipeline.context) pipeline.context = {};
    if (!pipeline.context.retryFeedback) pipeline.context.retryFeedback = {};
    const prevAttempt = pipeline.context.retryFeedback[retry.gateId]?.attempt ?? 0;
    pipeline.context.retryFeedback[retry.gateId] = {
      reason: retry.feedback.reason,
      missing: [...retry.feedback.missing],
      previousSummary: [
        summary?.slice(0, 300) ?? "",
        retry.feedback.context ? `\nTest output:\n${retry.feedback.context.slice(0, 1500)}` : "",
      ].join(""),
      attempt: prevAttempt + 1,
    };
    // Reopen the retryRole bead — NOT the triggering bead.
    // For post-close gates (redteam, merge) the retry target is impl,
    // not the bead that just completed. Reopening the wrong bead causes
    // infinite claim-failure loops (the closed bead keeps appearing in bd ready).
    const retryBeadId = this.roleToBeadId(pipeline, retry.retryRole);
    if (retryBeadId) {
      await this.reopenAndVerify(pipeline, retryBeadId, retry.retryRole);
    }
    // Reopen additional beads (e.g., merge when impl retries after redteam)
    if (retry.alsoReopen) {
      for (const role of retry.alsoReopen) {
        const roleBeadId = this.roleToBeadId(pipeline, role);
        if (roleBeadId) {
          await this.reopenAndVerify(pipeline, roleBeadId, role);
        }
      }
    }
    if (retry.decrementBeads > 0) {
      pipeline.completedBeads = Math.max(0, pipeline.completedBeads - retry.decrementBeads);
    }
    // Update activePhase immediately so the cockpit reflects the regression
    // without waiting for the next heal-loop tick.
    pipeline.activePhase = retry.retryRole;
    this.store.save();
  }

  /**
   * Apply an escalation decision: enqueue question, block pipeline.
   */
  private applyEscalation(
    pipeline: Pipeline,
    escalation: EscalationAction,
    context?: string,
  ): void {
    const result = enqueueQuestion(this.questionQueue, {
      featureId: pipeline.featureId,
      question: escalation.question,
      options: [...escalation.options],
      source: "conductor",
      ...(context ? { context: context.slice(0, 500) } : {}),
    });
    this.questionQueue = result.queue;
    saveQuestionQueue(this.questionQueue);
    pipeline.status = "blocked";
    this.store.save();
  }

  /**
   * Run a gate check through the retry engine and apply the result.
   * Returns true if the gate blocked progression (retry or escalate).
   */
  private async runGate(
    pipeline: Pipeline,
    beadId: string,
    gateId: string,
    result: { passed: boolean; reason?: string; missing?: string[]; context?: string },
    summary: string | undefined,
    trackingMethod: "retryFeedback" | "decisionLog",
    logAction: string,
  ): Promise<boolean> {
    const currentAttempts =
      trackingMethod === "retryFeedback"
        ? (pipeline.context?.retryFeedback?.[gateId]?.attempt
            ?? pipeline.context?.retryFeedback?.[GATE_CONFIGS_LOOKUP[gateId]?.retryRole ?? ""]?.attempt
            ?? 0)
        : Math.max(
            pipeline.context?.retryFeedback?.[gateId]?.attempt ?? 0,
            this.decisionLog.filter(
              (e) => e.featureId === pipeline.featureId && e.action === logAction,
            ).length,
          );

    const decision = evaluateGate(gateId, result, currentAttempts);

    if (decision.action === "retry") {
      const retry = decision.retries[0];
      if (!retry) return false;
      const attemptLabel = `attempt ${currentAttempts + 1}/${GATE_CONFIGS_LOOKUP[gateId]?.maxRetries ?? 2}`;
      // Find the first substantive line from context — skip short preamble lines
      const contextHint = result.context
        ?.split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 20 && !/^(all data|here's the|verdict|summary)/i.test(l))
        ?.slice(0, 150) ?? "";
      const detail = contextHint
        ? `${result.reason ?? gateId} — ${contextHint} (${attemptLabel})`
        : `${result.reason ?? gateId} (${attemptLabel})`;
      this.log(pipeline.featureId, logAction, detail);
      await this.applyRetry(pipeline, beadId, retry, summary);
      return true;
    }

    if (decision.action === "escalate") {
      const escalation = decision.escalations[0];
      if (!escalation) return false;
      this.log(pipeline.featureId, `${logAction}:exhausted`, "Max retries reached. Escalating.");
      this.applyEscalation(pipeline, escalation, summary);
      return true;
    }

    return false;
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
