import { useCallback, useEffect, useRef, useState } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import { CONFIG_DIR } from "../../config.js";
import type { Pipeline } from "../../engine/conductor.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";
import type { DaemonClient } from "../../daemon/client.js";
import type { RpcEvent } from "../../daemon/protocol.js";

// ── Types ──

/** Agent info from daemon — replaces TrackedAgent for TUI consumers. */
export interface DaemonAgentInfo {
  readonly sessionId: string;
  readonly repo: string;
  readonly phase: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly lastToolUse?: string | undefined;
  readonly isRunning: boolean;
}

export interface UsePipelineDataResult {
  /** All active pipelines. */
  readonly pipelines: Pipeline[];
  /** Tracked background agents (from daemon). */
  readonly agents: readonly DaemonAgentInfo[];
  /** Pending human decisions. */
  readonly pendingDecisions: Question[];
  /** Merge queue entries. */
  readonly mergeQueue: readonly MergeQueueEntry[];
  /** Whether Beads CLI is available. */
  readonly beadsAvailable: boolean;
  /** Whether connected to daemon. */
  readonly daemonConnected: boolean;
  /** Start a new pipeline. Returns pipeline or error. */
  readonly startPipeline: (
    repo: string,
    repoConfig: RepoConfig,
    title: string,
    description: string,
  ) => Promise<Pipeline | { error: string }>;
  /** Pause a pipeline. */
  readonly pausePipeline: (featureId: string) => Promise<boolean>;
  /** Resume a pipeline. */
  readonly resumePipeline: (featureId: string) => Promise<boolean>;
  /** Cancel and remove a pipeline. */
  readonly cancelPipeline: (featureId: string) => Promise<boolean>;
  /** Resolve a pending question. */
  readonly resolveDecision: (questionId: string, answer: string) => void;
}

// ── Constants ──

const POLL_INTERVAL_MS = 3_000;

// ── Hook ──

