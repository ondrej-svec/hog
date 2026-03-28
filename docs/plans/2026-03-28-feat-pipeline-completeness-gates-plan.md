---
title: "feat: pipeline completeness gates — close the gaps between stories, tests, and shipping"
type: plan
date: 2026-03-28
status: approved
confidence: high
---

# Pipeline Completeness Gates

> The pipeline says "Complete! 6/6" but only 6 of 17 stories were implemented.
> The merge agent reported "CANNOT PROCEED" but nobody listened.
> Three plugins are stubs. No repo was created. No human was asked.

## Problem Statement

The pipeline has five systemic gaps exposed by the Bobo "Agentic Content Pipeline v2" run:

1. **Test coverage gap** — Test writer covered STORY-001 through STORY-006 (of 17). `checkTraceability()` exists at `conductor.ts:955` but is advisory-only — it logs warnings, never blocks.

2. **Exit-code-only completion** — `onAgentCompleted` closes the bead on exit code 0 regardless of what the agent said. The merge agent reported "CANNOT PROCEED" but the conductor saw exit 0 and marked it done.

3. **Blind retries** — When an agent retries (impl after redteam writes failing tests), it gets the exact same prompt. No feedback about what failed or what's missing.

4. **Redteam doesn't check completeness** — The redteam prompt focuses on security and scaffolding detection. It never reads the stories file to check whether all stories are implemented.

5. **No human escalation for external actions** — STORY-001 required creating a GitHub repo. No agent can do this. No agent flagged it. The `[INTEGRATION]` tag exists in stories but nobody reads it.

## Proposed Solution

Five gates, each targeting one gap. Design principle: **gates are feedback loops, not walls** — when a gate fails, it returns work to the responsible agent with specific feedback about what's missing.

### Gate 1: Story Coverage Gate (after test phase)

**Where:** `conductor.ts` in `onAgentCompleted` when `phase === "test"`, after `captureTestContext`.

`checkTraceability()` already does the hard work — it extracts STORY-XXX IDs from the stories file and checks which ones appear in test files. Currently advisory. Make it blocking:

- If `uncoveredStories.length > 0` AND `uncoveredStories.length / totalStories > 0.25` (more than 25% uncovered):
  - Re-open the test bead
  - Inject feedback into the retry prompt: "You covered {N}/{total} stories. Missing: {STORY-007, STORY-008, ...}. Write tests for all stories."
  - Log `"gate:story-coverage:failed"`
- If uncovered but <= 25%: log warning, proceed (some stories may legitimately not need tests — e.g., documentation stories)

**Why 25% threshold:** The Bobo run had 35% coverage (6/17). A rigid "100% coverage" gate would block on documentation-only stories (STORY-017) or integration stories that can't be unit tested. The threshold catches "test writer gave up halfway" without blocking legitimate partial coverage.

**Assumption:** `checkTraceability` correctly parses STORY-XXX IDs from both stories and test files. **Status: Verified** — it uses regex `STORY-\d{3,}` and `grep -r` (tdd-enforcement.ts:287-288, 432).

### Gate 2: Summary Sentiment Gate (all phases)

**Where:** `conductor.ts` in `onAgentCompleted`, before closing the bead.

Parse the agent's summary (`monitor.lastText`) for failure signals before treating exit 0 as success:

```
FAILURE_PATTERNS = [
  /CANNOT PROCEED/i,
  /FAILED/i (but not "tests failed" in redteam context — that's expected),
  /requires clarification/i,
  /manual intervention/i,
  /blocked/i,
  /unable to complete/i,
]
```

When a failure pattern matches:
- Don't close the bead
- Enqueue a question via `enqueueQuestion()` with the agent's summary as context
- Set `pipeline.status = "blocked"`
- Log `"gate:summary-sentiment:blocked"`

**Why not just check exit code?** Claude exits 0 when it finishes its conversation, even if the conversation concluded with "I can't do this." The summary is the only semantic signal we have. This is a pragmatic heuristic, not a guarantee — but it catches the merge gatekeeper case perfectly.

### Gate 3: Contextual Retry (feedback injection on re-spawn)

**Where:** `conductor.ts` in `spawnForRole`, and a new field `pipeline.context.retryFeedback[role]`.

When a gate fails and re-opens a bead, store structured feedback:

