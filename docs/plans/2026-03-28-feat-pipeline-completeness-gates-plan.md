---
title: "feat: pipeline completeness gates — close the gaps between stories, tests, and shipping"
type: plan
date: 2026-03-28
status: approved
confidence: high
reviewed_by: codex-gpt-5.3-spark
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

**Where:** `conductor.ts` in `onAgentCompleted` when `phase === "test"`, **before** `beads.close()`.

`checkTraceability()` already does the hard work — it extracts STORY-XXX IDs from the stories file and checks which ones appear in test files. Currently advisory. Make it blocking:

- Exclude stories in `pipeline.context.skippedStories` from the coverage denominator (integration stories skipped by human via Gate 5)
- If `uncoveredStories.length > 0` AND `uncoveredStories.length / adjustedTotal > 0.25` (more than 25% uncovered):
  - Don't close the bead — re-open the test bead
  - Inject feedback into the retry prompt: "You covered {N}/{total} stories. Missing: {STORY-007, STORY-008, ...}. Write tests for all stories."
  - Log `"gate:story-coverage:failed"`
- If uncovered but <= 25%: log warning, proceed (some stories may legitimately not need tests — e.g., documentation stories)

**Why 25% threshold:** The Bobo run had 35% coverage (6/17). A rigid "100% coverage" gate would block on documentation-only stories (STORY-017) or integration stories that can't be unit tested. The threshold catches "test writer gave up halfway" without blocking legitimate partial coverage.

**Fix needed in `checkTraceability`:** `findTestStoryReferences` only greps `*.test.*` files (`tdd-enforcement.ts:454`). It must also match `*.spec.*` and `*_test.*` patterns. The `testGlob` parameter is accepted but currently ignored at line 290 — wire it through.

### Gate 2: Summary Sentiment Gate (all phases)

**Where:** `conductor.ts` in `onAgentCompleted`, **before** `beads.close()`.

**Critical structural change:** The current `onAgentCompleted` calls `beads.close().then(...)` and runs all gating logic inside the `.then()` callback (`conductor.ts:1248`). This means the bead is already closed before any gate runs. **Refactor `onAgentCompleted` to run gates before closing the bead.** The flow must become:

```
1. Run pre-close gates (summary sentiment, story coverage)
2. If any gate fails → don't close bead, store feedback, return
3. If all gates pass → beads.close()
4. Run post-close hooks (GREEN verification, GitHub sync, etc.)
```

Parse the agent's summary (`monitor.lastText`) for failure signals:

```typescript
const FAILURE_PATTERNS: Array<{ pattern: RegExp; excludePhases?: PipelineRole[] }> = [
  { pattern: /CANNOT PROCEED/i },
  { pattern: /requires clarification/i },
  { pattern: /manual intervention/i },
  { pattern: /unable to complete/i },
  // Phase-aware: "FAILED" is normal in redteam/test context
  { pattern: /\bFAILED\b/i, excludePhases: ["redteam", "test"] },
  { pattern: /\bblocked\b/i, excludePhases: ["redteam"] },
];
```