export function usePipelineData(
  config: HogConfig,
  toast: {
    info: (msg: string) => void;
    success: (msg: string) => void;
    error: (msg: string) => void;
  },
): UsePipelineDataResult {
  const clientRef = useRef<DaemonClient | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [agents, setAgents] = useState<readonly DaemonAgentInfo[]>([]);
  const [pendingDecisions, setPendingDecisions] = useState<Question[]>([]);
  const [mergeQueue] = useState<readonly MergeQueueEntry[]>([]);
  const [beadsAvailable, setBeadsAvailable] = useState(false);
  const [daemonConnected, setDaemonConnected] = useState(false);

  // Connect to daemon and subscribe to events
  useEffect(() => {
    const isTest = process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true";
    if (isTest) return;

    let cancelled = false;

    const connect = async () => {
      try {
        const { tryConnectDaemon } = await import("../../daemon/client.js");
        const client = await tryConnectDaemon();
        if (!client || cancelled) return;

        clientRef.current = client;
        setDaemonConnected(true);

        // Initial data load
        const [pipelineData, agentData, decisionData, statusData] = await Promise.all([
          client.call("pipeline.list", {}),
          client.call("agent.list", {}),
          client.call("decision.list", {}),
          client.call("daemon.status", {}),
        ]);

        if (cancelled) {
          client.close();
          return;
        }

        setPipelines(pipelineData);
        setAgents(agentData.map((a) => ({ ...a, isRunning: true })));
        setPendingDecisions(decisionData.filter((q) => !q.resolvedAt));
        setBeadsAvailable(statusData.pipelines >= 0); // daemon running = beads available

        // Subscribe to push events for real-time updates
        client.subscribe((event: RpcEvent) => {
          if (cancelled) return;
          handleEvent(event);
        });
      } catch {
        // Daemon not available — will retry on poll
        setDaemonConnected(false);
      }
    };

    const handleEvent = (event: RpcEvent) => {
      const data = event.data as Record<string, unknown>;

      switch (event.event) {
        case "agent:spawned":
          setAgents((prev) => [
            ...prev,
            {
              sessionId: data["sessionId"] as string,
              repo: data["repo"] as string,
              phase: data["phase"] as string,
              pid: 0,
              startedAt: new Date().toISOString(),
              isRunning: true,
            },
          ]);
          break;

        case "agent:progress":
          setAgents((prev) =>
            prev.map((a) =>
              a.sessionId === data["sessionId"]
                ? { ...a, lastToolUse: (data["toolName"] as string) ?? a.lastToolUse }
                : a,
            ),
          );
          break;

        case "agent:completed":
          setAgents((prev) =>
            prev.map((a) =>
              a.sessionId === data["sessionId"] ? { ...a, isRunning: false } : a,
            ),
          );
          break;

        case "agent:failed":
          setAgents((prev) =>
            prev.map((a) =>
              a.sessionId === data["sessionId"] ? { ...a, isRunning: false } : a,
            ),
          );
          break;
      }
    };

    connect();

    // Poll for pipeline/decision state (events may miss some transitions)
    const pollInterval = setInterval(async () => {
      const client = clientRef.current;
      if (!client?.isConnected) {
        setDaemonConnected(false);
        // Try reconnecting
        connect();
        return;
      }

      try {
        const [pipelineData, decisionData] = await Promise.all([
          client.call("pipeline.list", {}),
          client.call("decision.list", {}),
        ]);
        setPipelines(pipelineData);
        setPendingDecisions(decisionData.filter((q) => !q.resolvedAt));
      } catch {
        setDaemonConnected(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      const client = clientRef.current;
      if (client) {
        client.close();
        clientRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — config is stable

  const startPipeline = useCallback(
    async (
      repo: string,
      _repoConfig: RepoConfig,
      title: string,
      description: string,
    ): Promise<Pipeline | { error: string }> => {
      const client = clientRef.current;
      if (!client?.isConnected) return { error: "Not connected to daemon" };

      try {
        const result = await client.call("pipeline.create", {
          repo,
          title,
          description,
          localPath: process.cwd(),
        });
        if (!("error" in result)) {
          toast.info(`Pipeline started: ${title}`);
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: msg };
      }
    },
    [toast],
  );

  const pausePipeline = useCallback(async (featureId: string): Promise<boolean> => {
    const client = clientRef.current;
    if (!client?.isConnected) return false;
    const { ok } = await client.call("pipeline.pause", { featureId });
    return ok;
  }, []);

  const resumePipeline = useCallback(async (featureId: string): Promise<boolean> => {
    const client = clientRef.current;
    if (!client?.isConnected) return false;
    const { ok } = await client.call("pipeline.resume", { featureId });
    return ok;
  }, []);

  const cancelPipeline = useCallback(async (featureId: string): Promise<boolean> => {
    const client = clientRef.current;
    if (client?.isConnected) {
      try {
        const { ok } = await client.call("pipeline.cancel", { featureId });
        if (ok) return true;
      } catch {
        // Daemon call failed — fall through to direct file removal
      }
    }

    // Fallback: remove directly from pipelines.json
    try {
      const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const file = join(CONFIG_DIR, "pipelines.json");
      if (existsSync(file)) {
        const raw: unknown = JSON.parse(readFileSync(file, "utf-8"));
        if (Array.isArray(raw)) {
          const filtered = raw.filter(
            (p: Record<string, unknown>) => p["featureId"] !== featureId,
          );
          writeFileSync(file, `${JSON.stringify(filtered, null, 2)}\n`, { mode: 0o600 });
          return true;
        }
      }
    } catch {
      // best-effort
    }
    return false;
  }, []);

  const resolveDecision = useCallback(
    (questionId: string, answer: string) => {
      const client = clientRef.current;
      if (!client?.isConnected) return;
      client.call("decision.resolve", { questionId, answer }).catch(() => {});
      toast.info(`Decision resolved: ${answer}`);
    },
    [toast],
  );

  return {
    pipelines,
    agents,
    pendingDecisions,
    mergeQueue,
    beadsAvailable,
    daemonConnected,
    startPipeline,
    pausePipeline,
    resumePipeline,
    cancelPipeline,
    resolveDecision,
  };
}