```typescript
interface RetryFeedback {
  reason: string;        // "Story coverage: 6/17 stories covered"
  missing: string[];     // ["STORY-007", "STORY-008", ...]
  previousSummary: string; // last agent's summary (truncated)
  attempt: number;       // 1-indexed retry count
}
```

In `spawnForRole`, check `pipeline.context.retryFeedback[role]`. If present, append a `## Retry Context` section to the prompt:

```
## Retry Context (attempt {N})

Your previous run did not complete all required work.

Issue: {reason}
Missing: {missing items}

Previous agent's summary:
> {previousSummary}

Focus on completing the missing work. Do not redo work that was already done.
```

This replaces the current "blind retry" where the agent gets the exact same prompt and may make the exact same mistake.

**Cap retries at 2** (same as existing redteam→impl loop). On attempt 3, escalate to human via question queue.

### Gate 4: Redteam Completeness Check (strengthen prompt)

**Where:** `roles.ts` REDTEAM_PROMPT — add stories file reference and completeness mandate.

Add to the redteam prompt:

```
## Completeness Check
11. Read the stories file at `{storiesPath}`
12. For EACH story, verify there is corresponding implementation (not just tests)
13. If any story is a stub, TODO, or "planned for Phase N" — write a test that
    imports/calls the expected module and asserts it does real work
14. Stories tagged [INTEGRATION] that require external setup (repo creation,
    API keys, etc.) — flag these as needing human action, do NOT write tests
    that would require external services to pass
```

This is the cheapest fix with the highest impact. The redteam agent is already reading the codebase — it just needs to be told to check story completeness.

### Gate 5: Integration Story Escalation (human-in-the-loop)

**Where:** `conductor.ts` after the stories phase completes, and in the test phase prompt.

After stories bead closes, scan the stories file for `[INTEGRATION]` tags and `[HUMAN-REQUIRED]` tags. For each:
- Enqueue a question: "Story {ID} requires: {description}. Is this ready?"
- Options: ["Yes, it's set up", "Skip this story", "I'll do it now — pause pipeline"]

The pipeline continues processing non-integration stories while waiting. When the human answers:
- "Yes" → mark as ready, include in test/impl scope
- "Skip" → exclude from coverage gates (add to `pipeline.context.skippedStories[]`)
- "Pause" → set `pipeline.status = "blocked"` until human resumes

**Why not block immediately?** Most integration stories (API keys, repo creation) can be set up in parallel with the pipeline's brainstorm/stories/test phases. Blocking immediately wastes time. Ask early, block only when the pipeline actually needs the result (before impl).

## Implementation Tasks

### Phase A: Foundation (no behavior change, just plumbing)

- [ ] A1. Add `retryFeedback` field to pipeline context type (`conductor.ts` PipelineEntry interface)
- [ ] A2. Add `skippedStories` field to pipeline context type
- [ ] A3. Extract `FAILURE_PATTERNS` constant (new file `src/engine/summary-parser.ts` — just regex matching, <30 lines)
- [ ] A4. Write tests for summary parser: positive matches, false positives to avoid (e.g., "10 tests failed" in redteam is OK)

### Phase B: Story Coverage Gate

- [ ] B1. Make `checkTraceability` return data (it already does — verify the return type is sufficient)
- [ ] B2. In `onAgentCompleted` for `phase === "test"`: call `checkTraceability`, apply 25% threshold, re-open bead if failing
- [ ] B3. Store `RetryFeedback` in `pipeline.context.retryFeedback.test` with missing story IDs
- [ ] B4. In `spawnForRole` for test role: check `retryFeedback.test`, append retry context to prompt
- [ ] B5. Write conductor tests: test phase re-opened when >25% stories uncovered, retry prompt includes missing stories

### Phase C: Summary Sentiment Gate

- [ ] C1. In `onAgentCompleted`: before `beads.close()`, check summary against `FAILURE_PATTERNS`
- [ ] C2. On match: enqueue question with summary context, set pipeline to blocked
- [ ] C3. Special case: for `phase === "redteam"`, exclude "tests failed" / "FAIL" patterns (expected)
- [ ] C4. Write conductor tests: merge agent with "CANNOT PROCEED" summary triggers question queue

### Phase D: Contextual Retry

- [ ] D1. In `spawnForRole`: read `pipeline.context.retryFeedback[role]` and append retry section to prompt
- [ ] D2. In existing retry paths (impl after green-fail, redteam→impl loop): store `RetryFeedback` with the green-check failure details
- [ ] D3. Cap all retry loops at 2 attempts before escalating (unify with existing redteam→impl cap)
- [ ] D4. Write tests: retry prompt includes feedback, escalation after 2 retries

