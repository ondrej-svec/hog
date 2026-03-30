---
title: "feat: ship phase — post-merge documentation, knowledge capture & operational readiness"
type: plan
date: 2026-03-30
status: complete
brainstorm: docs/brainstorms/2026-03-30-ship-phase-brainstorm.md
confidence: high
codex-review: 12 findings addressed (2 critical, 5 high, 5 medium)
---

# Ship Phase

One-line: After merge passes, a `ship` agent produces README, deployment guide (if needed), what-changed summary, and knowledge docs — then checks operational readiness before declaring the pipeline complete.

## Problem Statement

The pipeline ends at merge. The human gets "pipeline complete" but no guide on what was built, how to deploy it, or what was learned. For projects like Quellis (Vercel + Neon + Clerk), this is the gap between "code works" and "I can actually use this."

## Proposed Solution

Add a `ship` phase as the 8th node in the pipeline DAG, after merge. Powered by a `/marvin:ship` skill in the heart-of-gold-toolkit.

### DAG topology change
```
brainstorm → stories → scaffold → tests → impl → redteam → merge → ship
```

### Ship produces up to 4 artifacts:

1. **README.md** — how to set up, run, configure. Updates existing README if present (merge, don't replace).
2. **Deployment guide** — conditional. Step-by-step: env vars, commands, services. Only when triggered.
3. **What-changed summary** — per-pipeline-run: what was built, tests, redteam findings. Written to `docs/changelog/` or appended to CHANGELOG.md.
4. **Knowledge docs** — patterns, decisions, solved problems. Written to `docs/solutions/` in compound format.

### Smart deployment guide trigger

Two signals, either sufficient:
- **Explicit:** Architecture doc contains `## Deployment`, `## Infrastructure`, or `## Hosting`
- **Implicit:** Project contains `vercel.json`, `Dockerfile`, `docker-compose.yml`, `fly.toml`, `render.yaml`, `terraform/`, `*.tf`, `netlify.toml`, or cloud provider SDK imports (`@vercel/`, `@aws-sdk/`, `@google-cloud/`)

### Operational readiness gate

Ship can flag blockers. Two categories:

**Ship fixes itself** (within its `canWrite` scope):
- Missing `.env.example` → ship creates it from env var usage in code
- Missing deployment guide sections → ship adds them to README

**Ship loops to impl** (outside its scope — needs code changes):
- Secrets hardcoded in source (not in env vars)
- No health check endpoint when deployment config exists
- Missing error boundaries on critical paths

## Implementation Tasks

### Phase 0: Pipeline store + phase count migration (prerequisite)

The pipeline store, conductor, and multiple consumers hardcode 7-phase assumptions. These must be data-driven before adding an 8th phase.

- [x] 0.1 Update `pipeline-store.ts` Zod schema — `beadIds` must accept any string keys, not a fixed 7-key shape. Add migration: old 7-key objects load transparently into flexible format.
- [x] 0.2 Remove hardcoded `Math.min(7, ...)` clamps in conductor (`completedBeads` increment) — derive max from `Object.keys(pipeline.beadIds).length`
- [x] 0.3 Update `beads-memory.ts` — `createFeatureDAG` return type and topology to match the 8-node default
- [x] 0.4 Update GitHub sync (`github-sync.ts`) — issue close/label should trigger on pipeline completion, not on `merge` phase specifically
- [x] 0.5 Update CLI phase display — derive phase list from pipeline metadata, not hardcoded array
- [x] 0.6 Update conductor completion message — "ready to merge" → "pipeline complete" (merge is no longer the final phase)
- [x] 0.7 Add `ship` to summary-parser exclusions — prevent sentiment gate from intercepting "BLOCK"/"FAIL" in ship summaries (same pattern as merge exclusion)

### Phase 1: Ship role in hog

- [x] 1.1 Add `ship` role to `roles.ts`:
  - skill: `"marvin:ship"`
  - fallbackPromptFile: `"ship"`
  - scope.canWrite: `["README.md", "docs/**", "CHANGELOG.md", ".env.example"]` — ship can fix operational gaps within its scope
  - scope.forbidden: `["Do NOT modify source code in src/", "Do NOT modify test files"]`
- [x] 1.2 Add `ship.md` fallback prompt to `fallback-prompts/`
- [x] 1.3 Add `ship` CLAUDE.md template to `role-context.ts` fallback templates
- [x] 1.4 Add `ship` to `beadToRole` title mapping in `roles.ts`
- [x] 1.5 Add skill contract for `marvin:ship` in `skill-contract.ts` — inputs: all phase summaries, architecture doc; outputs: README path
- [x] 1.6 Update `createFeatureDAG` `DEFAULT_TOPOLOGY` — add `{ id: "ship", label: "ship", dependsOn: ["merge"] }`
- [x] 1.7 Add `ship` to cockpit `PHASE_LABELS` and `DEFAULT_PHASE_ORDER`

### Phase 2: Ship-gate with correct retry semantics

The ship-gate must reopen impl AND all downstream phases (redteam, merge, ship) when it loops, otherwise the pipeline completes without re-running quality checks on the fixed code.

- [x] 2.1 Add `ship-gate` to `retry-engine.ts`:
  - phases: `["ship"]`
  - retryRole: `"impl"`
  - alsoReopen: `["redteam", "merge", "ship"]` — full re-verification chain
  - decrementBeads: 4 (impl + redteam + merge + ship)
  - maxRetries: 1
  - trackingMethod: `"retryFeedback"`
- [x] 2.2 Add escalation options: `["Retry impl", "Ship anyway", "Cancel pipeline"]`
- [x] 2.3 Expand impl role `canWrite` scope — add `".env.example"` so impl can fix operational readiness gaps when looped from ship

### Phase 3: Detection logic

- [x] 3.1 Add `detectDeploymentNeed()` to new file `src/engine/ship-detection.ts` — checks architecture doc sections + file patterns. Returns `{ needed: boolean, signals: string[] }`
- [x] 3.2 Add `checkOperationalReadiness()` to `ship-detection.ts` — scans for:
  - Missing `.env.example` when `process.env.` is used in source
  - Hardcoded secrets (API keys, tokens in source, not env vars)
  - No health check endpoint when deployment config exists
  - Returns `{ ready: boolean, gaps: { fixableByShip: string[], needsImpl: string[] } }`
- [x] 3.3 Tests for both detection functions

### Phase 4: Ship skill in heart-of-gold-toolkit

- [x] 4.1 Create `/marvin:ship` skill in `plugins/marvin/skills/ship/SKILL.md` — 4 phases:
  1. **Analyze** — read all phase summaries, architecture doc, test results, redteam findings, merge verdict
  2. **Produce** — write/update README.md (merge with existing), deployment guide (if triggered), what-changed summary, knowledge docs
  3. **Fix** — if operational gaps are within scope (.env.example, docs), fix them directly. If outside scope (code changes), report as blocker.
  4. **Report** — summary of artifacts produced + any gaps that need impl
- [x] 4.2 Add Stop hook — verify README exists and is non-empty
- [x] 4.3 Handle `HOG_PIPELINE=1` — skip AskUserQuestion in pipeline mode

### Phase 5: Wire into conductor

- [x] 5.1 Update conductor `onAgentCompleted` — for `ship` phase, run `checkOperationalReadiness()`. If `needsImpl` gaps found, use `ship-gate` to loop back (reopening impl + redteam + merge + ship). If only `fixableByShip` gaps, let ship handle them.
- [x] 5.2 Update `buildContextSection()` — ship role gets ALL phase summaries (test, impl, redteam, merge), plus architecture doc content inline. Not just 2 phases.
- [x] 5.3 Pass deployment detection result in the ship agent's prompt context
- [x] 5.4 Add fallback README verification in conductor — if ship completes without README.md existing (fallback mode, no Stop hook), log a warning

### Phase 6: Tests

- [x] 6.1 Unit tests for `detectDeploymentNeed()` — vercel.json, Dockerfile, architecture doc sections, no signals
- [x] 6.2 Unit tests for `checkOperationalReadiness()` — missing .env.example, hardcoded secrets, gaps split by fixability
- [x] 6.3 Update existing tests — conductor test `createFeatureDAG` call expects 8-node topology, retry-engine test expects updated gate count
- [x] 6.4 Integration test — pipeline with ship phase completes end-to-end (mocked beads), README produced
- [x] 6.5 E2E test — ship detects hardcoded secret, loops to impl, impl fixes, full chain re-runs (real Dolt)
- [x] 6.6 Migration test — 7-phase pipeline loads correctly in 8-phase codebase

## Decision Rationale

**Why Phase 0 (migration) is a prerequisite:**
Codex review found hardcoded 7-phase assumptions in conductor (`Math.min(7, ...)`), pipeline-store (Zod schema strips unknown keys), GitHub sync (closes issues on merge), and CLI (hardcoded phase list). Adding an 8th phase without fixing these causes silent data loss and incorrect behavior.

**Why ship-gate reopens the full chain (impl + redteam + merge + ship):**
If ship finds a hardcoded secret and loops to impl, the fix needs to pass redteam (security check) and merge (quality check) again before ship re-verifies. Reopening only impl would let the pipeline skip quality gates on the fix.

**Why ship can write .env.example but not src/:**
Operational readiness gaps split into two categories: docs/config gaps (ship fixes directly) and code gaps (ship reports, impl fixes). This avoids the Codex-flagged issue of looping to impl for .env.example — ship creates it.

**Why exclude ship from summary-sentiment gate:**
Same pattern as merge — the sentiment gate catches "BLOCK"/"FAIL" words and escalates before the ship-gate can auto-loop. Ship must be excluded so ship-gate handles retry logic.

**Why compound-style knowledge docs instead of a custom format:**
The compound skill's output format (`docs/solutions/{domain}/{topic}.md` with YAML frontmatter) is already searchable by future pipelines via the brainstorm/plan research phase.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Ship agent produces low-quality README | Medium | Low | Stop hook verifies existence. Fallback conductor check for README. |
| Deployment detection false positives | Medium | Low | Only triggers a guide — worst case is an unnecessary but harmless document. |
| Full chain re-run is expensive (4 phases) | Medium | Medium | Ship-gate maxRetries: 1. Only one loop before human escalation. |
| 7→8 phase migration breaks in-flight pipelines | Medium | High | Phase 0: flexible beadIds schema, data-driven phase counts, graceful upgrade. |
| Ship phase adds time to every pipeline | Low | Low | Ship reads summaries, doesn't re-analyze code. 2-3 minutes. |
| Knowledge docs duplicate existing solutions | Low | Low | Ship agent searches `docs/solutions/` before writing. |

## Acceptance Criteria

1. **README produced.** Every pipeline run produces or updates a README.md with setup instructions.
2. **Deployment guide conditional.** Guide only generated when architecture doc or code signals deployment needs.
3. **What-changed summary.** Human can read a 1-page summary of what this pipeline run built.
4. **Knowledge captured.** Novel patterns and decisions written to `docs/solutions/` automatically.
5. **Operational readiness checked.** Ship fixes what it can (.env.example, docs), loops to impl for code gaps.
6. **Ship-gate loop re-runs full chain.** impl → redteam → merge → ship all re-run after a code fix.
7. **8-phase pipeline works.** Cockpit shows 8 phases, all ✓. No hardcoded 7-phase assumptions remain.
8. **Migration safe.** Existing 7-phase pipelines load and complete correctly in 8-phase codebase.
