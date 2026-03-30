---
title: "feat: tracer bullet pipeline — architecture-driven DAG with feedback loops"
type: plan
date: 2026-03-30
status: complete
confidence: medium
---

# Tracer Bullet Pipeline

One-line: The architecture doc is the contract. The pipeline autonomously produces a working application that fulfills it. When the pipeline finishes, what you designed is what you get.

## Problem Statement

The pipeline pretends to be a DAG but executes as a waterfall. Each phase fires once, produces output, and hands off. The result: shallow implementations that pass weak tests. The human brainstorms a rich architecture, then watches the pipeline produce a hollow shell.

**The gap is between design intent and execution fidelity.** The architecture doc describes real dependencies, real integration patterns, real file structures — but no gate verifies the implementation actually conforms to the architecture. The test writer writes string-matching tests (regex over source files). The impl agent makes those strings appear. Redteam runs after impl regardless of conformance. The pipeline "completes" with stubs, no-ops, and missing validation.

**What should happen:** You brainstorm a great architecture. The pipeline produces exactly that — working end-to-end, every dependency imported, every integration pattern followed, every acceptance criterion met. Autonomously. You review the finished product, not the work in progress.

## Design Principles

1. **Architecture doc = single source of truth.** Every phase validates against it. Not advisory — binding.
2. **Tests = executable specification.** Tracer bullet tests that prove the architecture works end-to-end. When they pass, the app works. Not unit tests, not string-matching — behavioral integration tests.
3. **Feedback loops, not retries.** When impl fails conformance, it gets specific feedback about what's missing and loops. Not "try again" — "here's what's wrong, fix it."
4. **Parallel where dependencies allow.** The DAG should express real dependency relationships, not arbitrary sequential ordering.
5. **Redteam = adversarial only.** It attacks working code, not incomplete code. Conformance is checked before redteam ever fires.

## Proposed DAG Topology

```
brainstorm → stories ──→ scaffold ──→ spec ──→ impl ──→ conform ──→ redteam → merge
                                        │        ↑         │           │        ↑
                                        │        └─────────┘           │        │
                                        │      (feedback: fix gaps)    └────────┘
                                        │                            (feedback: fix vulns)
                                        │
                                  tracer bullet tests
                                  that ARE the spec
```

### Phase Changes

| Current | Proposed | Change |
|---------|----------|--------|
| test | **spec** | Writes tracer bullet tests = executable architecture specification. Tests import and call real functions, exercise real integrations, prove the system works end-to-end. String-matching tests rejected by quality gate. |
| impl | **impl** (plan + /work) | Agent reads architecture doc + failing specs, writes its own `impl-plan.md`, then executes with `/marvin:work impl-plan.md`. Plans intelligently, then iterates task-by-task with test runs. The /work Stop hook enforces deps + tests. |
| *(new)* | **conform** | Architecture conformance gate. Runs as a **pre-close gate on the impl bead** (not a separate DAG node — avoids race conditions). Verifies: all architecture deps imported, all specified files exist at specified paths, no stubs/no-ops/TODOs, all spec tests pass, integration patterns followed. Loops impl if failed. |
| redteam | **redteam** (unchanged scope) | Only fires after conform passes. Writes adversarial tests — security, edge cases, abuse patterns. Does NOT check "did you finish the job?" |

### What Stays the Same

- **brainstorm** — human-driven, interactive. Produces architecture doc + stories.
- **stories** — auto-skipped if stories already exist from brainstorm.
- **scaffold** — verifies project structure, installs deps, creates directories.
- **merge** — refinery submission, quality gates, fast-forward merge.

### Feedback Loops (via status mutation, not DAG edges)

**conform → impl:** When conformance fails (pre-close gate on impl bead):
1. Bead is NOT closed — stays open for retry (no race condition with downstream)
2. Sets `retryFeedback["impl"]` with the structured conformance report
3. Impl re-spawns with `/work` — reads the conformance report, updates plan with remaining gaps
4. Max 3 iterations before human escalation

