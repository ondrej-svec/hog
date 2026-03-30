/**
 * Unified retry engine — replaces 5 inline retry blocks in the conductor
 * with a single, declarative system.
 *
 * Each gate is a pure function: given pipeline state and phase context,
 * it returns whether to proceed or retry. The engine runs all applicable
 * gates and produces a unified decision.
 */

import type { PipelineRole } from "./roles.js";

// ── Types ──

export interface RetryGateResult {
  /** Whether the gate passed. */
  readonly passed: boolean;
  /** Human-readable reason for failure. */
  readonly reason?: string | undefined;
  /** Specific items that are missing or problematic. */
  readonly missing?: readonly string[] | undefined;
  /** Context for the retry agent (truncated summary, failure details). */
  readonly context?: string | undefined;
}

export interface RetryAction {
  /** Which gate triggered the retry. */
  readonly gateId: string;
  /** Which role's bead to reopen. */
  readonly retryRole: PipelineRole;
  /** Additional beads to reopen (e.g., merge when impl retries). */
  readonly alsoReopen?: readonly PipelineRole[] | undefined;
  /** How many completedBeads to decrement. */
  readonly decrementBeads: number;
  /** Feedback to inject into the retried agent's prompt. */
  readonly feedback: {
    readonly reason: string;
    readonly missing: readonly string[];
    readonly context: string;
  };
}

export interface EscalationAction {
  /** Which gate triggered the escalation. */
  readonly gateId: string;
  /** Question to present to the human. */
  readonly question: string;
  /** Options for the human. */
  readonly options: readonly string[];
}

export type GateDecision =
  | { action: "proceed" }
  | { action: "retry"; retries: readonly RetryAction[] }
  | { action: "escalate"; escalations: readonly EscalationAction[] };

export interface RetryGateConfig {
  /** Unique gate identifier. */
  readonly id: string;
  /** Which phases this gate applies to. */
  readonly phases: readonly PipelineRole[];
  /** Role to retry on failure. */
  readonly retryRole: PipelineRole;
  /** Additional beads to reopen. */
  readonly alsoReopen?: readonly PipelineRole[] | undefined;
  /** Number of completedBeads to decrement on retry. */
  readonly decrementBeads: number;
  /** Maximum automatic retries before escalation. */
  readonly maxRetries: number;
  /** How retry attempts are tracked — either via context.retryFeedback or decisionLog. */
  readonly trackingMethod: "retryFeedback" | "decisionLog";
}

// ── Gate Registry ──
// Declarative configuration for all retry loops in the pipeline.

export const GATE_CONFIGS: readonly RetryGateConfig[] = [
  {
    id: "coverage-gate",
    phases: ["test"],
    retryRole: "test",
    decrementBeads: 0,
    maxRetries: 2,
    trackingMethod: "retryFeedback",
  },
  {
    id: "spec-quality",
    phases: ["test"],
    retryRole: "test",
    decrementBeads: 0,
    maxRetries: 2,
    trackingMethod: "retryFeedback",
  },
  {
    id: "stub-gate",
    phases: ["impl"],
    retryRole: "impl",
    decrementBeads: 0,
    maxRetries: 2,
    trackingMethod: "retryFeedback",
  },
  {
    id: "conform-gate",
    phases: ["impl"],
    retryRole: "impl",
    decrementBeads: 0,
    maxRetries: 3,
    trackingMethod: "retryFeedback",
  },
  {
    id: "green-gate",
    phases: ["impl"],
    retryRole: "impl",
    decrementBeads: 1,
    maxRetries: 2,
    trackingMethod: "decisionLog",
  },
  {
    id: "redteam-gate",
    phases: ["redteam"],
    retryRole: "impl",
    alsoReopen: ["merge"],
    decrementBeads: 2,
    maxRetries: 2,
    trackingMethod: "decisionLog",
  },
  {
    id: "merge-gate",
    phases: ["merge"],
    retryRole: "impl",
    alsoReopen: ["merge"],
    decrementBeads: 2,
    maxRetries: 2,
    trackingMethod: "decisionLog",
  },
] as const;

/**
 * Get all gate configs that apply to a given phase.
 */
export function gatesForPhase(phase: PipelineRole): readonly RetryGateConfig[] {
  return GATE_CONFIGS.filter((g) => g.phases.includes(phase));
}

/**
 * Build escalation options for a gate failure.
 * All gates follow the same pattern: retry, skip, or cancel.
 */
export function buildEscalationOptions(gateId: string): readonly string[] {
  switch (gateId) {
    case "coverage-gate":
      return ["Retry tests", "Continue with partial coverage", "Cancel pipeline"];
    case "spec-quality":
      return ["Retry tests", "Continue with string-matching tests", "Cancel pipeline"];
    case "stub-gate":
      return ["Retry impl", "Continue with stubs", "Cancel pipeline"];
    case "conform-gate":
      return ["Retry impl", "Skip conformance check", "Cancel pipeline"];
    case "green-gate":
      return ["Retry impl", "Skip green check", "Cancel pipeline"];
    case "redteam-gate":
      return ["Retry impl", "Skip redteam issues", "Cancel pipeline"];
    case "merge-gate":
      return ["Retry impl", "Force merge", "Cancel pipeline"];
    default:
      return ["Retry", "Skip", "Cancel pipeline"];
  }
}

/**
 * Evaluate a gate check result against its config to produce a decision.
 *
 * Pure function: given check result + current attempt count, returns
 * proceed / retry / escalate. The conductor applies the side effects.
 */
export function evaluateGate(
  gateId: string,
  result: RetryGateResult,
  currentAttempts: number,
): GateDecision {
  if (result.passed) return { action: "proceed" };

  const config = GATE_CONFIGS.find((g) => g.id === gateId);
  if (!config) return { action: "proceed" };

  if (currentAttempts < config.maxRetries) {
    return {
      action: "retry",
      retries: [
        {
          gateId,
          retryRole: config.retryRole,
          alsoReopen: config.alsoReopen,
          decrementBeads: config.decrementBeads,
          feedback: {
            reason: result.reason ?? "Gate check failed",
            missing: [...(result.missing ?? [])],
            context: result.context ?? "",
          },
        },
      ],
    };
  }

  return {
    action: "escalate",
    escalations: [
      {
        gateId,
        question: result.reason ?? `${gateId} failed after ${config.maxRetries} retries`,
        options: [...buildEscalationOptions(gateId)],
      },
    ],
  };
}