When a failure pattern matches (and current phase is not excluded):
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
  previousSummary: string; // last agent's summary (truncated to 300 chars)
  attempt: number;       // 1-indexed retry count
}
```

**Schema changes required:** Add `retryFeedback` and `skippedStories` to both `PipelineContext` in `conductor.ts:65` AND the Zod schema in `pipeline-store.ts:39`. These must be persisted to survive conductor restarts.

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

**Prompt size guard:** Truncate `previousSummary` to 300 chars, `missing` list to 20 items. Total retry section must not exceed 500 chars. This prevents prompt bloat in long pipelines with many stories.

### Unified Retry Policy

The codebase currently has three separate retry mechanisms with different caps:

| Path | Current cap | Location |
|------|------------|----------|
| Agent process failure (exit ≠ 0) | 3 attempts | `onAgentFailed` at `conductor.ts:1453` |
| Redteam→impl feedback loop | 2 iterations | `onAgentCompleted` at `conductor.ts:1336` |
| New gate-triggered retry | (proposed) 2 attempts | Gates 1, 2 |

**Unify into a single `RetryPolicy`:**

```typescript
interface RetryPolicy {
  maxAttempts: number;  // default 2 for gate retries, 3 for process failures
  currentAttempt: number;
  source: "gate" | "process-failure" | "feedback-loop";
}
```

Track via `pipeline.context.retryFeedback[role].attempt`. When `attempt >= maxAttempts`, always escalate to human via `enqueueQuestion()`. Remove the separate `failureCount` tracking in `onAgentFailed` and the `implRetries` counter in the redteam→impl loop — both should read from the unified `retryFeedback`.

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

**Critical change to question queue:** Currently, ALL pending questions block the entire pipeline (`conductor.ts:415`). This must change. Add a `questionType` field to distinguish:

```typescript
type QuestionType = "blocking" | "informational";
```

- `"blocking"` — current behavior, pipeline cannot proceed
- `"informational"` — pipeline continues, answer is consumed when resolved

Integration story questions are `"informational"` until the pipeline reaches impl. At that point, unresolved integration questions become blocking.

**Question answer actions:** Currently `resolveQuestion()` only stamps `resolvedAt` + `answer` (`question-queue.ts:86`) but doesn't drive control flow. Add an `onResolved` callback mechanism or check resolved answers in `tickPipeline`:

```typescript
// In tickPipeline, after unblocking:
const resolved = getResolvedForFeature(this.questionQueue, pipeline.featureId);
for (const q of resolved) {
  if (q.answer === "Skip this story" && q.context?.storyId) {
    pipeline.context.skippedStories.push(q.context.storyId);
  }
  if (q.answer === "I'll do it now — pause pipeline") {
    pipeline.status = "blocked";
  }
}
```

When the human answers:
- "Yes" → mark as ready, include in test/impl scope
- "Skip" → exclude from coverage gates (add to `pipeline.context.skippedStories[]`)
- "Pause" → set `pipeline.status = "blocked"` until human resumes

## Implementation Tasks

### Phase A: Foundation (no behavior change, just plumbing)

- [ ] A1. Add `retryFeedback: Record<PipelineRole, RetryFeedback>` to `PipelineContext` type in `conductor.ts` AND Zod schema in `pipeline-store.ts`
- [ ] A2. Add `skippedStories: string[]` to `PipelineContext` type AND Zod schema
- [ ] A3. Add `questionType: "blocking" | "informational"` field to question queue schema (`question-queue.ts`)
- [ ] A4. Extract `FAILURE_PATTERNS` with phase-aware exclusions (new file `src/engine/summary-parser.ts` — regex matching + phase filtering, <40 lines)
- [ ] A5. Write tests for summary parser: positive matches, false positives to avoid (e.g., "10 tests failed" in redteam is OK, "FAILED test now passes" in impl is OK)

### Phase B: Integration Story Escalation (moved up — must run before Gate 1)

**Why first:** Skipped stories must be in `pipeline.context.skippedStories` before the coverage gate fires, otherwise integration stories count as "uncovered" and trigger false positives.

- [ ] B1. After stories phase completes: scan stories file for `[INTEGRATION]` / `[HUMAN-REQUIRED]` tags
- [ ] B2. Enqueue `"informational"` questions for each tagged story with ["Ready", "Skip", "Pause"] options, including `storyId` in question context
- [ ] B3. Update `tickPipeline` to check resolved integration questions and apply answers (skip → add to `skippedStories`, pause → block)
- [ ] B4. Change pipeline blocking logic (`conductor.ts:415`): only block on `questionType === "blocking"` questions
- [ ] B5. Write conductor tests: integration stories trigger informational questions, pipeline continues until impl, skip answers populate `skippedStories`

### Phase C: Refactor `onAgentCompleted` (pre-close gating)

**Why before gates:** Gates 1 and 2 must run before `beads.close()`. Current structure has all logic inside `.then()` after close.

- [ ] C1. Refactor `onAgentCompleted`: extract gate checks into `async runPreCloseGates(pipeline, phase, summary): Promise<{ passed: boolean; feedback?: RetryFeedback }>`
- [ ] C2. New flow: run pre-close gates → if failed, store feedback + re-open bead + return → if passed, `beads.close()` → run post-close hooks
- [ ] C3. Move GREEN verification (impl) and redteam→impl loop into post-close hooks (they depend on the bead being closed to trigger DAG progression)
- [ ] C4. Write tests: gate failure prevents bead close, gate success allows bead close

### Phase D: Story Coverage Gate

- [ ] D1. Fix `checkTraceability`: wire `testGlob` parameter through to `findTestStoryReferences` so it matches `*.spec.*` and `*_test.*` in addition to `*.test.*`
- [ ] D2. Fix `checkTraceability`: resolve `storiesPath` robustly — handle directory vs file, use `findStoriesFile` helper if path is missing
- [ ] D3. In `runPreCloseGates` for `phase === "test"`: call `checkTraceability`, subtract `skippedStories` from denominator, apply 25% threshold
- [ ] D4. On failure: store `RetryFeedback` with missing story IDs, re-open test bead
- [ ] D5. Write conductor tests: test phase re-opened when >25% stories uncovered, skipped stories excluded from count

### Phase E: Summary Sentiment Gate

- [ ] E1. In `runPreCloseGates` (all phases): check summary against `FAILURE_PATTERNS` with phase-aware exclusions
- [ ] E2. On match: enqueue `"blocking"` question with summary context, set pipeline to blocked
- [ ] E3. Write conductor tests: merge agent with "CANNOT PROCEED" summary triggers question queue; redteam agent with "tests FAILED" does NOT trigger

### Phase F: Contextual Retry

- [ ] F1. In `spawnForRole`: read `pipeline.context.retryFeedback[role]` and append retry section to prompt (max 500 chars)
- [ ] F2. In existing retry paths (impl after green-fail, redteam→impl loop): store `RetryFeedback` instead of using separate counters
- [ ] F3. Unify retry cap: all paths read `retryFeedback[role].attempt`, escalate at configured max (2 for gates, 3 for process failures)
- [ ] F4. Remove redundant `implRetries` counting from `decisionLog.filter()` in redteam→impl path
- [ ] F5. Write tests: retry prompt includes feedback, escalation after max retries, unified counting works across failure sources

### Phase G: Redteam Completeness

- [ ] G1. Add `{storiesPath}` to REDTEAM_PROMPT with completeness check instructions
- [ ] G2. Add `[INTEGRATION]` awareness: "flag for human, don't write impossible tests"
- [ ] G3. Write roles.test.ts case: redteam prompt includes storiesPath substitution

## Acceptance Criteria

- [ ] A pipeline where the test writer covers <75% of stories gets the test bead re-opened with specific feedback about which stories are missing
- [ ] A merge agent that says "CANNOT PROCEED" triggers a human question, not a green checkmark
- [ ] A retried agent receives a prompt that includes what went wrong and what's missing
- [ ] The redteam agent checks story completeness, not just security
- [ ] Stories tagged `[INTEGRATION]` surface as informational questions in the cockpit after stories phase; become blocking before impl
- [ ] Integration stories answered "Skip" are excluded from the coverage gate denominator
- [ ] All retry paths use unified `retryFeedback` tracking — no separate counters
- [ ] All existing tests still pass (no regressions in conductor.test.ts, conductor-errors.test.ts, pipeline-lifecycle.integration.test.ts)

## Decision Rationale

**Why gates with thresholds, not rigid pass/fail?**
Rigid gates cause false positives. A 100% story coverage gate would block on STORY-017 (documentation) which has no testable behavior. The 25% threshold catches "test writer gave up" without blocking legitimate partial coverage. `skippedStories` provides an escape hatch for stories that genuinely can't be tested.

**Why parse summaries instead of adding a structured exit protocol?**
We don't control Claude's exit behavior. Exit code 0 means "conversation ended normally." Adding a structured protocol (e.g., writing a JSON result file) would require changing the agent prompts AND hoping the agent follows the protocol. Summary parsing is imperfect but works without agent cooperation — and it catches the exact failure we saw.

**Why feedback injection instead of a separate "fixer" agent?**
The agent that wrote incomplete tests has the best context about WHY it stopped (ran out of context, misunderstood scope, hit a tooling issue). Telling it "you missed STORY-007 through STORY-017" is more effective than spawning a fresh agent that has to re-discover everything. The retry cap ensures we don't loop forever if the agent fundamentally can't do the job.

**Why not add a new "verification" phase between impl and redteam?**
More phases = more latency. The redteam agent already reads the full codebase — adding completeness checking to its prompt is cheaper than adding a whole new agent spawn. The story coverage gate after test phase catches the biggest gap (incomplete tests) early, before impl even starts.

**Why refactor `onAgentCompleted` flow?**
Codex review identified that the current `.then()` structure closes the bead before gates run. If a gate fails after close, we'd have to re-open a just-closed bead — a race condition with the DAG. Running gates before close is structurally sound: either the bead closes (all gates pass) or it stays open (gate failed, retry needed).

**Why move integration escalation before coverage gate?**
Codex review identified that integration stories would be counted as "uncovered" by the coverage gate, causing false positives. By scanning for `[INTEGRATION]` tags first and letting the human skip them, we populate `skippedStories` before the coverage gate runs.

**Why informational vs blocking questions?**
The current question queue blocks the entire pipeline on any pending question (`conductor.ts:415`). Integration setup can happen in parallel — the human might answer "I'll create the repo" while the test writer is still running. Only block when the pipeline actually needs the answer (at impl time).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Summary parsing false positives ("the FAILED test now passes") | Medium | Low — question queue, human decides | Phase-aware exclusion patterns (E1), tune patterns over time |
| 25% threshold too generous — allows 4/17 stories to be skipped | Low | Medium | Threshold is configurable; can tighten after observing real pipelines |
| Retry feedback makes prompts too long, agent ignores it | Low | Medium | Hard cap at 500 chars total for retry section; truncate summary to 300 chars |
| Integration story scanning regex too simple (`[INTEGRATION]` literal) | Low | Low | Stories format is controlled by the stories agent prompt; can tighten later |
| `onAgentCompleted` refactor introduces race conditions | Medium | High | Thorough testing in Phase C; GREEN verification stays post-close (it needs DAG progression) |
| `checkTraceability` grep is expensive on large repos | Low | Medium | Only runs once per test phase completion (not per tick); cache result in pipeline context |
| Informational→blocking question transition has edge cases | Medium | Medium | Simple rule: unresolved informational questions for the current phase become blocking. Resolved ones are already applied. |
| Story writer produces sparse/vague stories — no quality gate | Medium | Medium | Out of scope for this plan. Future: add story quality validation before test phase. Noted in assumptions as unverified. |

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| `checkTraceability` parses STORY-XXX IDs reliably | Verified | Regex at tdd-enforcement.ts:432, tested via grep |
| `checkTraceability` `testGlob` parameter works when wired | Unverified | Parameter accepted but ignored at line 290 — must be fixed (task D1) |
| Agents produce meaningful `monitor.lastText` summaries | Verified | All 5 Bobo agent results have substantive summaries |
| `enqueueQuestion` + cockpit TUI workflow is functional | Verified | Tested in conductor-errors.test.ts STORY-005, cockpit renders questions |
| Retry prompt changes actually influence agent behavior | Unverified | Needs observation — first real test will be the next pipeline run |
| Stories file consistently uses `[INTEGRATION]` tag format | Verified | Defined in STORIES_PROMPT at roles.ts:99 |
| `PipelineStore` Zod schema accepts new fields without migration | Unverified | Must use `.optional()` or `.default()` for backwards compat with existing pipelines.json |
| Story quality (complete acceptance criteria, clear scope) is sufficient | Unverified | No gate validates story quality — sparse stories produce sparse tests. Future work. |
| Question answer resolution drives control flow after redesign | Unverified | `resolveQuestion` currently only stamps metadata — action dispatch must be added (task B3) |