**redteam → impl:** When redteam finds vulnerabilities:
1. Redteam agent writes failing tests that expose the vulnerabilities
2. Conductor reopens impl + conform + merge beads
3. Impl re-spawns to fix the specific failing tests
4. Conform gate re-runs as part of impl's pre-close checks (automatic — no separate node to reopen)
5. Then redteam re-runs to verify fixes

## Implementation Tasks

### Phase 0: Fix Retry Counter Collision (prerequisite)

The current retry engine tracks attempts by `retryRole`, not by gate ID. Adding new gates with the same `retryRole` (e.g., `spec-quality` and `coverage-gate` both targeting `test`) causes shared counters — 1 coverage retry + 1 spec-quality retry = premature escalation.

- [x] 0.1 Change `RetryFeedback` to track attempts per gate ID, not per role: `retryFeedback: Record<string, RetryFeedback>` keyed by gate ID (e.g., `"coverage-gate"`, `"spec-quality"`)
- [x] 0.2 Update `applyRetry()` to key feedback by `retry.gateId` instead of `retry.retryRole`
- [x] 0.3 Update `runGate()` to read attempts from `retryFeedback[gateId]` with fallback to legacy role key
- [x] 0.4 Update retry feedback injection in prompt building — merge all feedback entries for the role being spawned, not just one
- [x] 0.5 Migrate: existing `retryFeedback` keyed by role still works (fallback lookup by role if gate ID key not found)

### Phase 1: Spec Tests (tracer bullets, not string-matching)

The test writer must produce tests that are executable specifications of the architecture.

- [x] 1.1 Add `analyzeTestQuality()` to `tdd-enforcement.ts` — classifies test files:
  - **Behavioral:** imports from source (`import { X } from "../src/..."` / `from module import X` / `use crate::X`), calls functions, asserts on return values/side effects
  - **String-matching:** calls `readFileSync`/`open()`/`File::open()` on source paths, uses `toMatch()`/`re.search()`/`contains()` on file content
  - Language detection: infer from file extension (`.ts`/`.js` → JS/TS patterns, `.py` → Python patterns, `.rs` → Rust patterns). Default to JS/TS if ambiguous.
  - Returns: `{ behavioral: string[], stringMatching: string[], ratio: number }`
- [x] 1.2 Add `spec-quality` gate to `retry-engine.ts` — phases: `["test"]`, retryRole: `"test"`, maxRetries: 2
  - Triggers when: `ratio < 0.8` (>20% of tests are string-matching)
  - Feedback: "Tests must be tracer bullets — import functions, call them, assert behavior. readFileSync+toMatch tests prove the string exists, not that the feature works. Rewrite these files as behavioral tests: [list]"
- [x] 1.3 Wire gate into conductor post-test checks, after traceability, before RED verification
- [x] 1.4 Update test-writer fallback prompt (`fallback-prompts/test-writer.md`) — replace "behavioral tests" language with tracer bullet framing: "Each test proves one acceptance criterion works end-to-end. Import the function, call it with realistic inputs, assert the output. When ALL tests pass, the architecture is realized."
- [x] 1.5 Update test role CLAUDE.md (`role-context.ts`) with explicit anti-pattern: "NEVER read source files as strings. NEVER use readFileSync+toMatch to verify implementation. These tests prove a string exists, not that the feature works."
- [x] 1.6 Tests for `analyzeTestQuality()` — behavioral files, string-matching files, mixed files, edge cases (readFileSync for test fixtures is OK), multi-language coverage

### Phase 2: Architecture Conformance Gate

A mechanical check — no agent, just code. Runs as a **pre-close gate on the impl bead** (before `beads.close()`), so downstream beads never become ready until conformance passes. No race condition.

