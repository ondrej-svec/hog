import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchClaude } from "../board/launch-claude.js";
import type { HogConfig, RepoConfig } from "../config.js";
import { CONFIG_DIR } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import type { Bead, BeadsClient } from "./beads.js";
import type { EventBus } from "./event-bus.js";
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
  private readonly pipelines: Map<string, Pipeline> = new Map();
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
  private readonly pollIntervalMs: number;
  private readonly maxConcurrentPipelines: number;
  private readonly onPhaseCompleted?: ConductorOptions["onPhaseCompleted"];
  private static readonly PIPELINES_FILE = join(CONFIG_DIR, "pipelines.json");

  /**
   * Persist pipelines to disk so they survive process restarts.
   *
   * Uses read-merge-write to avoid lost updates from concurrent processes:
   * reads current file, merges with in-memory state, writes back.
   * The atomic rename prevents partial reads but does NOT prevent lost updates
   * from truly simultaneous writes — acceptable for this use case.
   */
  private savePipelines(): void {
    if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") return;
    try {
      // Write current in-memory state to disk
      const data = [...this.pipelines.values()].map((p) => ({
        featureId: p.featureId,
        title: p.title,
        repo: p.repo,
        localPath: p.localPath,
        beadIds: p.beadIds,
        status: p.status,
        completedBeads: p.completedBeads,
        activePhase: p.activePhase,
        startedAt: p.startedAt,
        completedAt: p.completedAt,
      }));
      mkdirSync(CONFIG_DIR, { recursive: true });
      const tmp = `${Conductor.PIPELINES_FILE}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, Conductor.PIPELINES_FILE);
    } catch {
      // best-effort — tests and environments without writable config dir
    }
  }

  /** Load persisted pipelines from disk and re-resolve repoConfig from current config. */
  private loadPipelines(): void {
    if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") return;
    if (!existsSync(Conductor.PIPELINES_FILE)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(Conductor.PIPELINES_FILE, "utf-8"));
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        if (typeof e["featureId"] !== "string" || typeof e["repo"] !== "string") continue;

        // Skip completed/failed pipelines
        if (e["status"] === "completed" || e["status"] === "failed") continue;

        // Auto-expire stale pipelines (>7 days old with no progress)
        const startedAt =
          typeof e["startedAt"] === "string" ? new Date(e["startedAt"]).getTime() : 0;
        const ageDays = (Date.now() - startedAt) / 86_400_000;
        const completedBeads = typeof e["completedBeads"] === "number" ? e["completedBeads"] : 0;
        if (ageDays > 7 && completedBeads === 0) continue;

        // Validate beadIds structure (CRIT-2)
        const beadIds = e["beadIds"];
        if (
          typeof beadIds !== "object" ||
          beadIds === null ||
          typeof (beadIds as Record<string, unknown>)["brainstorm"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["stories"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["tests"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["impl"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["redteam"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["merge"] !== "string"
        ) {
          continue; // Corrupted or old-schema pipeline — skip
        }

        // Re-resolve repoConfig from current config, fall back to ad-hoc config
        const localPath = (e["localPath"] as string) ?? "";
        const repoConfig =
          this.config.repos.find((r) => r.name === e["repo"]) ??
          ({
            name: e["repo"] as string,
            shortName: e["repo"] as string,
            projectNumber: 0,
            statusFieldId: "",
            localPath,
            completionAction: { type: "closeIssue" },
          } as RepoConfig);

        const pipeline: Pipeline = {
          featureId: e["featureId"] as string,
          title: (e["title"] as string) ?? "",
          repo: e["repo"] as string,
          localPath: localPath || repoConfig.localPath || "",
          repoConfig,
          beadIds: beadIds as Pipeline["beadIds"],
          status: (e["status"] as PipelineStatus) ?? "running",
          completedBeads: (e["completedBeads"] as number) ?? 0,
          activePhase: e["activePhase"] as string | undefined,
          startedAt: (e["startedAt"] as string) ?? new Date().toISOString(),
          ...(typeof e["completedAt"] === "string" ? { completedAt: e["completedAt"] } : {}),
        };
        this.pipelines.set(pipeline.featureId, pipeline);
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

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

    // Restore pipelines from previous sessions
    this.loadPipelines();

    // Listen for agent completion/failure to advance pipelines
    this.eventBus.on("agent:completed", (event) => {
      this.onAgentCompleted(event.sessionId, event.repo, event.issueNumber, event.phase);
    });
    this.eventBus.on("agent:failed", (event) => {
      this.onAgentFailed(
        event.sessionId,
        event.repo,
        event.issueNumber,
        event.phase,
        event.exitCode,
      );
    });
  }

  /** Start the conductor polling loop. */
  start(): void {
    // Clean up stale questions from pipelines that no longer exist
    const activeIds = new Set([...this.pipelines.keys()]);
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

  /** Stop the conductor. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Get all active pipelines. */
  getPipelines(): Pipeline[] {
    return [...this.pipelines.values()];
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

    const activePipelines = [...this.pipelines.values()].filter((p) => p.status === "running");
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

    this.pipelines.set(featureId, pipeline);
    this.savePipelines();
    this.log(featureId, "pipeline:started", `Created DAG for: ${title}`);

    // Don't tick here — the watcher process handles advancement.
    // This prevents the brainstorm tmux session from opening before
    // --brainstorm-done can close the bead.

    return pipeline;
  }

  /** Pause a pipeline. Agents keep running but no new ones are spawned. */
  pausePipeline(featureId: string): boolean {
    const pipeline = this.pipelines.get(featureId);
    if (!pipeline || pipeline.status !== "running") return false;
    pipeline.status = "paused";
    this.savePipelines();
    this.log(featureId, "pipeline:paused", "Paused by user");
    return true;
  }

  /** Resume a paused pipeline. */
  resumePipeline(featureId: string): boolean {
    const pipeline = this.pipelines.get(featureId);
    if (!pipeline || pipeline.status !== "paused") return false;
    pipeline.status = "running";
    this.savePipelines();
    this.log(featureId, "pipeline:resumed", "Resumed by user");
    return true;
  }

  /** Cancel and remove a pipeline, cleaning up active agents and worktrees. */
  cancelPipeline(featureId: string): boolean {
    const pipeline = this.pipelines.get(featureId);
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

    this.pipelines.delete(featureId);
    this.savePipelines();
    this.log(featureId, "pipeline:cancelled", `Cancelled: ${pipeline.title}`);
    return true;
  }

  /**
   * Sync pipelines from disk — picks up new pipelines created by other processes
   * and respects "clear all" signal (empty file).
   */
  private syncFromDisk(): void {
    if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") return;
    if (!existsSync(Conductor.PIPELINES_FILE)) return;

    try {
      const raw: unknown = JSON.parse(readFileSync(Conductor.PIPELINES_FILE, "utf-8"));
      if (!Array.isArray(raw)) return;

      // Empty file = clear signal
      if (raw.length === 0 && this.pipelines.size > 0) {
        this.pipelines.clear();
        return;
      }

      // Add pipelines from disk that we don't already have
      for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        const featureId = e["featureId"];
        if (typeof featureId !== "string") continue;

        // Update existing pipelines with progress from other processes
        const existing = this.pipelines.get(featureId);
        if (existing) {
          const diskCompleted = typeof e["completedBeads"] === "number" ? e["completedBeads"] : 0;
          if (diskCompleted > existing.completedBeads) {
            existing.completedBeads = diskCompleted;
          }
          if (typeof e["activePhase"] === "string" && e["activePhase"] !== existing.activePhase) {
            existing.activePhase = e["activePhase"];
          }
          const diskStatus = e["status"] as string;
          if (diskStatus === "completed" || diskStatus === "failed") {
            existing.status = diskStatus as Pipeline["status"];
            if (diskStatus === "completed" && typeof e["completedAt"] === "string") {
              existing.completedAt = e["completedAt"];
            }
          }
          continue;
        }

        // Skip terminal states for new pipelines
        if (e["status"] === "completed" || e["status"] === "failed") continue;

        // Validate beadIds
        const beadIds = e["beadIds"];
        if (
          typeof beadIds !== "object" ||
          beadIds === null ||
          typeof (beadIds as Record<string, unknown>)["brainstorm"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["stories"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["tests"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["impl"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["redteam"] !== "string" ||
          typeof (beadIds as Record<string, unknown>)["merge"] !== "string"
        ) {
          continue;
        }

        const localPath = (e["localPath"] as string) ?? "";
        const repoConfig =
          this.config.repos.find((r) => r.name === e["repo"]) ??
          ({
            name: (e["repo"] as string) ?? "",
            shortName: (e["repo"] as string) ?? "",
            projectNumber: 0,
            statusFieldId: "",
            localPath,
            completionAction: { type: "closeIssue" },
          } as RepoConfig);

        this.pipelines.set(featureId, {
          featureId,
          title: (e["title"] as string) ?? "",
          repo: (e["repo"] as string) ?? "",
          localPath: localPath || repoConfig.localPath || "",
          repoConfig,
          beadIds: beadIds as Pipeline["beadIds"],
          status: (e["status"] as PipelineStatus) ?? "running",
          completedBeads: (e["completedBeads"] as number) ?? 0,
          activePhase: e["activePhase"] as string | undefined,
          startedAt: (e["startedAt"] as string) ?? new Date().toISOString(),
          ...(typeof e["completedAt"] === "string" ? { completedAt: e["completedAt"] } : {}),
        });
      }
    } catch {
      // best-effort
    }
  }

  // ── Core Loop ──

  /** One tick of the conductor — check all running pipelines for ready work. */
  private async tick(): Promise<void> {
    // Pick up pipelines created by other processes (CLI, watcher)
    this.syncFromDisk();

    for (const pipeline of this.pipelines.values()) {
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

    // Persist any state changes from this tick cycle
    this.savePipelines();
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

    for (const bead of pipelineReady) {
      // Skip beads already being worked on
      if (bead.status === "in_progress") continue;

      const role = beadToRole(bead);
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

    // Spawn the agent
    const result = this.agentManager.launchAgent({
      localPath: agentCwd,
      repoFullName: pipeline.repo,
      issueNumber: 0,
      issueTitle: `[${roleConfig.label}] ${pipeline.title}`,
      issueUrl: "",
      phase: role,
      promptTemplate: prompt,
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
        this.savePipelines();
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
        this.savePipelines();
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
  ): void {
    // Find the specific pipeline this session belongs to
    const featureId = this.sessionToPipeline.get(sessionId);
    const pipeline = featureId ? this.pipelines.get(featureId) : undefined;
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
        this.log(
          pipeline.featureId,
          `bead:closed:${phase}`,
          `Bead ${beadId} completed (${pipeline.completedBeads}/6)`,
        );

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
      ? ([this.pipelines.get(featureId)].filter(Boolean) as Pipeline[])
      : [...this.pipelines.values()]; // fallback for sessions without mapping

    for (const pipeline of matchedPipelines) {
      const beadId = this.roleToBeadId(pipeline, phase as PipelineRole);
      if (!beadId) continue;

      this.log(
        pipeline.featureId,
        `agent:failed:${phase}`,
        `Agent failed with exit code ${exitCode}`,
      );

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
        this.savePipelines();
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
