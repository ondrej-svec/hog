import { useCallback, useEffect, useRef, useState } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import { CONFIG_DIR } from "../../config.js";
import type { DaemonClient } from "../../daemon/client.js";
import type { RpcEvent } from "../../daemon/protocol.js";
import type { Pipeline } from "../../engine/conductor.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";

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
  readonly featureId?: string | undefined;
}

/** A structured activity entry for the cockpit feed. */
export interface ActivityEntry {
  readonly timestamp: string;
  readonly type:
    | "phase-start"
    | "phase-complete"
    | "agent-spawn"
    | "agent-progress"
    | "agent-complete"
    | "agent-fail";
  readonly phase?: string | undefined;
  readonly agentSessionId?: string | undefined;
  readonly detail: string;
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
  /** Structured activity log per pipeline (keyed by featureId). */
  readonly activityLog: ReadonlyMap<string, readonly ActivityEntry[]>;
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

// ── Helpers ──

/** Convert a JSONL EventLogEntry to a structured ActivityEntry. */
function eventLogToActivity(e: {
  timestamp: string;
  event: string;
  data: Record<string, unknown>;
}): ActivityEntry {
  const phase = e.data["phase"] as string | undefined;
  const sessionId = e.data["sessionId"] as string | undefined;

  switch (e.event) {
    case "agent:spawned":
      return {
        timestamp: e.timestamp,
        type: "agent-spawn",
        phase,
        agentSessionId: sessionId,
        detail: `Agent spawned for ${phase ?? "unknown"} phase`,
      };
    case "agent:progress":
      return {
        timestamp: e.timestamp,
        type: "agent-progress",
        agentSessionId: sessionId,
        detail: (e.data["toolName"] as string) ?? "working",
      };
    case "agent:completed":
      return {
        timestamp: e.timestamp,
        type: "agent-complete",
        phase,
        agentSessionId: sessionId,
        detail: (e.data["summary"] as string) ?? `${phase ?? "Agent"} phase completed`,
      };
    case "agent:failed":
      return {
        timestamp: e.timestamp,
        type: "agent-fail",
        phase,
        agentSessionId: sessionId,
        detail: (e.data["errorMessage"] as string) ?? `${phase ?? "Agent"} phase failed`,
      };
    case "workflow:phase-changed": {
      const state = e.data["state"] as string;
      return {
        timestamp: e.timestamp,
        type: state === "completed" ? "phase-complete" : "phase-start",
        phase,
        detail: `${phase ?? "Phase"} → ${state}`,
      };
    }
    default:
      return {
        timestamp: e.timestamp,
        type: "agent-progress",
        detail: e.event,
      };
  }
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
  const pipelinesRef = useRef<Pipeline[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [agents, setAgents] = useState<readonly DaemonAgentInfo[]>([]);
  const [pendingDecisions, setPendingDecisions] = useState<Question[]>([]);
  const [mergeQueue, setMergeQueue] = useState<readonly MergeQueueEntry[]>([]);
  const [beadsAvailable, setBeadsAvailable] = useState(false);
  const [daemonConnected, setDaemonConnected] = useState(false);
  const activityRef = useRef<Map<string, ActivityEntry[]>>(new Map());
  const [activityLog, setActivityLog] = useState<ReadonlyMap<string, readonly ActivityEntry[]>>(new Map());

  const MAX_ACTIVITY_ENTRIES = 100;

  const pushActivity = useCallback((featureId: string, entry: ActivityEntry) => {
    const map = activityRef.current;
    const existing = map.get(featureId) ?? [];
    existing.push(entry);
    // Keep only the last N entries
    if (existing.length > MAX_ACTIVITY_ENTRIES) {
      existing.splice(0, existing.length - MAX_ACTIVITY_ENTRIES);
    }
    map.set(featureId, existing);
    setActivityLog(new Map(map));
  }, []);

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
        const [pipelineData, agentData, decisionData, statusData, mergeQueueData] =
          await Promise.all([
            client.call("pipeline.list", {}),
            client.call("agent.list", {}),
            client.call("decision.list", {}),
            client.call("daemon.status", {}),
            client.call("mergeQueue.list", {}),
          ]);

        if (cancelled) {
          client.close();
          return;
        }

        setPipelines(pipelineData);
        pipelinesRef.current = pipelineData;
        const enrichedAgents = agentData.map((a) => ({ ...a, isRunning: true }));
        setAgents(enrichedAgents);
        setPendingDecisions(decisionData.filter((q) => !q.resolvedAt));
        setBeadsAvailable(statusData.pipelines >= 0); // daemon running = beads available
        setMergeQueue(mergeQueueData);

        // Seed session→featureId map from agent data
        for (const a of enrichedAgents) {
          if (a.featureId && a.sessionId) {
            sessionFeatureMap.set(a.sessionId, a.featureId);
          }
        }

        // Load initial activity from event logs
        for (const pipeline of pipelineData) {
          try {
            const events = await client.call("pipeline.events", {
              featureId: pipeline.featureId,
              limit: 50,
            });
            const entries: ActivityEntry[] = events.map((e) => eventLogToActivity(e));
            activityRef.current.set(pipeline.featureId, entries);
          } catch {
            // best-effort
          }
        }
        setActivityLog(new Map(activityRef.current));

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

    // Map sessionId → featureId for routing activity entries.
    // Seeded from agent.list on connect, updated on agent:spawned.
    const sessionFeatureMap = new Map<string, string>();

    // Resolve featureId from (1) event data, (2) session map, (3) single-pipeline fallback
    const resolveFeatureId = (
      data: Record<string, unknown>,
      sessionId: string | undefined,
    ): string | undefined => {
      // 1. Explicit in event data (rare, but future-proof)
      const explicit = data["featureId"] as string | undefined;
      if (explicit) return explicit;
      // 2. Session map (populated from agent.list + agent:spawned)
      if (sessionId) {
        const mapped = sessionFeatureMap.get(sessionId);
        if (mapped) return mapped;
      }
      // 3. If there's only one pipeline, route there (most common case)
      const current = pipelinesRef.current;
      if (current.length === 1) return current[0]?.featureId;
      // 4. Match via repo if available (events carry repo)
      const repo = data["repo"] as string | undefined;
      if (repo) {
        const match = current.find((p) => p.repo === repo);
        if (match) return match.featureId;
      }
      return undefined;
    };

    const handleEvent = (event: RpcEvent) => {
      const data = event.data as Record<string, unknown>;
      const ts = new Date().toISOString();
      const sessionId = data["sessionId"] as string | undefined;
      const phase = data["phase"] as string | undefined;

      switch (event.event) {
        case "agent:spawned": {
          const featureId = resolveFeatureId(data, sessionId);
          if (sessionId && featureId) sessionFeatureMap.set(sessionId, featureId);
          setAgents((prev) => [
            ...prev,
            {
              sessionId: sessionId ?? "",
              repo: data["repo"] as string,
              phase: phase ?? "",
              pid: 0,
              startedAt: ts,
              isRunning: true,
              featureId,
            },
          ]);
          if (featureId) {
            pushActivity(featureId, {
              timestamp: ts,
              type: "agent-spawn",
              phase,
              agentSessionId: sessionId,
              detail: `Agent spawned for ${phase ?? "unknown"} phase`,
            });
          }
          break;
        }

        case "agent:progress": {
          const toolName = data["toolName"] as string | undefined;
          const featureId = resolveFeatureId(data, sessionId);
          // Update the map if we resolved it (e.g. via single-pipeline fallback)
          if (sessionId && featureId) sessionFeatureMap.set(sessionId, featureId);
          setAgents((prev) =>
            prev.map((a) =>
              a.sessionId === sessionId
                ? { ...a, lastToolUse: toolName ?? a.lastToolUse }
                : a,
            ),
          );
          if (featureId && toolName) {
            pushActivity(featureId, {
              timestamp: ts,
              type: "agent-progress",
              agentSessionId: sessionId,
              detail: toolName,
            });
          }
          break;
        }

        case "agent:completed": {
          const featureId = resolveFeatureId(data, sessionId);
          setAgents((prev) =>
            prev.map((a) => (a.sessionId === sessionId ? { ...a, isRunning: false } : a)),
          );
          if (featureId) {
            const summary = data["summary"] as string | undefined;
            pushActivity(featureId, {
              timestamp: ts,
              type: "agent-complete",
              phase,
              agentSessionId: sessionId,
              detail: summary ?? `${phase ?? "Agent"} phase completed`,
            });
          }
          break;
        }

        case "agent:failed": {
          const featureId = resolveFeatureId(data, sessionId);
          setAgents((prev) =>
            prev.map((a) => (a.sessionId === sessionId ? { ...a, isRunning: false } : a)),
          );
          if (featureId) {
            const errorMsg = data["errorMessage"] as string | undefined;
            pushActivity(featureId, {
              timestamp: ts,
              type: "agent-fail",
              phase,
              agentSessionId: sessionId,
              detail: errorMsg ?? `${phase ?? "Agent"} phase failed`,
            });
          }
          break;
        }

        case "workflow:phase-changed": {
          const state = data["state"] as string | undefined;
          const featureId = resolveFeatureId(data, sessionId);
          if (featureId && phase && state) {
            pushActivity(featureId, {
              timestamp: ts,
              type: state === "completed" ? "phase-complete" : "phase-start",
              phase,
              detail: `${phase} → ${state}`,
            });
          }
          break;
        }
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
        const [pipelineData, decisionData, mergeQueueData] = await Promise.all([
          client.call("pipeline.list", {}),
          client.call("decision.list", {}),
          client.call("mergeQueue.list", {}),
        ]);
        setPipelines(pipelineData);
        pipelinesRef.current = pipelineData;
        setPendingDecisions(decisionData.filter((q) => !q.resolvedAt));
        setMergeQueue(mergeQueueData);
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
          const filtered = raw.filter((p: Record<string, unknown>) => p["featureId"] !== featureId);
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
    activityLog,
    beadsAvailable,
    daemonConnected,
    startPipeline,
    pausePipeline,
    resumePipeline,
    cancelPipeline,
    resolveDecision,
  };
}
