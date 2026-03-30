---
title: "Tracer Bullet Pipeline — architecture-driven gates and feedback loops"
date: 2026-03-30
area: engine/pipeline
symptoms:
  - "Impl agent produces string-matching tests that pass but features don't work"
  - "Pipeline completes but implementation has stubs, no-ops, missing deps"
  - "Redteam checks conformance instead of doing adversarial work"
  - "Bead claim failure loop after gate retry (Bobo-pkhi pattern)"
tags: [pipeline, gates, conformance, beads, retry-engine, tdd]
---

# Tracer Bullet Pipeline

## Problem

The pipeline produced hollow implementations — code that passed weak tests but didn't work.
Root causes:
1. Test writer produced string-matching tests (`readFileSync` + `toMatch`)
2. Impl agent was fire-and-forget — no iteration, no plan, no conformance check
3. No gate verified architecture conformance before redteam
4. Retry counters collided across gates targeting the same role
5. Bead state machine didn't handle `in_progress → open` transition for gate retries

## Solution

### New Gates

**spec-quality gate** (`tdd-enforcement.ts:analyzeTestQuality`)
- Classifies test files as behavioral (import + call) or string-matching (readFileSync + toMatch)
- Language-aware: JS/TS, Python, Rust patterns
- Rejects if >20% of tests are string-matching
- Pre-close gate on test phase

**conform-gate** (`conformance.ts:checkArchitectureConformance`)
- Parses architecture doc: `## Dependencies` table, `## File Structure` paths
- Language-aware import detection (JS/TS/Python/Rust)
- Stub pattern scanning (TODO/FIXME/STUB/not implemented)
- Pre-close gate on impl phase — runs AFTER stub-gate, BEFORE bead close. Green-gate runs post-close.
- 3 retries with structured conformance report in feedback

### Architectural Fixes

**Per-gate retry counters** — `retryFeedback` keyed by gate ID (e.g., `"coverage-gate"`, `"spec-quality"`) instead of role. Multiple gates targeting the same role track attempts independently.

**Bead state machine** — `updateStatus("open")` now handles `in_progress → closed → open` via `bd close` then `bd reopen`. `claim()` retries after clearing assignee for previously-claimed beads.

**captureTestContext timing** — moved from post-close `.then()` to pre-close, before spec-quality gate runs. Preserves existing testFiles on retry.

**Flexible `Pipeline.beadIds`** — changed from fixed 7-key record to `Record<string, string>`. All consumers updated: conductor, pipeline-store, daemon, cockpit, CLI.

**`createFeatureDAG` topology parameter** — accepts `DagNode[]` for custom topologies. Default is the 7-node chain. Enables future parallel/fan-in phases.

### Impl Agent Enhancement

**Plan-then-/work flow** — impl agent reads architecture doc + failing tests, writes `.hog/impl-plan.md`, then executes with `/marvin:work`. The /work skill's Stop hook enforces deps + tests.

**`HOG_PIPELINE=1` env var** — signals to /work skill that it's running non-interactively. Skips `AskUserQuestion` prompts.

**Rich context injection** — phase summaries increased from 300→2000 chars. Architecture doc content inlined in impl agent's context (3000 chars).

## Key Files

- `src/engine/conformance.ts` — architecture conformance checker (new)
- `src/engine/tdd-enforcement.ts` — `analyzeTestQuality()` added
- `src/engine/retry-engine.ts` — `spec-quality` + `conform-gate` configs, `evaluateGate()`
- `src/engine/conductor.ts` — gate wiring, per-gate counters, context injection, flexible beadIds
- `src/engine/beads.ts` — `updateStatus` close+reopen, `claim` retry, parameterized topology
- `src/engine/fallback-prompts/test-writer.md` — tracer bullet framing
- `src/engine/fallback-prompts/work.md` — plan-then-execute flow
- `heart-of-gold-toolkit/plugins/marvin/skills/work/SKILL.md` — pipeline mode detection

## Tests

- `src/engine/test-quality.test.ts` — 10 unit tests for `analyzeTestQuality`
- `src/engine/conformance.test.ts` — 11 unit tests for `checkArchitectureConformance`
- `src/engine/pipeline-gates.integration.test.ts` — 6 tests: gate rejection, gate pass, per-gate counters, env var
- `src/engine/pipeline-e2e.integration.test.ts` — 2 tests against live Dolt: full lifecycle with feedback loop, spec-quality rejection + re-spawn
- `src/engine/beads-dag.integration.test.ts` — 4 tests against live Dolt: DAG creation, advancement, feedback loops
