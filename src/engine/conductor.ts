import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import type { Bead, BeadsClient } from "./beads.js";
import type { EventBus } from "./event-bus.js";
import type { QuestionQueue } from "./question-queue.js";
import {
  enqueueQuestion,
  getPendingForFeature,
  loadQuestionQueue,
  saveQuestionQueue,
} from "./question-queue.js";
import type { PipelineRole } from "./roles.js";
import { beadLabelToRole, PIPELINE_ROLES } from "./roles.js";

// ── Types ──

export type PipelineStatus = "running" | "paused" | "blocked" | "completed" | "failed";

export interface Pipeline {
  readonly featureId: string;
  readonly title: string;
  readonly repo: string;
  readonly localPath: string;
  readonly repoConfig: RepoConfig;
  readonly beadIds: {
    stories: string;
    tests: string;
    impl: string;
    redteam: string;
    merge: string;
  };
  status: PipelineStatus;
  readonly startedAt: string;
  completedAt?: string;
}

export interface ConductorOptions {
  readonly pollIntervalMs?: number;
  readonly maxConcurrentPipelines?: number;
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
  private readonly pipelines: Map<string, Pipeline> = new Map();
  private readonly decisionLog: DecisionLogEntry[] = [];
  private questionQueue: QuestionQueue;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private readonly maxConcurrentPipelines: number;

  constructor(
    config: HogConfig,
    eventBus: EventBus,
    agentManager: AgentManager,
    beads: BeadsClient,
    options: ConductorOptions = {},
  ) {
    this.config = config;
    this.eventBus = eventBus;
    this.agentManager = agentManager;
    this.beads = beads;
    this.questionQueue = loadQuestionQueue();
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.maxConcurrentPipelines = options.maxConcurrentPipelines ?? 3;

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

  /**
   * Start a new feature pipeline.
   *
   * Creates a Beads DAG and begins orchestrating agents through
   * stories → tests → implementation → red team → merge.
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
      await this.beads.init(repoConfig.localPath);
    }

    const activePipelines = [...this.pipelines.values()].filter((p) => p.status === "running");
    if (activePipelines.length >= this.maxConcurrentPipelines) {
      return {
        error: `Max concurrent pipelines (${this.maxConcurrentPipelines}) reached`,
      };
    }

    // Create the feature DAG in Beads
    const dag = await this.beads.createFeatureDAG(repoConfig.localPath, title, description);

    const featureId = `feat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const pipeline: Pipeline = {
      featureId,
      title,
      repo,
      localPath: repoConfig.localPath,
      repoConfig,
      beadIds: {
        stories: dag.stories.id,
        tests: dag.tests.id,
        impl: dag.impl.id,
        redteam: dag.redteam.id,
        merge: dag.merge.id,
      },
      status: "running",
      startedAt: new Date().toISOString(),
    };

    this.pipelines.set(featureId, pipeline);
    this.log(featureId, "pipeline:started", `Created DAG for: ${title}`);

    // Trigger initial tick to spawn the first agent (stories)
    await this.tickPipeline(pipeline);

    return pipeline;
  }

  /** Pause a pipeline. Agents keep running but no new ones are spawned. */
  pausePipeline(featureId: string): boolean {
    const pipeline = this.pipelines.get(featureId);
    if (!pipeline || pipeline.status !== "running") return false;
    pipeline.status = "paused";
    this.log(featureId, "pipeline:paused", "Paused by user");
    return true;
  }

  /** Resume a paused pipeline. */
  resumePipeline(featureId: string): boolean {
    const pipeline = this.pipelines.get(featureId);
    if (!pipeline || pipeline.status !== "paused") return false;
    pipeline.status = "running";
    this.log(featureId, "pipeline:resumed", "Resumed by user");
    return true;
  }

  // ── Core Loop ──

  /** One tick of the conductor — check all running pipelines for ready work. */
  private async tick(): Promise<void> {
    for (const pipeline of this.pipelines.values()) {
      if (pipeline.status !== "running") continue;

      // Skip if blocked by unanswered questions
      if (getPendingForFeature(this.questionQueue, pipeline.featureId).length > 0) {
        if (pipeline.status === "running") {
          pipeline.status = "blocked";
          this.log(pipeline.featureId, "pipeline:blocked", "Waiting for human decisions");
        }
        continue;
      }

      await this.tickPipeline(pipeline);
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

    for (const bead of pipelineReady) {
      // Skip beads already being worked on
      if (bead.status === "in_progress") continue;

      const role = beadLabelToRole(bead.labels);
      if (!role) continue;

      await this.spawnForRole(pipeline, bead, role);
    }

    // Check if all beads are closed → pipeline complete
    await this.checkPipelineCompletion(pipeline);
  }

  /** Spawn an agent for a specific role. */
  private async spawnForRole(pipeline: Pipeline, bead: Bead, role: PipelineRole): Promise<void> {
    const roleConfig = PIPELINE_ROLES[role];

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

    // Spawn the agent
    const result = this.agentManager.launchAgent({
      localPath: pipeline.localPath,
      repoFullName: pipeline.repo,
      issueNumber: 0, // Pipeline beads don't map 1:1 to GitHub issues
      issueTitle: `[${roleConfig.label}] ${pipeline.title}`,
      issueUrl: "",
      phase: role,
      promptTemplate: prompt,
    });

    if (typeof result === "string") {
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
    _sessionId: string,
    _repo: string,
    _issueNumber: number,
    phase: string,
  ): void {
    // Find the pipeline this agent belongs to and close the corresponding bead
    for (const pipeline of this.pipelines.values()) {
      const beadId = this.roleToBeadId(pipeline, phase as PipelineRole);
      if (!beadId) continue;

      this.beads
        .close(pipeline.localPath, beadId, `Completed by ${phase} agent`)
        .then(() => {
          this.log(pipeline.featureId, `bead:closed:${phase}`, `Bead ${beadId} completed`);
        })
        .catch(() => {
          // best-effort
        });
    }
  }

  private onAgentFailed(
    _sessionId: string,
    _repo: string,
    _issueNumber: number,
    phase: string,
    exitCode: number,
  ): void {
    for (const pipeline of this.pipelines.values()) {
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
      const failures = this.decisionLog.filter(
        (e) => e.featureId === pipeline.featureId && e.action === `agent:failed:${phase}`,
      );

      if (failures.length >= 2) {
        const result = enqueueQuestion(this.questionQueue, {
          featureId: pipeline.featureId,
          question: `The ${phase} agent has failed ${failures.length} times for "${pipeline.title}". Should I retry, skip this phase, or stop the pipeline?`,
          options: ["Retry", "Skip phase", "Stop pipeline"],
          source: "conductor",
        });
        this.questionQueue = result.queue;
        saveQuestionQueue(this.questionQueue);
        pipeline.status = "blocked";
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