- [x] 2.1 Add `checkArchitectureConformance()` to new file `src/engine/conformance.ts`:
  - Parse architecture doc `## Dependencies` table → list of expected packages
  - Language-aware import detection:
    - JS/TS: `import.*from.*"<package>"` or `require("<package>")`
    - Python: `import <package>` or `from <package> import`
    - Rust: `use <package>::` or `extern crate <package>`
    - Default: grep for package name in source files
  - Parse `## File Structure` section → list of expected file paths
  - For each path: check `existsSync(join(localPath, path))`
  - Parse `## Integration Pattern` section → extract pattern name
  - Scan for stub patterns: `TODO`, `FIXME`, `STUB`, `HACK`, `PLACEHOLDER`, `not implemented`, `throw new Error("not implemented")`, functions that return hardcoded `[]` or `{}` or `null`
  - Returns: `{ passed: boolean, missingDeps: string[], missingFiles: string[], stubs: string[], detail: string }`
  - Graceful degradation: if architecture doc can't be parsed (missing sections, unexpected format), log warnings but don't block. Only block on detected violations.
- [x] 2.2 Add `conform-gate` to `retry-engine.ts` — phases: `["impl"]`, retryRole: `"impl"`, maxRetries: 3, trackingMethod: `"retryFeedback"`
  - Runs AFTER green-gate (tests pass) and stub-gate, BEFORE bead close
  - Feedback includes the full conformance report so impl knows exactly what to fix
- [x] 2.3 Wire into conductor pre-close impl checks — between stub-gate and refinery submission
  - On failure: impl bead stays open, agent re-spawns with conformance report in retry feedback
  - On success: log conformance verified, close bead, advance to redteam
- [x] 2.4 Tests for `checkArchitectureConformance()` — mock architecture docs with deps/files/patterns, verify detection, test graceful degradation on malformed docs

### Phase 3: Agent-Planned /work for Impl

The impl agent plans its own work, then executes with `/marvin:work`. One agent, two phases: think, then do. The conductor provides inputs — the agent decides how to decompose the work.

- [x] 3.1 Update impl prompt to a two-step flow:
  1. **Plan:** Read the architecture doc, stories, and failing spec tests. Write `.hog/impl-plan.md` — a markdown plan with checkbox tasks decomposed from the architecture. Group by story. Each task references specific failing tests it will fix and architecture constraints it fulfills. Include acceptance criteria: "All spec tests pass. No stubs. Architecture conformance verified."
  2. **Execute:** Run `/marvin:work .hog/impl-plan.md` to implement the plan task-by-task with test runs after each.
