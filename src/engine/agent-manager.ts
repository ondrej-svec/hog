import type { ChildProcess } from "node:child_process";
import type { AgentMonitor, SpawnAgentOptions } from "../board/spawn-agent.js";
import {
  attachStreamMonitor,
  findUnprocessedResults,
  isProcessAlive,
  readResultFile,
  sessionFromResult,
  spawnBackgroundAgent,
  writeResultFile,
} from "../board/spawn-agent.js";
import type { HogConfig } from "../config.js";
import { notify } from "../notify.js";
import type { EventBus } from "./event-bus.js";
import type { WorkflowEngine } from "./workflow.js";

// ── Types ──

export interface TrackedAgent {
  readonly sessionId: string;
  readonly repo: string;
  readonly issueNumber: number;
  readonly phase: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly monitor: AgentMonitor;
  readonly child: ChildProcess;
}

// ── Constants ──

const PID_POLL_INTERVAL_MS = 5_000;

// ── AgentManager ──

export class AgentManager {
  private agents: TrackedAgent[] = [];
  private readonly config: HogConfig;
  private readonly eventBus: EventBus;
  private readonly workflow: WorkflowEngine;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: HogConfig, eventBus: EventBus, workflow: WorkflowEngine) {
    this.config = config;
    this.eventBus = eventBus;
    this.workflow = workflow;
  }

  /** Start PID polling and reconcile unprocessed results. */
  start(): void {
    this.reconcileResults();
    this.pollTimer = setInterval(() => this.pollLiveness(), PID_POLL_INTERVAL_MS);
  }

  /** Stop PID polling. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Get currently tracked agents. */
  getAgents(): readonly TrackedAgent[] {
    return this.agents;
  }

  /** Number of currently running agents. */
  get runningCount(): number {
    return this.agents.filter((a) => a.monitor.isRunning).length;
  }

  /** Maximum concurrent agents allowed. */
  get maxConcurrent(): number {
    return this.config.pipeline.maxConcurrentAgents;
  }

  /** Reconcile unprocessed result files from previous sessions. */
  reconcileResults(): void {
    const enrichment = this.workflow.getEnrichment();
    const processedFiles = new Set(
      enrichment.sessions.filter((s) => s.resultFile).map((s) => s.resultFile as string),
    );

    const unprocessed = findUnprocessedResults(processedFiles);
    for (const filePath of unprocessed) {
      const result = readResultFile(filePath);
      if (!result) continue;

      const sessionData = sessionFromResult(result, filePath);
      this.workflow.recordSession(sessionData);
    }

    if (unprocessed.length > 0) {
      this.eventBus.emit("mutation:completed", {
        description: `Reconciled ${unprocessed.length} background agent result${unprocessed.length > 1 ? "s" : ""}`,
      });
    }
  }

  /** Poll for PID liveness of background sessions without tracked child. */
  pollLiveness(): void {
    // Only check agents that THIS daemon instance launched (tracked and then lost)
    // Skip sessions from enrichment store — those are stale history from previous runs
    // and would cause false agent:failed events for already-completed phases
    const trackedPids = new Set(this.agents.map((a) => a.pid));
    for (const agent of this.agents) {
      if (!agent.monitor.isRunning) continue;
      if (!isProcessAlive(agent.pid)) {
        // Agent process died without going through normal exit handler
        this.workflow.markSessionExited(agent.sessionId, 1);
        this.eventBus.emit("agent:failed", {
          sessionId: agent.sessionId,
          repo: agent.repo,
          issueNumber: agent.issueNumber,
          phase: agent.phase,
          exitCode: 1,
          errorMessage: "Agent process died unexpectedly",
        });
      }
    }
  }

  /** Launch a new background agent. Returns session ID on success, error string on failure. */
  launchAgent(opts: SpawnAgentOptions): string | { error: string } {
    const running = this.agents.filter((a) => a.monitor.isRunning);
    if (running.length >= this.maxConcurrent) {
      return {
        error: `Max concurrent agents (${this.maxConcurrent}) reached. Wait for an agent to finish.`,
      };
    }

    const result = spawnBackgroundAgent(opts);
    if (!result.ok) {
      return { error: result.error.message };
    }

    const { child, pid, resultFilePath } = result.value;
    const startedAt = new Date().toISOString();

    const session = this.workflow.recordSession({
      repo: opts.repoFullName,
      issueNumber: opts.issueNumber,
      phase: opts.phase,
      mode: "background",
      pid,
      startedAt,
    });

    this.eventBus.emit("agent:spawned", {
      sessionId: session.id,
      repo: opts.repoFullName,
      issueNumber: opts.issueNumber,
      phase: opts.phase,
    });

    const onExit = (exitCode: number, monitor: AgentMonitor): void => {
      this.workflow.markSessionExited(session.id, exitCode);

      writeResultFile(resultFilePath, {
        sessionId: monitor.sessionId ?? session.id,
        phase: opts.phase,
        issueRef: `${opts.repoFullName}#${opts.issueNumber}`,
        startedAt,
        completedAt: new Date().toISOString(),
        exitCode,
        summary: monitor.lastText,
      });

      // Update enrichment with claude session ID and result file if available
      if (monitor.sessionId) {
        const enrichment = this.workflow.getEnrichment();
        const existing = enrichment.sessions.find((s) => s.id === session.id);
        if (existing) {
          this.workflow.recordSession({
            ...existing,
            claudeSessionId: monitor.sessionId,
            resultFile: resultFilePath,
          });
        }
      }

      // Remove from tracked agents
      this.agents = this.agents.filter((a) => a.sessionId !== session.id);

      if (exitCode === 0) {
        const summary = monitor.lastText?.slice(0, 500);
        this.eventBus.emit("agent:completed", {
          sessionId: session.id,
          repo: opts.repoFullName,
          issueNumber: opts.issueNumber,
          phase: opts.phase,
          summary,
        });
        notify(this.config.pipeline.notifications, {
          title: "Agent completed",
          body: summary ? `${opts.phase}: ${summary.slice(0, 100)}` : `${opts.phase} completed`,
        });
      } else {
        const errorMessage = monitor.lastText ?? `Process exited with code ${exitCode}`;
        this.eventBus.emit("agent:failed", {
          sessionId: session.id,
          repo: opts.repoFullName,
          issueNumber: opts.issueNumber,
          phase: opts.phase,
          exitCode,
          errorMessage,
        });
        notify(this.config.pipeline.notifications, {
          title: "Agent failed",
          body: `${opts.phase}: ${errorMessage.slice(0, 100)}`,
        });
      }
    };

    const monitor = attachStreamMonitor(
      child,
      (event) => {
        if (event.toolName ?? event.text) {
          const toolDisplay = event.toolDetail
            ? `${event.toolName} (${event.toolDetail})`
            : event.toolName;
          this.eventBus.emit("agent:progress", {
            sessionId: session.id,
            ...(toolDisplay ? { toolName: toolDisplay } : {}),
            ...(event.text ? { text: event.text } : {}),
          });
        }
      },
      onExit,
    );

    const tracked: TrackedAgent = {
      sessionId: session.id,
      repo: opts.repoFullName,
      issueNumber: opts.issueNumber,
      phase: opts.phase,
      pid,
      startedAt,
      monitor,
      child,
    };

    this.agents = [...this.agents, tracked];
    return session.id;
  }
}
