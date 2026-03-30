---
title: "Pipeline Feedback Loops — Making Agents Actually Collaborate"
type: brainstorm
date: 2026-03-30
participants: [Ondrej, Claude Opus 4.6]
related:
  - docs/plans/2026-03-30-feat-impl-phase-depth-plan.md
  - docs/solutions/2026-03-30-tracer-bullet-pipeline.md
  - docs/brainstorms/2026-03-29-skills-first-pipeline-brainstorm.md
---

# Pipeline Feedback Loops — Making Agents Actually Collaborate

## Problem Statement

The pipeline has feedback loops on paper but they don't close. Agents don't collaborate — they pass work forward and move on. When quality issues are found downstream, the upstream agent is either never told, told without context, or the loop mechanism silently fails.

**Evidence:** A Quellis pipeline run produced a merge BLOCK with 22 real issues — 64 failing redteam tests, 6 security vulnerabilities, 6 stubs, and architecture non-compliance. The redteam correctly found the problems. But the impl agent was never sent back to fix them. The pipeline advanced from redteam straight to merge, which correctly said BLOCK. But the merge→impl auto-loop also didn't fire (bead reopen silently failed). Result: human is asked to intervene on issues that the pipeline should have resolved autonomously.

**Root causes (3 interconnected):**
1. **Blind retries:** `green-gate` and `redteam-gate` use `decisionLog` tracking, which does NOT inject feedback into the retried agent's prompt. The impl agent retries without knowing what tests are failing.
2. **Broken bead reopening:** The merge-gate tries to reopen a closed bead via `updateStatus("open")`. This path (close→reopen) works but can silently fail if the bead's assignee state blocks reclaiming. The pipeline then incorrectly marks "completed" despite BLOCK.
3. **Green-gate test scope:** `verifyGreenState` runs the test-phase test command, which only covers spec tests. Redteam tests are in different files that the green-gate never runs. 64 failing tests are invisible.

## Context

### What exists today (research findings)

7 gates + 2 inline loops:

| Gate | Works? | Feedback in prompt? | Loop actually closes? |
|------|--------|--------------------|-----------------------|
| coverage-gate | Yes | Yes | Yes |
| spec-quality | Yes | Yes | Yes |
| stub-gate | Yes | Yes | Yes |
| conform-gate | Yes | Yes | Yes |
| green-gate | Partial | **No** — decisionLog only | Agent retries blind |
| redteam-gate | Partial | **No** — decisionLog only | Agent retries blind |
| merge-gate | Partial | Yes (applyRetry writes retryFeedback) | Bead reopen can silently fail |
| crash retry | Yes | No | No feedback needed |
| TDD RED check | Yes | No | **No escalation ceiling — infinite loop** |

### What broke in the Quellis run

1. Redteam wrote 64 failing tests exposing real issues
2. Green-gate after redteam ran the test-phase command → didn't execute redteam test files → saw no new failures → didn't trigger impl loop
3. Pipeline advanced to merge → merge ran ALL tests → found 64 failures + 22 issues → said BLOCK
4. Merge-gate tried to reopen impl+merge beads → bead state issue → pipeline blocked for human

## Chosen Approach

Fix all three issues together. They're interconnected — fixing only one leaves the loop broken.

### Fix 1: All gates inject feedback into retried agent prompt

Change `green-gate` and `redteam-gate` to write `retryFeedback` regardless of `trackingMethod`. The `applyRetry()` function ALREADY writes to `retryFeedback` — the issue is that `runGate()` reads attempt counts from `decisionLog` but `applyRetry` writes feedback to `retryFeedback`. This is actually correct — both tracking methods end up in `retryFeedback`. But the feedback content for `decisionLog`-tracked gates is sparse (no failing test names, just a reason string).

**Decision:** Enrich the gate result for `green-gate` and `redteam-gate` — include the actual failing test output (first 1000 chars of test runner output) in the `context` field. The `applyRetry` feedback injection already handles `previousSummary` which captures this.

### Fix 2: Full test suite for green-gate

Change `verifyGreenState` to run the project's full test suite (from `package.json` `scripts.test` or CLAUDE.md test command), not the test-phase-specific command. This catches redteam tests, conformance tests, and any other test files written by any phase.

**Decision:** Use the full test suite command. If `pipeline.context.testCommand` is set (from captureTestContext), use it. But ALSO check `package.json scripts.test` for a more comprehensive command. Prefer whichever runs more tests.

### Fix 3: Bead reopen resilience

The `updateStatus("open")` path now does close→reopen for in_progress beads (fixed earlier). But for already-closed beads (merge-gate path), `bd reopen` should work directly. The issue is the assignee. The `claim()` fix (clear assignee on "already claimed") handles this.

**Decision:** Add a verification step after `applyRetry` — check that the bead is actually `open` after the mutation. If not, log an error and escalate to human instead of silently proceeding. No more silent failures.

### Fix 4: Impl agent gets structured feedback on loop-back

When impl loops back after redteam or merge, it should:
1. Read the feedback (which tests fail, what issues the merge review found)
2. Update `.hog/impl-plan.md` — append new tasks from the feedback
3. Run `/marvin:work .hog/impl-plan.md` to implement the fixes

**Decision:** The retry prompt injection already passes the feedback. The impl agent's prompt already instructs plan-then-/work. On retry, the `## Retry Context` section tells the agent what's wrong. The agent reads `impl-plan.md`, appends tasks for the failures, and re-runs /work.

### Fix 5: TDD RED check escalation ceiling

Add a max retry count (5) to the TDD RED check. After 5 attempts, escalate to human: "Test writer keeps producing passing tests — manual intervention needed."

## Why This Approach

**Why full test suite instead of tracking files per phase?**
Simpler, more reliable, catches everything. Each phase might write tests in unexpected locations. The full suite is the definitive answer.

**Why all issues in one pass for merge feedback?**
The impl agent with /work iterates task-by-task. 22 issues become 22 tasks. The agent plans which to tackle first (security > correctness > stubs). Splitting into multiple batches adds conductor complexity for no gain — /work already batches.

**Why update existing plan instead of fresh?**
The `impl-plan.md` accumulates context. On retry, the agent sees what was already done (checked boxes) and what's new (appended tasks). A fresh plan loses that context.

**What was rejected:**
- Per-phase test file tracking (too much plumbing, fragile)
- Prioritized batches for merge feedback (adds conductor complexity, /work already handles iteration)
- Fresh plan on each retry (loses context of what was already done)

## Open Questions

1. **Should the conform-gate re-run after merge→impl loop?** Currently it runs as a pre-close gate on impl. If impl loops back from merge, conform automatically re-runs before impl closes. This is correct but should be verified in the e2e test.

2. **Should there be a maximum total loop count across all gates?** Currently each gate has its own counter. A pathological pipeline could loop 2×coverage + 2×spec-quality + 2×stub + 3×conform + 2×green + 2×redteam + 2×merge = 15 impl retries. Is that too many? Probably fine — each is independent.

3. **Should the pipeline track total cost and abort if budget exceeded?** The `costByPhase` field exists but isn't used for abort decisions.

## Out of Scope

- Changing the 7-phase DAG structure (already made flexible in previous work)
- Modifying the /marvin:work skill beyond HOG_PIPELINE=1 (already done)
- Parallel phase execution (future work after this)

## Next Steps

- `/plan` to create implementation plan from these decisions
- Focus areas: verifyGreenState scope, gate feedback enrichment, bead reopen verification, TDD RED escalation ceiling
