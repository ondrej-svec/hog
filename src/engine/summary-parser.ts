/**
 * Summary Sentiment Parser — detects failure signals in agent output.
 *
 * Claude exits 0 when it finishes its conversation, even if the conversation
 * concluded with "I can't do this." The summary is the only semantic signal.
 * This parser catches the merge gatekeeper "CANNOT PROCEED" case.
 */

import type { PipelineRole } from "./roles.js";

// ── Failure Patterns ──

interface FailurePattern {
  readonly pattern: RegExp;
  /** Phases where this pattern is expected (not a failure signal). */
  readonly excludePhases?: readonly PipelineRole[];
}

const FAILURE_PATTERNS: readonly FailurePattern[] = [
  { pattern: /CANNOT PROCEED/i },
  { pattern: /requires clarification/i },
  { pattern: /manual intervention/i },
  { pattern: /unable to complete/i },
  // "FAILED" is normal in redteam/test context (tests are supposed to fail)
  // "BLOCK"/"FAILED" is expected in merge/ship — their gates handle retry
  { pattern: /\bFAILED\b/i, excludePhases: ["redteam", "test", "merge", "ship"] },
  { pattern: /\bblocked\b/i, excludePhases: ["redteam", "merge", "ship"] },
];

// ── Public API ──

export interface SentimentResult {
  /** Whether any failure pattern matched. */
  readonly failed: boolean;
  /** The matching pattern text (for logging). */
  readonly matchedPattern?: string | undefined;
}

/**
 * Check an agent's summary text for failure signals.
 * Phase-aware: some patterns are expected in certain phases.
 */
export function checkSummaryForFailure(
  summary: string | undefined,
  phase: PipelineRole,
): SentimentResult {
  if (!summary) return { failed: false };

  for (const { pattern, excludePhases } of FAILURE_PATTERNS) {
    if (excludePhases?.includes(phase)) continue;
    if (pattern.test(summary)) {
      return { failed: true, matchedPattern: pattern.source };
    }
  }

  return { failed: false };
}
