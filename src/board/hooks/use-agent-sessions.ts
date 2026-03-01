import type { ChildProcess } from "node:child_process";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HogConfig } from "../../config.js";
import { notify } from "../../notify.js";
import type { AgentMonitor, SpawnAgentOptions, StreamEvent } from "../spawn-agent.js";
import {
  attachStreamMonitor,
  findUnprocessedResults,
  isProcessAlive,
  readResultFile,
  sessionFromResult,
  spawnBackgroundAgent,
  writeResultFile,
} from "../spawn-agent.js";
import type { UseWorkflowStateResult } from "./use-workflow-state.js";

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

export interface UseAgentSessionsResult {
  /** Currently tracked background agents. */
  readonly agents: readonly TrackedAgent[];
  /** Launch a new background agent. Returns session ID on success, error string on failure. */
  readonly launchAgent: (opts: SpawnAgentOptions) => string | { error: string };
  /** Number of currently running agents. */
  readonly runningCount: number;
  /** Maximum concurrent agents allowed. */
  readonly maxConcurrent: number;
}

// ── Constants ──

const PID_POLL_INTERVAL_MS = 5_000;

// ── Hook ──

export function useAgentSessions(
  config: HogConfig,
  workflowState: UseWorkflowStateResult,
  toast: {
    info: (msg: string) => void;
    success: (msg: string) => void;
    error: (msg: string) => void;
  },
): UseAgentSessionsResult {
  const [agents, setAgents] = useState<TrackedAgent[]>([]);
  const agentsRef = useRef<TrackedAgent[]>([]);
  agentsRef.current = agents;

  const workflowStateRef = useRef(workflowState);
  workflowStateRef.current = workflowState;

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const configRef = useRef(config);
  configRef.current = config;

  const maxConcurrent = config.board.workflow?.maxConcurrentAgents ?? 3;

  // ── Reconcile unprocessed result files on mount ──

  useEffect(() => {
    const enrichment = workflowStateRef.current.enrichment;
    const processedFiles = new Set(
      enrichment.sessions.filter((s) => s.resultFile).map((s) => s.resultFile as string),
    );

    const unprocessed = findUnprocessedResults(processedFiles);
    for (const filePath of unprocessed) {
      const result = readResultFile(filePath);
      if (!result) continue;

      const sessionData = sessionFromResult(result, filePath);
      workflowStateRef.current.recordSession(sessionData);
    }

    if (unprocessed.length > 0) {
      toastRef.current.info(
        `Reconciled ${unprocessed.length} background agent result${unprocessed.length > 1 ? "s" : ""}`,
      );
    }
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── PID polling for background sessions without tracked child ──

  useEffect(() => {
    const interval = setInterval(() => {
      const enrichment = workflowStateRef.current.enrichment;
      const activeBgSessions = enrichment.sessions.filter(
        (s) => s.mode === "background" && !s.exitedAt && s.pid,
      );

      for (const session of activeBgSessions) {
        // Skip sessions we're tracking via child process handle
        const isTracked = agentsRef.current.some((a) => a.sessionId === session.id);
        if (isTracked) continue;

        // Check if PID is still alive
        if (!isProcessAlive(session.pid as number)) {
          workflowStateRef.current.markSessionExited(session.id, 1);
          toastRef.current.info(
            `Background agent for #${session.issueNumber} (${session.phase}) exited`,
          );
          notify(configRef.current.board.workflow?.notifications, {
            title: "Agent exited",
            body: `${session.phase} for #${session.issueNumber} exited`,
          });
        }
      }
    }, PID_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // ── Launch agent ──

  const launchAgent = useCallback(
    (opts: SpawnAgentOptions): string | { error: string } => {
      const running = agentsRef.current.filter((a) => a.monitor.isRunning);
      if (running.length >= maxConcurrent) {
        return {
          error: `Max concurrent agents (${maxConcurrent}) reached. Wait for an agent to finish.`,
        };
      }

      const result = spawnBackgroundAgent(opts);
      if (!result.ok) {
        return { error: result.error.message };
      }

      const { child, pid, resultFilePath } = result.value;
      const startedAt = new Date().toISOString();

      // Record session in enrichment
      const session = workflowStateRef.current.recordSession({
        repo: opts.repoFullName,
        issueNumber: opts.issueNumber,
        phase: opts.phase,
        mode: "background",
        pid,
        startedAt,
      });

      const onEvent = (_event: StreamEvent): void => {
        // Events update the monitor state in-place via attachStreamMonitor
      };

      const onExit = (exitCode: number, monitor: AgentMonitor): void => {
        // Update enrichment with exit info
        const ws = workflowStateRef.current;
        ws.markSessionExited(session.id, exitCode);

        // Write result file
        writeResultFile(resultFilePath, {
          sessionId: monitor.sessionId ?? session.id,
          phase: opts.phase,
          issueRef: `${opts.repoFullName}#${opts.issueNumber}`,
          startedAt,
          completedAt: new Date().toISOString(),
          exitCode,
          artifacts: [],
          summary: monitor.lastText,
        });

        // Update enrichment with claude session ID and result file if available
        if (monitor.sessionId) {
          const enrichment = ws.enrichment;
          const existing = enrichment.sessions.find((s) => s.id === session.id);
          if (existing) {
            ws.recordSession({
              ...existing,
              claudeSessionId: monitor.sessionId,
              resultFile: resultFilePath,
            });
          }
        }

        // Remove from tracked agents
        setAgents((prev) => prev.filter((a) => a.sessionId !== session.id));

        if (exitCode === 0) {
          toastRef.current.success(`Agent completed: ${opts.phase} for #${opts.issueNumber}`);
          notify(configRef.current.board.workflow?.notifications, {
            title: "Agent completed",
            body: `${opts.phase} for #${opts.issueNumber} completed successfully`,
          });
        } else {
          toastRef.current.error(
            `Agent failed (exit ${exitCode}): ${opts.phase} for #${opts.issueNumber}`,
          );
          notify(configRef.current.board.workflow?.notifications, {
            title: "Agent failed",
            body: `${opts.phase} for #${opts.issueNumber} failed (exit ${exitCode})`,
          });
        }
      };

      const monitor = attachStreamMonitor(child, onEvent, onExit);

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

      setAgents((prev) => [...prev, tracked]);
      return session.id;
    },
    [maxConcurrent],
  );

  return {
    agents,
    launchAgent,
    runningCount: agents.filter((a) => a.monitor.isRunning).length,
    maxConcurrent,
  };
}
