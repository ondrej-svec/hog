---
title: "refactor: Expert panel improvements — TDD enforcement, safety gates, conductor extraction"
type: plan
date: 2026-03-26
status: approved
brainstorm: null
related:
  - docs/plans/2026-03-26-refactor-drop-github-board-pipeline-first-plan.md
  - docs/plans/2026-03-21-feat-agent-development-platform-plan.md
confidence: high
---

# Expert Panel Improvements

**One-line summary:** Implement the top recommendations from the Amodei/Fowler/Newport/Farley/Karpathy/Cherny expert panel: fix TDD enforcement end-to-end, add diff-audit safety gate, extract Conductor responsibilities, wire dead code, and add human review surface.

## Problem Statement

The expert panel review of hog v2.0.0 identified that while the 6-phase DAG architecture is sound, the TDD enforcement has critical gaps (RED runs full suite, no GREEN check, no redteam→impl loop), the safety model relies on prompts not sandboxes, the Conductor is approaching God Object status (975 lines, 10 responsibilities), and two key quality functions (`checkTraceability`, `runMutationTesting`) exist as dead code.

These aren't feature requests — they're structural integrity issues. The TDD tool must actually TDD.

## Proposed Solution

Five phases, dependency-ordered. Each phase is independently shippable and leaves the codebase in a working state.

---

## Phase 1: Fix TDD Enforcement End-to-End (Farley)

**Goal:** RED verification scoped to new tests only. GREEN verification after impl. Redteam→impl feedback loop. The pipeline actually enforces TDD, not just talks about it.

**Why first:** This is the product's core value proposition. If TDD enforcement doesn't work, nothing else matters.

### Tasks

- [ ] **1.1 RED: Test that verifyRedState only runs new test files**
  Write a failing test: `verifyRedState(cwd, { testFiles: ["src/new.test.ts"] })` scopes to that file only.

- [ ] **1.2 GREEN: Add `testFiles` parameter to verifyRedState**
  Modify `tdd-enforcement.ts:55` to accept optional `testFiles?: string[]`. Append file paths to the detected test command: `npx vitest run src/new.test.ts`, `npx jest --testPathPattern=src/new.test.ts`, `pytest src/new_test.py`.
  Challenge: The conductor doesn't know which test files the test agent created. Solution: after the test bead closes, diff the worktree branch against base to find new `*.test.*` files. Pass those to `verifyRedState`.

- [ ] **1.3 RED: Test GREEN verification — impl completion must run tests**
  Write a failing test: after impl agent completes, tests run and must pass. If tests fail, impl bead reopens.

- [ ] **1.4 GREEN: Add verifyGreenState after impl completes**
  In `conductor.ts:onAgentCompleted()`, after the impl phase closes the bead, run the full test suite. If tests fail, re-open the impl bead and log a retry. This catches impl agents that exit 0 without actually passing tests.
  File: `src/engine/conductor.ts:845` (inside the `.then()` after `beads.close()`)

- [ ] **1.5 RED: Test redteam→impl feedback loop**
  Write a failing test: after redteam completes, if new tests are failing, the impl bead re-opens and a new impl agent spawns.

- [ ] **1.6 GREEN: Implement redteam→impl loop in conductor**
  In `onAgentCompleted()` for the redteam phase: before closing the merge bead, run tests. If any fail (meaning redteam wrote new failing tests), re-open the impl bead via `beads.updateStatus()`. The next tick will see impl as ready and spawn a new impl agent. Add a loop counter to prevent infinite redteam→impl cycles (max 2 iterations).
  File: `src/engine/conductor.ts:811`

### Acceptance Criteria
- `verifyRedState({ testFiles })` only runs the specified files
- Impl agent exit → tests run → if fail, impl bead re-opens
- Redteam writes failing tests → impl bead re-opens → new impl agent fixes them
- Max 2 redteam→impl iterations (then escalate to human via question queue)

---

## Phase 2: Diff-Audit Safety Gate (Amodei)

**Goal:** Structural enforcement that each role stays in its lane. Test agents can only modify test files. Impl agents can only modify source files. Cheap, catches the most dangerous role violations.

**Why second:** This is the highest-ROI safety improvement — a few lines of code that catches the most egregious prompt-violation scenarios.

