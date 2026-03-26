import { join } from "node:path";
import { launchClaude } from "../board/launch-claude.js";
import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import type { Bead, BeadsClient } from "./beads.js";
import type { EventBus } from "./event-bus.js";
import { PipelineStore } from "./pipeline-store.js";
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
import { beadToRole, PIPELINE_ROLES } from "./roles.js";
import { verifyRedState } from "./tdd-enforcement.js";
import type { WorktreeManager } from "./worktree.js";

// ── Types ──

export type PipelineStatus = "running" | "paused" | "blocked" | "completed" | "failed";

export interface Pipeline {
  readonly featureId: string;
  readonly title: string;
  readonly repo: string;
  readonly localPath: string;
  readonly repoConfig: RepoConfig;
  readonly beadIds: {
    brainstorm: string;
    stories: string;
    tests: string;
    impl: string;
    redteam: string;
    merge: string;
  };
  status: PipelineStatus;
  /** Number of completed (closed) beads out of 6. Updated by conductor tick. */
  completedBeads: number;
  /** Currently active phase (if any agent is running). */
  activePhase?: string | undefined;
  readonly startedAt: string;
  completedAt?: string;
  /** Estimated cost tracking per phase (in USD). */
  costByPhase?: Record<string, number>;
  /** Total estimated cost (in USD). */
  totalCost?: number;
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
      repo,
      localPath: repoConfig.localPath,
      repoConfig,
      beadIds: {
        brainstorm: dag.brainstorm.id,
        stories: dag.stories.id,
        tests: dag.tests.id,
        impl: dag.impl.id,
        redteam: dag.redteam.id,
        merge: dag.merge.id,
      },
      status: "running",
      completedBeads: 0,
      startedAt: new Date().toISOString(),
    };

    this.store.set(featureId, pipeline);
    this.store.save();
    this.log(featureId, "pipeline:started", `Created DAG for: ${title}`);

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

    // Pick up pipelines created by other processes (CLI, watcher)
    this.store.syncFromDisk();

    for (const pipeline of this.store.getAll()) {
      // Skip completed/failed pipelines
      if (pipeline.status === "completed" || pipeline.status === "failed") continue;
      // Skip paused pipelines
      if (pipeline.status === "paused") continue;

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

    // Persist any state changes from this tick cycle (but not if stopped)
    if (!this.stopped) {
      this.store.save();
    }
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

    // Sync completedBeads from actual bead state (handles externally-closed beads like brainstorm)
    await this.syncCompletedBeads(pipeline);

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

      await this.spawnForRole(pipeline, bead, role);
    }

    // Check if all beads are closed → pipeline complete
    await this.checkPipelineCompletion(pipeline);
  }

  /** Spawn an agent for a specific role. */
  private async spawnForRole(pipeline: Pipeline, bead: Bead, role: PipelineRole): Promise<void> {
    const roleConfig = PIPELINE_ROLES[role];

    // Brainstorm is a HUMAN activity — only launched by the user pressing Z
    // in the cockpit. The watcher/conductor never auto-launches it.
    if (role === "brainstorm") {
      return;
    }

    // RED verification: before spawning impl agent, verify tests fail
    if (role === "impl") {
      const redResult = await verifyRedState(pipeline.localPath);
      if (!redResult.passed) {
        this.log(
          pipeline.featureId,
          "tdd:red-failed",
          `RED verification failed: ${redResult.detail}`,
        );
        // Re-open the test bead so tests get rewritten
        try {
          await this.beads.updateStatus(pipeline.localPath, pipeline.beadIds.tests, "open");
        } catch {
          // best-effort
        }
        return;
      }
      this.log(pipeline.featureId, "tdd:red-verified", redResult.detail);

      // Traceability check: verify stories map to tests (Farley)
      try {
        const { checkTraceability } = await import("./tdd-enforcement.js");
        const storiesPath = join(pipeline.localPath, "tests", "stories");
        const traceability = await checkTraceability(pipeline.localPath, storiesPath);
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

    // Claim the bead (atomically set assignee + in_progress)
    try {
      await this.beads.claim(pipeline.localPath, bead.id);
    } catch {
      return; // Another agent may have claimed it
    }

    // Build the prompt with variable substitution
    const slug = pipeline.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const prompt = roleConfig.promptTemplate
      .replace(/\{title\}/g, pipeline.title)
      .replace(/\{slug\}/g, slug)
      .replace(/\{spec\}/g, bead.description ?? pipeline.title);

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
        writeRoleClaudeMd(worktreePath, role);
        this.log(
          pipeline.featureId,
          `worktree:created:${role}`,
          `Worktree at ${worktreePath} with ${role} CLAUDE.md`,
        );
      } catch (err) {
        this.log(
          pipeline.featureId,
          `worktree:failed:${role}`,
          `Worktree creation failed, using main repo: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Resolve model from config for this role
    const roleModel = this.config.pipeline?.models?.[role];

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

    const prompt = PIPELINE_ROLES.brainstorm.promptTemplate
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

  /**
   * Sync completedBeads count from actual bead state.
   * Needed because interactive sessions (brainstorm) close beads directly
   * without going through onAgentCompleted.
   */
  private async syncCompletedBeads(pipeline: Pipeline): Promise<void> {
    try {
      let closed = 0;
      for (const id of Object.values(pipeline.beadIds)) {
        const bead = await this.beads.show(pipeline.localPath, id);
        if (bead.status === "closed") closed++;
      }
      if (pipeline.completedBeads !== closed) {
        pipeline.completedBeads = closed;
        this.store.save();
      }
    } catch {
      // best-effort
    }
  }

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
          `All phases complete for: ${pipeline.title}`,
        );
      }
    } catch {
      // Beads query failed, skip completion check
    }
  }

  // ── Event Handlers ──

  private onAgentCompleted(
    sessionId: string,
    _repo: string,
    _issueNumber: number,
    phase: string,
    summary?: string,
  ): void {
    // Find the specific pipeline this session belongs to
    const featureId = this.sessionToPipeline.get(sessionId);
    const pipeline = featureId ? this.store.get(featureId) : undefined;
    if (!pipeline) return;

    const beadId = this.roleToBeadId(pipeline, phase as PipelineRole);
    if (!beadId) return;

    this.sessionToPipeline.delete(sessionId);

    // If this agent had a worktree, submit to refinery for merge
    const worktreeInfo = this.sessionWorktrees.get(sessionId);
    if (worktreeInfo && this.refinery) {
      const mergeId = this.refinery.submit(
        pipeline.featureId,
        worktreeInfo.branch,
        worktreeInfo.worktreePath,
        worktreeInfo.repoPath,
        phase, // Pass role for diff-audit gate (Amodei)
      );
      this.log(
        pipeline.featureId,
        `refinery:submitted:${phase}`,
        `Branch ${worktreeInfo.branch} submitted to merge queue (${mergeId})`,
      );
      this.sessionWorktrees.delete(sessionId);
    }

    // Close the bead
    this.beads
      .close(pipeline.localPath, beadId, `Completed by ${phase} agent`)
      .then(async () => {
        pipeline.completedBeads = Math.min(6, pipeline.completedBeads + 1);
        const phaseLabel = PIPELINE_ROLES[phase as PipelineRole]?.label ?? phase;
        const summaryLine = summary
          ? ` — ${summary.split("\n")[0]?.slice(0, 150)}`
          : "";
        this.log(
          pipeline.featureId,
          `phase:completed:${phase}`,
          `${phaseLabel} done (${pipeline.completedBeads}/6)${summaryLine}`,
        );

        // GREEN verification after impl completes (Farley)
        if (phase === "impl") {
          const { verifyGreenState } = await import("./tdd-enforcement.js");
          const green = await verifyGreenState(pipeline.localPath).catch(() => ({
            passed: true,
            detail: "GREEN check failed to run — skipping",
          }));
          if (!green.passed) {
            this.log(pipeline.featureId, "tdd:green-failed", green.detail);
            // Re-open impl bead for retry
            await this.beads.updateStatus(pipeline.localPath, beadId, "open").catch(() => {});
            pipeline.completedBeads = Math.max(0, pipeline.completedBeads - 1);
            return; // Don't proceed to GitHub sync — impl needs retry
          }
          this.log(pipeline.featureId, "tdd:green-verified", green.detail);
        }

        // Redteam→impl feedback loop (Farley)
        // After redteam, check if new tests are failing. If so, re-open impl.
        if (phase === "redteam") {
          const { verifyGreenState } = await import("./tdd-enforcement.js");
          const green = await verifyGreenState(pipeline.localPath).catch(() => ({
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
              // Re-open the impl bead so the next tick spawns a new impl agent
              const implBeadId = pipeline.beadIds.impl;
              await this.beads.updateStatus(pipeline.localPath, implBeadId, "open").catch(() => {});
              pipeline.completedBeads = Math.max(0, pipeline.completedBeads - 1);
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

    const matchedPipelines = featureId
      ? ([this.store.get(featureId)].filter(Boolean) as Pipeline[])
      : this.store.getAll(); // fallback for sessions without mapping

    for (const pipeline of matchedPipelines) {
      const beadId = this.roleToBeadId(pipeline, phase as PipelineRole);
      if (!beadId) continue;

      this.log(
        pipeline.featureId,
        `agent:failed:${phase}`,
        errorMessage
          ? `Agent failed: ${errorMessage.slice(0, 200)}`
          : `Agent failed with exit code ${exitCode}`,
      );

      // Detect rate limit errors — pause pipeline instead of burning retries
      const isRateLimit =
        errorMessage?.includes("out of extra usage") ||
        errorMessage?.includes("rate limit") ||
        errorMessage?.includes("resets ") ||
        errorMessage?.includes("429");
      if (isRateLimit) {
        pipeline.status = "paused";
        this.store.save();
        this.log(
          pipeline.featureId,
          "pipeline:rate-limited",
          `Paused — API rate limit hit. Resume when usage resets: ${errorMessage?.match(/resets\s+\S+/)?.[0] ?? "check your plan"}`,
        );
        return;
      }

      // Mark bead as blocked so it can be retried
      this.beads.updateStatus(pipeline.localPath, beadId, "open").catch(() => {
        // best-effort
      });

      // Queue a question for the human if this is a repeated failure
      // But only once per phase — don't spam questions
      if (pipeline.status === "blocked") return; // already blocked, don't add more questions

      const failures = this.decisionLog.filter(
        (e) => e.featureId === pipeline.featureId && e.action === `agent:failed:${phase}`,
      );

      if (failures.length >= 2) {
        // Check if we already have an unresolved question for this phase
        const existingQuestion = this.questionQueue.questions.find(
          (q) => q.featureId === pipeline.featureId && !q.resolvedAt && q.question.includes(phase),
        );
        if (existingQuestion) return; // already asked, don't spam

        const result = enqueueQuestion(this.questionQueue, {
          featureId: pipeline.featureId,
          question: `The ${phase} agent has failed ${failures.length} times for "${pipeline.title}". Should I retry, skip this phase, or stop the pipeline?`,
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
          `Repeated ${phase} failures — queued for human decision`,
        );
      }
    }
  }

  // ── Helpers ──

  private roleToBeadId(pipeline: Pipeline, role: PipelineRole): string | undefined {
    switch (role) {
      case "brainstorm":
        return pipeline.beadIds.brainstorm;
      case "stories":
        return pipeline.beadIds.stories;
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
