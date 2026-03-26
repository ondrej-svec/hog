import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import { CONFIG_DIR } from "../../config.js";
import type { TrackedAgent } from "../../engine/agent-manager.js";
import { AgentManager } from "../../engine/agent-manager.js";
import { BeadsClient } from "../../engine/beads.js";
import type { Pipeline } from "../../engine/conductor.js";
import { Conductor } from "../../engine/conductor.js";
import { EventBus } from "../../engine/event-bus.js";
import type { Question } from "../../engine/question-queue.js";
import { getPendingQuestions, loadQuestionQueue } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";
import { WorkflowEngine } from "../../engine/workflow.js";

// ── Types ──

export interface UsePipelineDataResult {
  /** All active pipelines. */
  readonly pipelines: Pipeline[];
  /** Tracked background agents. */
  readonly agents: readonly TrackedAgent[];
  /** Pending human decisions. */
  readonly pendingDecisions: Question[];
  /** Merge queue entries. */
  readonly mergeQueue: readonly MergeQueueEntry[];
  /** Whether Beads CLI is available. */
  readonly beadsAvailable: boolean;
  /** Start a new pipeline. Returns pipeline or error. */
  readonly startPipeline: (
    repo: string,
    repoConfig: RepoConfig,
    title: string,
    description: string,
  ) => Promise<Pipeline | { error: string }>;
  /** Pause a pipeline. */
  readonly pausePipeline: (featureId: string) => boolean;
  /** Resume a pipeline. */
  readonly resumePipeline: (featureId: string) => boolean;
  /** Cancel and remove a pipeline. */
  readonly cancelPipeline: (featureId: string) => boolean;
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
  // Conductor and its dependencies — created once, stable across renders
  const conductorRef = useRef<Conductor | null>(null);
  const agentManagerRef = useRef<AgentManager | null>(null);

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [agents, setAgents] = useState<readonly TrackedAgent[]>([]);
  const [pendingDecisions, setPendingDecisions] = useState<Question[]>([]);
  const [mergeQueue] = useState<readonly MergeQueueEntry[]>([]);
  const [beadsAvailable, setBeadsAvailable] = useState(false);

  // Initialize conductor for creation only (no tick loop)
  useEffect(() => {
    const eventBus = new EventBus();
    const beads = new BeadsClient(config.board.assignee);
    const workflow = new WorkflowEngine(config, eventBus);
    const agentManager = new AgentManager(config, eventBus, workflow);
    const conductor = new Conductor(config, eventBus, agentManager, beads);

    agentManagerRef.current = agentManager;
    conductorRef.current = conductor;

    setBeadsAvailable(beads.isInstalled());

    // Start agent manager for PID polling (tracks running agents)
    agentManager.start();
    // NOTE: conductor.start() is NOT called — cockpit does not tick.
    // The watcher process is the engine that advances pipelines.

    return () => {
      agentManager.stop();
      eventBus.removeAllListeners();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — config is stable

  // Poll pipelines.json + question-queue.json for display (cockpit is read-only for state)
  useEffect(() => {
    const pipelinesFile = join(CONFIG_DIR, "pipelines.json");

    const isTest = process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true";

    const poll = () => {
      // In test environment, don't read from real filesystem
      if (isTest) return;

      // Read pipelines from disk (written by watcher processes)
      try {
        if (existsSync(pipelinesFile)) {
          const raw: unknown = JSON.parse(readFileSync(pipelinesFile, "utf-8"));
          if (Array.isArray(raw)) {
            const loaded: Pipeline[] = [];
            for (const e of raw) {
              if (typeof e !== "object" || e === null) continue;
              const entry = e as Record<string, unknown>;
              if (typeof entry["featureId"] !== "string") continue;
              // Skip completed/failed
              if (entry["status"] === "completed" || entry["status"] === "failed") continue;

              const repoConfig =
                config.repos.find((r) => r.name === entry["repo"]) ??
                ({
                  name: (entry["repo"] as string) ?? "",
                  shortName: (entry["repo"] as string) ?? "",
                  projectNumber: 0,
                  statusFieldId: "",
                  localPath: (entry["localPath"] as string) ?? "",
                  completionAction: { type: "closeIssue" },
                } as RepoConfig);

              loaded.push({
                featureId: entry["featureId"] as string,
                title: (entry["title"] as string) ?? "",
                repo: (entry["repo"] as string) ?? "",
                localPath: (entry["localPath"] as string) ?? "",
                repoConfig,
                beadIds: entry["beadIds"] as Pipeline["beadIds"],
                status: (entry["status"] as Pipeline["status"]) ?? "running",
                completedBeads: (entry["completedBeads"] as number) ?? 0,
                activePhase: entry["activePhase"] as string | undefined,
                startedAt: (entry["startedAt"] as string) ?? "",
                ...(typeof entry["completedAt"] === "string"
                  ? { completedAt: entry["completedAt"] }
                  : {}),
              });
            }
            setPipelines(loaded);
          }
        } else {
          setPipelines([]);
        }
      } catch {
        // best-effort
      }

      // Read question queue from disk
      try {
        const queue = loadQuestionQueue();
        setPendingDecisions(getPendingQuestions(queue));
      } catch {
        // best-effort
      }

      // Read agent state from agent manager
      const agentManager = agentManagerRef.current;
      if (agentManager) {
        setAgents(agentManager.getAgents());
      }
    };

    poll(); // immediate
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [config.repos]);

  const startPipeline = useCallback(
    async (
      repo: string,
      repoConfig: RepoConfig,
      title: string,
      description: string,
    ): Promise<Pipeline | { error: string }> => {
      const conductor = conductorRef.current;
      if (!conductor) return { error: "Conductor not initialized" };

      try {
        const result = await conductor.startPipeline(repo, repoConfig, title, description);
        if (!("error" in result)) {
          // Spawn a watcher process to advance the pipeline (cockpit doesn't tick)
          try {
            const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "cli.js");
            const watchArgs = ["pipeline", "watch", result.featureId, "--repo", repo];
            const child = spawn(process.execPath, [cliPath, ...watchArgs], {
              detached: true,
              stdio: "ignore",
            });
            child.unref();
          } catch {
            // watcher spawn failed — pipeline won't advance automatically
          }
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

  const pausePipeline = useCallback((featureId: string): boolean => {
    const conductor = conductorRef.current;
    if (!conductor) return false;
    const ok = conductor.pausePipeline(featureId);
    if (ok) setPipelines(conductor.getPipelines());
    return ok;
  }, []);

  const resumePipeline = useCallback((featureId: string): boolean => {
    const conductor = conductorRef.current;
    if (!conductor) return false;
    const ok = conductor.resumePipeline(featureId);
    if (ok) setPipelines(conductor.getPipelines());
    return ok;
  }, []);

  const cancelPipeline = useCallback((featureId: string): boolean => {
    const conductor = conductorRef.current;
    if (!conductor) return false;
    const ok = conductor.cancelPipeline(featureId);
    if (ok) setPipelines(conductor.getPipelines());
    return ok;
  }, []);

  const resolveDecision = useCallback(
    (questionId: string, answer: string) => {
      const conductor = conductorRef.current;
      if (!conductor) return;
      // Use conductor's method to update its in-memory queue AND persist
      conductor.resolveQuestion(questionId, answer);
      setPendingDecisions(getPendingQuestions(conductor.getQuestionQueue()));
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
    startPipeline,
    pausePipeline,
    resumePipeline,
    cancelPipeline,
    resolveDecision,
  };
}