### Tasks

- [ ] **2.1 RED: Test diff-audit gate rejects test agent modifying src/**
  Write a failing test for a new `roleAuditGate`: given role "test" and changed files `["src/auth.ts"]`, the gate returns an error.

- [ ] **2.2 GREEN: Implement roleAuditGate in quality-gates.ts**
  New `QualityGate` object in `ALL_GATES`. The gate is always available. The `check()` function receives the changed files list and a `role` metadata field. Rules:
  - `test` role: only `*.test.*`, `*.spec.*`, `tests/`, `__tests__/` files allowed
  - `impl` role: only `src/`, `lib/`, `app/` files allowed (not test files)
  - `stories` role: only `docs/`, `tests/stories/` files allowed
  - `redteam` role: only test files allowed (same as test)
  - `merge` role: no file restrictions (it rebases/merges)
  - `brainstorm` role: not audited (human-interactive)
  Severity: `"error"` — blocks the merge.

- [ ] **2.3 Wire role metadata into Refinery submit**
  `refinery.submit()` at `refinery.ts:127` currently takes `(featureId, branch, worktreePath, repoPath)`. Add `role: PipelineRole` parameter so the Refinery can pass it to the diff-audit gate.
  File: `src/engine/refinery.ts:127`, `src/engine/conductor.ts:829`

- [ ] **2.4 Wire roleAuditGate into runQualityGates**
  `runQualityGates()` at `quality-gates.ts:308` currently takes `(cwd, changedFiles)`. Add optional `role?: PipelineRole` parameter. Pass it to `roleAuditGate.check()`.

### Acceptance Criteria
- Test agent branch with `src/auth.ts` modified → Refinery rejects merge
- Impl agent branch with `*.test.ts` modified → Refinery rejects merge
- Stories agent branch with `src/` files → rejected
- Normal impl agent branch with only `src/` files → passes

---

## Phase 3: Pipeline Persistence + Conductor Extraction (Fowler, Cherny)

**Goal:** Zod-validate pipeline persistence. Extract PipelineStore from Conductor. Fix the beadToRole naming issue. Add PipelineSnapshot type.

**Why third:** This is structural hygiene that makes Phases 1 and 2 safer by reducing the Conductor's complexity.

### Tasks

- [ ] **3.1 Define PipelineSchema with Zod**
  New file `src/engine/pipeline-store.ts`. Define `PipelineSchema` (Zod) matching the `Pipeline` interface. Use `safeParse` for loading.

- [ ] **3.2 Extract PipelineStore class**
  Move `savePipelines()`, `loadPipelines()`, `syncFromDisk()`, `startPipeline()`, `pausePipeline()`, `resumePipeline()`, `cancelPipeline()`, `getPipelines()` from Conductor to PipelineStore. Replace the 50+ lines of manual type checks with `PipelineSchema.safeParse()`.
  The Conductor holds a `PipelineStore` reference instead of a raw `Map<string, Pipeline>`.

- [ ] **3.3 Fix beadToRole — use Pipeline.beadIds reverse lookup**
  In `tickPipeline()` at `conductor.ts:581`, instead of calling `beadToRole(bead)` which parses the title prefix, build an inverted map from `pipeline.beadIds`: `{ "bd-stories": "stories", "bd-tests": "test", ... }`. Look up the bead ID directly. Remove dependency on title conventions.
  Keep `beadToRole()` in roles.ts as a fallback for cases without a pipeline context.

- [ ] **3.4 Add PipelineSnapshot type (readonly)**
  Export `PipelineSnapshot` with all fields `readonly`. Use it for TUI consumers (`PipelineView`, cockpit). The Conductor internally uses `Pipeline` (mutable). External consumers get `PipelineSnapshot`.
  File: `src/engine/conductor.ts` (type export), `src/board/components/pipeline-view.tsx` (consumer)

- [ ] **3.5 Persist decision log to disk**
  Currently in-memory only. Add `decisionLog` to the pipeline persistence file (or a separate `{featureId}.log.json`). This enables `hog pipeline review` to work after process restart.

### Acceptance Criteria
- `loadPipelines()` uses Zod safeParse (no manual typeof checks)
- Conductor class is <600 lines (down from 975)
- PipelineStore has its own test file
- `beadToRole` no longer parses title prefixes in the conductor tick path
- `PipelineSnapshot` type used by TUI components

---

## Phase 4: Wire Dead Code + Mutation Testing (Farley)

**Goal:** `checkTraceability()` and `runMutationTesting()` are called at the right pipeline gates. Stories map to tests. Test quality is measured.

**Why fourth:** These functions exist and are tested — they just need wiring. Low risk, high value.

### Tasks

- [ ] **4.1 Wire checkTraceability into test→impl transition**
  After the test bead closes, before spawning impl: call `checkTraceability(cwd, storiesPath)`. If `uncoveredStories` is non-empty, log a warning but don't block (stories may be covered by integration tests not matching the STORY-XXX pattern).
  File: `src/engine/conductor.ts` (in `spawnForRole()` before impl spawn)

- [ ] **4.2 Wire runMutationTesting into Refinery quality gates**
  Add `mutationGate` to `ALL_GATES` in `quality-gates.ts`. Available when Stryker/mutmut/cargo-mutants config exists. Calls `runMutationTesting()` from `tdd-enforcement.ts`. Severity: `"warning"` (don't block on mutation score, but report it).
  Threshold from `config.pipeline.qualityGates.mutationThreshold` (default 70%).

- [ ] **4.3 Add mutationThreshold to config schema**
  Add `mutationThreshold?: number` to `PIPELINE_CONFIG_SCHEMA` in `config.ts`. Default 70.

### Acceptance Criteria
- `checkTraceability` runs before impl spawns and logs uncovered stories
- `runMutationTesting` runs in Refinery when mutation tool is available
- Mutation score below threshold produces a warning in quality report

---

## Phase 5: Human Review Surface (Newport)

**Goal:** `hog pipeline review <featureId>` generates a structured summary of all phases. The human gets a batch review experience.

**Why last:** Requires the decision log persistence from Phase 3.5.

### Tasks

- [ ] **5.1 Add `hog pipeline review <featureId>` command**
  New CLI command that:
  1. Loads pipeline from `pipelines.json`
  2. Loads decision log from persisted file
  3. Queries bead statuses for each phase
  4. Loads quality gate report from Refinery (if available)
  5. Outputs a structured summary:
  ```
  Pipeline: feat-001 — Add user authentication
  Status: completed (23m total)

  Phases:
    ✓ brainstorm  — completed in 5m (interactive)
    ✓ stories     — 4 user stories written (STORY-001 through STORY-004)
    ✓ tests       — 12 tests, all failing (RED verified)
    ✓ impl        — 12/12 tests passing (GREEN verified)
    ✓ redteam     — 3 new edge-case tests added, all fixed in impl pass 2
    ✓ merge       — rebased, linted, 0 security issues

  Quality:
    Linting: clean
    Security: 0 issues (semgrep)
    Mutation score: 82% (above 70% threshold)

  Decision log: 8 entries (see ~/.config/hog/pipelines/feat-001.log)
  ```

- [ ] **5.2 Add `--json` support for pipeline review**
  Structured JSON output for agent consumption.

- [ ] **5.3 Add free-text decision answering in cockpit**
  Currently only number keys (1-9) for preset options. Add a text input mode: press `D` → shows decision → press `t` for text input → type answer → Enter to submit.
  File: `src/board/components/cockpit.tsx`

### Acceptance Criteria
- `hog pipeline review feat-001` prints a structured phase summary
- `hog pipeline review feat-001 --json` outputs structured JSON
- Cockpit supports free-text answers to decisions (not just numbered options)

---

## Risk Summary

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GREEN verification causes false negatives (tests fail for unrelated reasons) | Medium | Medium | Scope to worktree only; Refinery already handles this |
| Redteam→impl infinite loop | Low | High | Hard cap at 2 iterations → escalate to human |
| Diff-audit too strict (blocks legitimate cross-boundary changes) | Medium | Low | Warning first, then error after validation period |
| Conductor extraction breaks existing tests | Medium | Medium | Extract one responsibility at a time with tests |
| Decision log persistence increases disk I/O | Low | Low | Write-behind with debounce, same pattern as pipelines.json |
