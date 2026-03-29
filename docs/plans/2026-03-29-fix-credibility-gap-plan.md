---
title: "fix: close the credibility gap — enforcement must match claims"
type: plan
date: 2026-03-29
status: complete
brainstorm: null
confidence: high
depends-on: docs/plans/2026-03-29-fix-skills-pipeline-hardening-plan.md
---

# Close the Credibility Gap

> If you claim it's enforced, it must actually be enforced. If it's advisory, say so.

**One-line summary:** Fix 5 inconsistencies where hog's behavior doesn't match its claims —
phase counting, scope enforcement, lint blocking, brainstorm path, and refinery tracking.

## Problem Statement

Codex's peer review identified a credibility gap: hog markets "binding architecture,"
"strict role boundaries," and "merge safety" — but several of these are advisory, not
enforced. Users who discover the gap lose trust, and trust is hard to recover.

The specific issues:
1. CLI and GitHub sync say "6 phases" — there are 7
2. Scaffold scope is `canWrite: ["**"]` — effectively no constraint
3. Lint failures don't block merges — but the merge gatekeeper claims to "run the linter"
4. `BRAINSTORM_PATH` receives a truncated summary string, not a file path
5. Conductor ignores refinery events — merge failures don't roll back bead state

## Proposed Solution

Fix each inconsistency directly. No architectural changes — just make reality match claims.

---

## Tasks

### 1. Fix phase accounting (6 → 7)

- [x] 1.1 **cli.ts:454** — Add `"scaffold"` to the phases array between `"stories"` and `"tests"`
- [x] 1.2 **cli.ts:465** — Change `Progress: ${completed}/6 phases` → `/7 phases`
- [x] 1.3 **cli.ts:640** — Change `${pipeline.completedBeads}/6 phases` → `/7 phases`
- [x] 1.4 **cli.ts:771** — Change `"All 6 phases done"` → `"All 7 phases done"`
- [x] 1.5 **github-sync.ts:25** — Add `"scaffold"` to `PHASE_ORDER` array
- [x] 1.6 **github-sync.ts:108** — Change `/6 phases done` → `/7 phases done`
- [x] 1.7 **Search for any remaining "6 phases" or hardcoded phase lists** missing scaffold

### 2. Tighten scaffold scope

- [x] 2.1 **roles.ts** — Change scaffold `canWrite` from `["**"]` to:
  ```
  ["package.json", "*.config.*", "tsconfig.*", "biome.json", ".gitignore",
   ".env.example", "docs/stories/**", "Dockerfile", "docker-compose.*",
   ".github/**"]
  ```
  This covers: package manifests, config files, context docs, CI, Docker —
  but NOT `src/**` or `*.test.*`.

- [x] 2.2 **Update scaffold forbidden** to be more explicit:
  ```
  ["Do NOT create source files (.ts, .js, .py, .rs)",
   "Do NOT create test files (*.test.*, *.spec.*)",
   "Do NOT write functions, classes, or code"]
  ```

### 3. Make lint blocking configurable

- [x] 3.1 **quality-gates.ts:68** — Change lint severity from `"warning"` to `"error"`

  Decision rationale: the merge gatekeeper's whole point is "nothing merges without
  approval." A lint failure IS a merge blocker. If teams want to skip lint, they can
  configure it off — but the default should be strict.

  Alternative considered: make it configurable via pipeline config. Rejected for now —
  start strict, add config if users complain.

### 4. Fix BRAINSTORM_PATH to be a real file path

- [x] 4.1 **conductor.ts:1151-1154** — Remove the manual `BRAINSTORM_PATH` assignment
  from `phaseSummaries`. The contract-based wiring already handles this correctly
  via `wirePhaseInputs()` when `pipelineOutputs` is populated.

  The flow should be:
  1. Brainstorm completes → contract outputs stored in `pipelineOutputs`
  2. Next phase spawns → `wirePhaseInputs()` maps outputs to inputs
  3. `BRAINSTORM_PATH` is never set manually — it comes from contract wiring

  If brainstorm hasn't produced contract outputs (e.g., old pipeline or fallback mode),
  the skill falls back to searching — which is correct.

### 5. Handle refinery events in conductor

- [x] 5.1 **conductor.ts** — Add listener for `mutation:failed`:
  ```ts
  this.eventBus.on("mutation:failed", (event) => {
    // Find the pipeline by feature ID
    // Re-open the relevant bead
    // Decrement completedBeads
    // Log the failure
  });
  ```

- [x] 5.2 **conductor.ts** — Add listener for `mutation:completed`:
  ```ts
  this.eventBus.on("mutation:completed", (event) => {
    // Log the successful merge under the pipeline's feature ID
    // Check if all beads are now merged — if so, mark pipeline complete
  });
  ```

  This closes the gap where the conductor counts a bead as "complete" when the
  agent finishes, but the refinery merge could still fail (tests fail post-rebase,
  quality gates block). With this fix, a failed merge reopens the bead.

---

## Acceptance Criteria

- [ ] `hog pipeline list` shows "X/7 phases" for all pipelines
- [ ] GitHub issue comments say "/7 phases"
- [ ] Scaffold agent cannot create `src/*.ts` or `*.test.ts` files (scope check)
- [ ] Lint failures produce `BLOCK` verdict in merge gatekeeper
- [ ] `BRAINSTORM_PATH` is either a valid file path or not set (never a summary string)
- [ ] Refinery merge failure reopens the relevant bead and decrements `completedBeads`
- [ ] 856+ tests pass, zero type errors

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| Phase count is hardcoded in ~6 places | Verified | Research found 6 locations + 1 Codex missed |
| Lint severity change won't break existing users | Unverified | Need to check if anyone overrides lint config |
| Refinery events include featureId | Verified | `mutation:failed` and `mutation:completed` have pipeline context |
| Contract wiring replaces manual BRAINSTORM_PATH | Verified | `wirePhaseInputs()` maps outputs → inputs |

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Lint blocking breaks pipelines that currently pass | Medium | Medium | Can revert to warning if needed |
| Refinery rollback causes infinite loops | Low | High | Add a max-rollback counter |
| Scaffold scope too tight — blocks legitimate configs | Medium | Low | List is extensible; add patterns as needed |

## References

- [Codex peer review output](../../) — the review that surfaced these issues
- [Hardening plan](2026-03-29-fix-skills-pipeline-hardening-plan.md) — prerequisite
