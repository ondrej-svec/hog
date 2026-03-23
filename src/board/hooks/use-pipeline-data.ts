import { useCallback, useEffect, useRef, useState } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import type { TrackedAgent } from "../../engine/agent-manager.js";
import { AgentManager } from "../../engine/agent-manager.js";
import { BeadsClient } from "../../engine/beads.js";
import type { Pipeline } from "../../engine/conductor.js";
import { Conductor } from "../../engine/conductor.js";
import { EventBus } from "../../engine/event-bus.js";
import type { Question } from "../../engine/question-queue.js";
import {
  getPendingQuestions,
  resolveQuestion,
  saveQuestionQueue,
} from "../../engine/question-queue.js";
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

  // Initialize conductor on mount
  useEffect(() => {
    const eventBus = new EventBus();
    const beads = new BeadsClient(config.board.assignee);
    const workflow = new WorkflowEngine(config, eventBus);
    const agentManager = new AgentManager(config, eventBus, workflow);
    const conductor = new Conductor(config, eventBus, agentManager, beads);

    agentManagerRef.current = agentManager;
    conductorRef.current = conductor;

    setBeadsAvailable(beads.isInstalled());

    // Start agent manager for PID polling
    agentManager.start();

    // Listen for events to show toasts
    eventBus.on("agent:completed", (ev) => {
      toast.success(`Agent completed: ${ev.phase} for #${ev.issueNumber || ev.repo}`);
    });
    eventBus.on("agent:failed", (ev) => {
      toast.error(`Agent failed: ${ev.phase} (exit ${ev.exitCode})`);
    });

    return () => {
      conductor.stop();
      agentManager.stop();
      eventBus.removeAllListeners();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — config is stable

  // Poll conductor state
  useEffect(() => {
    const interval = setInterval(() => {
      const conductor = conductorRef.current;
      const agentManager = agentManagerRef.current;
      if (!conductor) return;

      setPipelines(conductor.getPipelines());
      setPendingDecisions(getPendingQuestions(conductor.getQuestionQueue()));
      if (agentManager) {
        setAgents(agentManager.getAgents());
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

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
          setPipelines(conductor.getPipelines());
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

  const resolveDecision = useCallback(
    (questionId: string, answer: string) => {
      const conductor = conductorRef.current;
      if (!conductor) return;
      const queue = conductor.getQuestionQueue();
      const updated = resolveQuestion(queue, questionId, answer);
      saveQuestionQueue(updated);
      setPendingDecisions(getPendingQuestions(updated));
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
    resolveDecision,
  };
}