- [x] 3.2 Update `fallback-prompts/work.md` to include the plan-then-execute pattern as the default flow (for when the toolkit isn't installed)
- [x] 3.3 Handle /work Phase 5 completion prompt — two-pronged approach:
  - **In hog:** set `HOG_PIPELINE=1` env var when spawning pipeline agents
  - **In heart-of-gold-toolkit:** modify `/marvin:work` to detect `HOG_PIPELINE=1` and skip `AskUserQuestion` at Phase 5, reporting completion via exit instead
  - Track toolkit change separately but implement in parallel
- [x] 3.4 On conform gate retry: the impl agent reads the conformance report from `retryFeedback`, updates `.hog/impl-plan.md` with only the remaining gaps, re-runs `/marvin:work .hog/impl-plan.md`

### Phase 4: Rich Context Injection

- [x] 4.1 Increase `phaseSummaries` storage limit from 500 to 2000 chars (`conductor.ts` post-close summary storage)
- [x] 4.2 Increase context injection limit from 300 to 2000 chars (`buildContextSection()` truncation)
- [x] 4.3 Expand `buildContextSection()` in conductor:
  - `<spec_tests>`: full file paths + test names (not just count)
  - `<failing_tests>`: actual test names and failure reasons from RED/GREEN verification
  - `<architecture>`: inline first 3000 chars of architecture doc (agent doesn't have to discover it)
  - `<phase_summaries>`: full summaries (now up to 2000 chars each)
- [x] 4.4 Pass architecture doc content as part of the impl prompt context (not just a path reference — agents sometimes skip reading paths)

### Phase 5: DAG Topology (enable parallelism + flexible nodes)

This is a significant structural change touching conductor, pipeline-store, daemon, cockpit, CLI, and tests. Scoped here with full awareness of the blast radius.

- [x] 5.1 Change `Pipeline.beadIds` from fixed 7-key record to `Record<string, string>` — support variable node count
- [x] 5.2 Add pipeline store migration (transparent — old format loads into Record<string, string>): existing pipelines with 7-key `beadIds` load into the new `Record<string, string>` format transparently. New pipelines use the flexible format. Version bump on pipeline store schema.
- [x] 5.3 Update `createFeatureDAG()` to accept a topology parameter — array of `{ id, label, dependsOn[] }` nodes. Default topology: `brainstorm → stories → scaffold → spec → impl → redteam → merge` (conform is a gate, not a node)
- [x] 5.4 Update `healPipeline`: replace hardcoded `phaseOrder` array with data-driven iteration over `Object.entries(pipeline.beadIds)`. Phase ordering derived from bead dependency graph (query `bd show` for each bead to get deps).
- [x] 5.5 Update `beadIdToRole` + `roleToBeadId` reverse lookup: build dynamically from `pipeline.beadIds` keys instead of hardcoded switch/case
- [x] 5.6 Update cockpit `PHASE_ORDER` and `PHASE_LABELS` to read from pipeline metadata instead of hardcoded constants. Fallback to bead labels from Beads if metadata missing.
- [x] 5.7 Update daemon protocol (`protocol.ts`): pipeline shape must accept flexible beadIds
- [x] 5.8 Update GitHub sync (no changes needed — doesn't reference beadIds directly) (`github-sync.ts`): phase labels derived from pipeline, not hardcoded
- [x] 5.9 Update CLI pipeline commands (already uses bracket access): `hog pipeline status` should display phases from pipeline metadata
- [x] 5.10 Real Beads integration test — 4 tests against live Dolt server: DAG creation, advancement, feedback loops, flexible beadIds iteration: create pipeline with 8 phases (including conform as a node for future use), verify cockpit renders correctly, verify healPipeline works, verify feedback loops still function

### Phase 6: Verification

- [x] 6.1 Pipeline gates integration test — 6 tests verify: spec-quality rejects string-matching, conform-gate catches missing deps, per-gate retry counters, HOG_PIPELINE env var, feedback loops with all changes — verify: spec tests are behavioral (import+call, not readFileSync), impl iterates via /work, conformance gate catches gaps, redteam only fires on conforming code
- [x] 6.2 Compare: time, test quality, stub count, redteam finding count, human interventions needed
- [ ] 6.3 Document results (after first live pipeline run with new gates) in `docs/solutions/`

## Decision Rationale

**Why conform as a pre-close gate, not a separate DAG node?**
Codex review identified a race condition: the conductor closes the impl bead in an async `.then()`, then runs post-close checks. Downstream beads can become ready before checks finish. By running conformance as a **pre-close gate** (before `beads.close()`), the impl bead stays open until conformance passes. No race. No separate node to manage or reopen. And when redteam→impl loops, conform automatically re-runs as part of impl's pre-close checks — no explicit reopening needed.

**Why fix retry counters first (Phase 0)?**
Adding new gates (`spec-quality`, `conform-gate`) with the same `retryRole` as existing gates causes shared counters. One coverage retry + one spec-quality retry = premature escalation even though each gate only failed once. Keying by gate ID instead of role is a prerequisite for all new gates.

**Why tracer bullet tests instead of unit tests?**
Unit tests verify isolated behavior. Tracer bullets verify the system works end-to-end as designed. When all tracer bullets pass, you have a working application — not a collection of passing units that don't integrate. The architecture doc describes an integrated system; the tests should prove integration.

**Why let the agent plan instead of the conductor generating a plan?**
The conductor has structured data (failing test names, file paths) but no understanding of the architecture. The agent can read the architecture doc, understand the integration patterns, and decompose work intelligently — grouping related changes, ordering by dependency, identifying what to build first. A template-generated plan lists files; an agent-generated plan understands the system.

**Why /work instead of a custom impl loop?**
/work has: task iteration with test-after-each, Stop hook (hard enforcement of deps + green tests), architecture-aware mode, commit discipline. Building this in the conductor would duplicate 400+ lines of battle-tested skill logic. And /work improves independently — toolkit updates automatically benefit the pipeline.

**Why keep the "retry via status mutation" pattern instead of true DAG cycles?**
DAGs are acyclic by definition — `bd` would reject cycle edges. The status mutation approach (reopen a closed bead) is the correct way to implement feedback in a DAG system. It's already proven in the conductor's redteam→impl and merge→impl loops.

**Why make Pipeline.beadIds flexible (Phase 5)?**
The fixed 7-key record is the biggest structural blocker. Every new node requires a type change, pipeline store migration, cockpit update, and gate config update. A flexible record lets us add nodes without type system surgery each time. The blast radius is real (conductor, store, daemon, cockpit, CLI, sync, tests) — Phase 5 is scoped accordingly.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Architecture doc parsing is fragile — different formats break conformance check | High | Medium | Parse with lenient regex, fallback gracefully. Log what couldn't be parsed. Don't block on parse failure — only on detected violations. |
| Tracer bullet tests are harder to write — test agent produces fewer tests | Medium | Medium | Acceptable tradeoff. 15 strong tracer bullets > 53 string-matching tests. Gate enforces quality, not quantity. |
| /work Phase 5 AskUserQuestion stalls pipeline | High | High | Task 3.3: `HOG_PIPELINE=1` env var. Requires toolkit change — tracked explicitly, implemented in parallel. |
| Conform gate is too strict on stubs — catches legitimate empty implementations | Medium | Low | Stub detection ignores test fixtures, config files, type-only files. Only flags functions that return hardcoded values in `src/`. |
| Flexible beadIds breaks cockpit/daemon/CLI | Medium | High | Phase 5 is explicitly scoped for all touchpoints. Migration preserves existing pipelines. Integration test verifies end-to-end. |
| 3 conform iterations isn't enough for complex projects | Low | Medium | Configurable via `pipeline.maxConformRetries`. Default 3, escalate to human after. |
| Pipeline store schema change invalidates persisted pipelines | Medium | High | Task 5.2: explicit migration — old 7-key format loads transparently into flexible format. Version bump prevents silent data loss. |
| Conformance checker is JS-centric — false-fails on Python/Rust/Go projects | Medium | Medium | Task 2.1: language-aware import detection based on file extension. Default to generic grep if language unknown. |

## Acceptance Criteria

1. **Tracer bullets, not string-matching.** >80% of spec tests import and call source functions. `readFileSync` + `toMatch` tests rejected by quality gate.
2. **Architecture conformance verified.** Before redteam fires, every dependency in the architecture doc is imported, every specified file exists, no stubs detected. Conformance runs as a pre-close gate — no race with downstream phases.
3. **Impl iterates via /work.** Agent plans its own work from the architecture doc, then executes task-by-task with test runs after each task. Not fire-and-forget.
4. **Feedback loops work.** When conform fails, impl gets a structured report of what's missing and loops. When redteam writes failing tests, impl fixes them and conform re-verifies automatically (pre-close gate).
5. **Retry counters are per-gate, not per-role.** Multiple gates targeting the same role track attempts independently.
6. **Fully autonomous.** Pipeline completes without human intervention for well-specified architectures. Human only brainstorms + reviews the finished product.
7. **What you design is what you get.** The finished implementation matches the architecture doc — not a subset, not a hollow shell, but the real thing.