### Phase E: Redteam Completeness

- [ ] E1. Add `{storiesPath}` to REDTEAM_PROMPT with completeness check instructions
- [ ] E2. Add `[INTEGRATION]` awareness: "flag for human, don't write impossible tests"
- [ ] E3. Write roles.test.ts case: redteam prompt includes storiesPath substitution

### Phase F: Integration Story Escalation

- [ ] F1. After stories phase: scan stories file for `[INTEGRATION]` / `[HUMAN-REQUIRED]` tags
- [ ] F2. Enqueue questions for each tagged story with ["Ready", "Skip", "Pause"] options
- [ ] F3. On "Skip": add story ID to `pipeline.context.skippedStories`, exclude from coverage gate
- [ ] F4. On "Pause": block pipeline until human resumes
- [ ] F5. Write conductor tests: integration stories trigger questions, skipped stories excluded from coverage

## Acceptance Criteria

- [ ] A pipeline where the test writer covers <75% of stories gets the test bead re-opened with specific feedback about which stories are missing
- [ ] A merge agent that says "CANNOT PROCEED" triggers a human question, not a green checkmark
- [ ] A retried agent receives a prompt that includes what went wrong and what's missing
- [ ] The redteam agent checks story completeness, not just security
- [ ] Stories tagged `[INTEGRATION]` surface as questions in the cockpit before impl begins
- [ ] All existing tests still pass (no regressions in conductor.test.ts, conductor-errors.test.ts, pipeline-lifecycle.integration.test.ts)

## Decision Rationale

**Why gates with thresholds, not rigid pass/fail?**
Rigid gates cause false positives. A 100% story coverage gate would block on STORY-017 (documentation) which has no testable behavior. The 25% threshold catches "test writer gave up" without blocking legitimate partial coverage. `skippedStories` provides an escape hatch for stories that genuinely can't be tested.

**Why parse summaries instead of adding a structured exit protocol?**
We don't control Claude's exit behavior. Exit code 0 means "conversation ended normally." Adding a structured protocol (e.g., writing a JSON result file) would require changing the agent prompts AND hoping the agent follows the protocol. Summary parsing is imperfect but works without agent cooperation — and it catches the exact failure we saw.

**Why feedback injection instead of a separate "fixer" agent?**
The agent that wrote incomplete tests has the best context about WHY it stopped (ran out of context, misunderstood scope, hit a tooling issue). Telling it "you missed STORY-007 through STORY-017" is more effective than spawning a fresh agent that has to re-discover everything. The retry cap (2 attempts) ensures we don't loop forever if the agent fundamentally can't do the job.

**Why not add a new "verification" phase between impl and redteam?**
More phases = more latency. The redteam agent already reads the full codebase — adding completeness checking to its prompt is cheaper than adding a whole new agent spawn. The story coverage gate after test phase catches the biggest gap (incomplete tests) early, before impl even starts.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Summary parsing false positives (agent says "the FAILED test now passes" → gate triggers) | Medium | Low — question queue, human decides | Phase-aware exclusion patterns (C3), tune patterns over time |
| 25% threshold too generous — allows 4/17 stories to be skipped | Low | Medium | Threshold is configurable; can tighten after observing real pipelines |
| Retry feedback makes prompts too long, agent ignores it | Low | Medium | Keep feedback section short (<500 chars), put it at the end of the prompt |
| Integration story scanning regex is too simple (`[INTEGRATION]` literal match) | Low | Low | Stories format is controlled by the stories agent prompt; can tighten later |

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| `checkTraceability` parses STORY-XXX IDs reliably | Verified | Regex at tdd-enforcement.ts:432, tested via grep |
| Agents produce meaningful `monitor.lastText` summaries | Verified | All 5 Bobo agent results have substantive summaries |
| `enqueueQuestion` + cockpit TUI workflow is functional | Verified | Tested in conductor-errors.test.ts STORY-005, cockpit renders questions |
| Retry prompt changes actually influence agent behavior | Unverified | Needs observation — first real test will be the next pipeline run |
| Stories file consistently uses `[INTEGRATION]` tag format | Verified | Defined in STORIES_PROMPT at roles.ts:99 |
