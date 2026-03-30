---
title: "fix: pipeline feedback loops — close the loops that are broken"
type: plan
date: 2026-03-30
status: complete
brainstorm: docs/brainstorms/2026-03-30-pipeline-feedback-loops-brainstorm.md
confidence: high
---

# Fix Pipeline Feedback Loops

One-line: Make every feedback loop actually close — blind retries get context, green-gate sees all tests, bead reopens are verified, and the pipeline iterates until the work is done.

## Problem Statement

Three interconnected bugs prevent the pipeline from self-correcting:
1. `green-gate` and `redteam-gate` loop impl but give it NO feedback (agent retries blind)
2. `verifyGreenState` runs only the test-phase test command — redteam tests are invisible
3. Bead reopening can silently fail — pipeline marks "completed" despite BLOCK

Result: 22-issue merge BLOCK on a Quellis pipeline. The pipeline should have looped impl 2-3 times and resolved most issues autonomously.

## Implementation Tasks

### 1. Full test suite for verifyGreenState

The green-gate must see ALL tests, not just spec-phase tests.

- [x] 1.1 Add `resolveFullTestCommand()` to `tdd-enforcement.ts` — given a `cwd`, find the most comprehensive test command:
  - First check `package.json` `scripts.test` (runs the full suite as the project defines it)
  - Fall back to `detectTestCommand()` (vitest/jest/pytest config file detection)
  - If both exist, prefer `npm test` (broader scope)
- [x] 1.2 Update both `verifyGreenState` call sites in conductor to use `resolveFullTestCommand(greenCwd)` as the test command, not `pipeline.context?.testCommand` (which is the test-phase-specific command)
- [x] 1.3 Keep `pipeline.context.testCommand` for the test-phase-specific use (RED verification, captureTestContext) — it's still needed there. The green-gate is the only one that needs the full suite.
- [x] 1.4 Test: write a unit test for `resolveFullTestCommand` that verifies it prefers `npm test` over vitest config detection

### 2. Enrich gate feedback for blind retries

All gates must inject actionable feedback into the retried agent's prompt.

- [x] 2.1 Capture test runner output in `verifyGreenState` — store the first 2000 chars of stdout+stderr in the return value (new field: `testOutput?: string`)
- [x] 2.2 Pass `testOutput` as the `context` field in the gate result for `green-gate` and `redteam-gate` — this flows through `evaluateGate → RetryAction.feedback.context → applyRetry → retryFeedback[gateId].previousSummary`
- [x] 2.3 Update the retry prompt injection at `conductor.ts:~1174` to include `context` (test output) in the `## Retry Context` section, not just `previousSummary`
- [x] 2.4 Test: verify that a green-gate retry prompt includes actual failing test names (mock verifyGreenState to return test output)

### 3. Bead reopen verification

No more silent failures — if a bead can't be reopened, escalate instead of pretending it worked.

- [x] 3.1 Add `verifyBeadStatus()` to `beads.ts` — after `updateStatus(id, "open")`, call `show(id)` and check `status === "open"`. Return success/failure.
- [x] 3.2 Update `applyRetry()` in conductor to call `verifyBeadStatus()` after each bead reopen. If verification fails, log error and set `pipeline.status = "blocked"` with a question: "Failed to reopen bead for retry — manual intervention needed."
- [x] 3.3 Test: e2e test that verifies bead reopen after close (already exists in `beads-dag.integration.test.ts` — add assertion that `show()` confirms status)

### 4. TDD RED check escalation ceiling

Prevent infinite loop when test writer keeps producing passing tests.

- [x] 4.1 Add counter tracking to the RED check in `spawnForRole` — use `decisionLog` entries matching `tdd:red-failed` for the pipeline's featureId
- [x] 4.2 After 5 RED failures, escalate to human: enqueue question "Test writer keeps producing passing tests after 5 attempts — manual intervention needed" with options: "Retry tests", "Skip RED check", "Cancel pipeline"
- [x] 4.3 Test: unit test that the RED check escalates after 5 attempts

### 5. Integration test — full feedback loop

Verify the complete redteam→impl→conform→redteam cycle works end-to-end.

- [x] 5.1 Add E2E-003 to `pipeline-e2e.integration.test.ts`: after impl completes, simulate redteam writing a failing test (commit a test file that fails), verify green-gate detects it, verify impl is re-spawned with feedback containing the test output, verify the re-spawned impl prompt has `## Retry Context`
- [x] 5.2 Add E2E-004: simulate merge BLOCK — complete the merge agent with summary containing "BLOCK", verify impl bead is reopened (verified via `bd show`), verify merge bead is reopened, verify impl gets the merge report in its retry context

## Decision Rationale

**Why `npm test` over vitest config detection for green-gate?**
Projects define their full test suite in `package.json scripts.test`. This command runs ALL tests — spec, redteam, conformance, everything. The config file detection (`detectTestCommand`) finds the first runner config, which might only cover a subset. For the green-gate, we need the broadest scope.

**Why capture test output in verifyGreenState instead of running a separate command?**
verifyGreenState already runs the test suite and parses the output. Capturing the raw output (first 2000 chars) is trivial. Running a second command to get the output would be wasteful.

**Why verify bead status instead of making updateStatus throw?**
`updateStatus` is called in many places with `.catch(() => {})` — it's designed to be best-effort. Adding verification as a separate step lets the caller decide how to handle failure (escalate vs ignore) without changing the contract.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `npm test` runs a different test suite than expected | Low | Medium | Fall back to `detectTestCommand` if `npm test` exits with "no test specified" |
| Test output is too large for prompt injection | Medium | Low | Truncate to 2000 chars — enough for failing test names without overwhelming context |
| Bead verification adds latency to every retry | Low | Low | One extra `bd show` call (~50ms) — negligible vs agent runtime (minutes) |
| RED check ceiling of 5 is too low for complex projects | Low | Low | Configurable via `pipeline.maxRedRetries`. Default 5. |

## Acceptance Criteria

1. **Green-gate catches redteam test failures.** After redteam writes failing tests, green-gate detects them and loops impl with test output in the retry context.
2. **Merge BLOCK auto-loops.** When merge says BLOCK, impl is re-spawned with the full merge report. Max 2 auto-retries before human escalation. Bead reopen is verified (not silently failed).
3. **No blind retries.** Every retried agent receives `## Retry Context` with specific failure details — test names, error output, or merge findings.
4. **TDD RED has a ceiling.** After 5 attempts, escalates to human instead of looping forever.
5. **E2E tests prove it.** Two new e2e tests against real Dolt verify the redteam→impl and merge→impl loops.
