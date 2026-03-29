---
title: "fix+feat: skills pipeline hardening + exceptional path"
type: plan
date: 2026-03-29
status: complete
brainstorm: null
confidence: high
replaces: null
depends-on: docs/plans/2026-03-29-feat-skills-first-pipeline-v2-plan.md
---

# Skills Pipeline Hardening + Exceptional Path

> Fix what's broken, then make it sing.

**One-line summary:** Fix 10 concrete bugs from the v2 implementation, then build the
three features that would make this a best-in-class agent orchestration system.

## Problem Statement

The skills-first pipeline v2 implementation is architecturally sound but has production
blockers: all three Stop hooks are broken, fallback prompts won't bundle, env var contracts
have drift, retry loops have gaps, and the Refinery receives branches before gates evaluate.
Beyond fixes, the system lacks the contract validation and observability that would make it
exceptional.

## Proposed Solution

Two streams of work, in order:

**Stream A (Hardening):** Fix all known bugs. Nothing merges until the pipeline is
trustworthy end-to-end.

**Stream B (Exceptional):** Build skill contract manifests, a unified retry engine,
and pipeline telemetry. These transform hog from "works" to "best-in-class."

---

## Stream A: Hardening (Fix Everything That's Broken)

### A.1 Fix all four Stop hooks [toolkit repo]

All three existing hooks have correctness bugs. The fourth was never created.

- [x] A.1.1 **Fix scaffold Stop hook** — `find | head -1` always exits 0

  Current (broken):
  ```sh
  find . -name '*.ts' ... | head -1 && echo '{"ok":false,...}' || echo '{"ok":true}'
  ```

  Fix:
  ```sh
  FOUND=$(find . -name '*.ts' -newer /tmp/scaffold-start -not -name '*.config.*' -not -name '*.d.ts' | head -1)
  if [ -n "$FOUND" ]; then
    echo '{"ok":false,"reason":"Created source files — scaffold must only create configs"}'
  else
    echo '{"ok":true}'
  fi
  ```

  Also handle brownfield: check if `/tmp/scaffold-start` exists, skip check if not.

- [x] A.1.2 **Fix redteam Stop hook** — parses ALL tables, not just Dependencies

  Current (broken): `grep -E '^\| ' "$ARCH_PATH"` matches every table in the file.

  Fix: scope to `## Dependencies` section only:
  ```sh
  DEPS=$(awk '/^## Dependencies/{f=1;next} /^## /{f=0} f && /^\| /' "$ARCH_PATH" \
    | grep -v '^\| Package\|^\| ---' \
    | awk -F'|' '{print $2}' | tr -d ' ' | grep -v '^$')
  ```

- [x] A.1.3 **Fix test-writer Stop hook** — `Tests.*passed` matches failure output

  Current (broken): `grep -q "Tests.*passed\|0 failed\|All tests passed"` matches
  Vitest's `"5 failed | 0 passed"` output, blocking correctly-achieved RED state.

  Fix:
  ```sh
  if echo "$RESULT" | grep -qE "[1-9][0-9]* passed"; then
    echo '{"ok":false,"reason":"Some tests are passing — ALL must fail in RED state"}'
  else
    echo '{"ok":true}'
  fi
  ```

- [x] A.1.4 **Add work Stop hook** — plan specified one, never created

  Add to `work/SKILL.md` frontmatter:
  ```yaml
  hooks:
    Stop:
      - hooks:
          - type: command
            command: |
              if [ -n "$ARCH_PATH" ] && [ -f "$ARCH_PATH" ]; then
                DEPS=$(awk '/^## Dependencies/{f=1;next} /^## /{f=0} f && /^\| /' "$ARCH_PATH" \
                  | grep -v '^\| Package\|^\| ---' \
                  | awk -F'|' '{print $2}' | tr -d ' ' | grep -v '^$')
                MISSING=""
                for DEP in $DEPS; do
                  if ! grep -rq "from ['\"]${DEP}" src/ 2>/dev/null; then
                    MISSING="$MISSING $DEP"
                  fi
                done
                if [ -n "$MISSING" ]; then
                  echo "{\"ok\":false,\"reason\":\"Dependencies not imported:$MISSING\"}"
                  exit 0
                fi
              fi
              # Run test suite — all must pass
              TEST_CMD=$(jq -r '.scripts.test // empty' package.json 2>/dev/null)
              if [ -z "$TEST_CMD" ]; then TEST_CMD="npx vitest run 2>&1"; fi
              RESULT=$(eval "$TEST_CMD" 2>&1)
              if echo "$RESULT" | grep -qE "[1-9][0-9]* failed"; then
                echo "{\"ok\":false,\"reason\":\"Tests failing\"}"
              else
                echo '{"ok":true}'
              fi
            timeout: 180
  ```

### A.2 Fix conductor bugs [hog repo]

- [x] A.2.1 **Fix `beadToRole` scaffold missing** in label fallback

  Add `if (label === "hog:scaffold") return "scaffold";` to the label fallback
  block in `roles.ts:273-279`. Add test coverage.

- [x] A.2.2 **Fix `BRAINSTORM_PATH` env var** — condition checks wrong field

  Change `conductor.ts:1148` from:
  ```ts
  if (pipeline.context?.retryFeedback?.["brainstorm"]) {
  ```
  To:
  ```ts
  if (pipeline.context?.phaseSummaries?.["brainstorm"]) {
  ```
  And set the value to the actual brainstorm output path, not the summary string.
  The brainstorm phase writes stories to `docs/stories/{slug}.md` — store that path
  in `phaseSummaries["brainstorm"]` when brainstorm completes.

- [x] A.2.3 **Move Refinery submission after gates**

  In `onAgentCompleted`, move the `refinery.submit()` call (line 1387) to AFTER all
  pre-close gates have passed. Currently gates return early on failure, which means
  any `return` before the submit prevents submission — but the submit happens before
  the gates. Swap the order: gates first, submit after, close last.

- [x] A.2.4 **Add escalation to stub-gate**

  After `if (retryAttempt <= 2)` in the stub detection gate (line 1513), add an
  `else` block mirroring the coverage gate's escalation:
  ```ts
  } else {
    this.log(pipeline.featureId, "gate:stub-detection:exhausted", "Max retries. Escalating.");
    const escResult = enqueueQuestion(this.questionQueue, { ... });
    ...
    pipeline.status = "blocked";
  }
  ```

- [x] A.2.5 **Add max retry to green-gate**

  Add a retry counter to the GREEN verification (line 1559). Track via decision log
  (same pattern as redteam→impl). After 2 green failures, escalate to human.

### A.3 Fix build and bundling [hog repo]

- [x] A.3.1 **Bundle fallback prompts in dist/**

  Option A: Add a `copy` plugin to `tsup.config.ts` that copies
  `src/engine/fallback-prompts/*.md` to `dist/engine/fallback-prompts/`.

  Option B: Inline the prompts at build time (import as string).

  Decision: **Option A** — keeps prompts editable and inspectable in dist/.
  Use `tsup-plugin-copy` or a post-build script.

- [x] A.3.2 **Add build verification test**

  Add a test that verifies all 7 fallback prompt files exist at the resolved path.
  Run as part of `npm run ci`.

### A.4 Modernize role-context.ts [hog repo]

- [x] A.4.1 **Strip instructional prose from CLAUDE.md templates**

  The CLAUDE.md templates in `role-context.ts` are vestigial — they duplicate
  what the skill SKILL.md now provides. When skills are active, agents get both
  SKILL.md instructions AND the worktree CLAUDE.md, which can contradict.

  Reduce CLAUDE.md templates to scope-only:
  - Role name and label
  - `scopeToClaudeMd()` output (canWrite, forbidden)
  - File paths section (storiesPath, archPath)
  - One line: "Your primary instructions come from the skill. This file defines your scope."

  Keep fallback mode: if skill is NOT active, CLAUDE.md should be more instructional.
  Gate this on a flag or env var set by the conductor.

### Exit Criteria — Stream A

- [ ] All 4 Stop hooks pass manual testing on a real project
- [ ] `beadToRole("scaffold")` works via both title prefix and label
- [ ] `BRAINSTORM_PATH` is set when brainstorm output exists
- [ ] Refinery receives branches only after gates pass
- [ ] All 5 retry loops have escalation after max retries
- [ ] `npm run build && node dist/cli.js --help` works (fallback prompts bundled)
- [ ] 832+ tests pass, zero type errors

---

## Stream B: Exceptional Path

### B.1 Skill Contract Manifests [both repos]

The single most impactful improvement. Skills declare their inputs/outputs in
frontmatter. The conductor validates and auto-wires.

- [x] B.1.1 **Define contract schema** in toolkit

  Add to SKILL.md frontmatter:
  ```yaml
  contract:
    inputs:
      STORIES_PATH: { required: false, fallback: "search" }
      ARCH_PATH: { required: false, fallback: "search" }
      FEATURE_ID: { required: false, fallback: "ask" }
    outputs:
      stories: "docs/stories/{slug}.md"
      architecture: "docs/stories/{slug}.architecture.md"
  ```

  Each skill declares what env vars it reads and what files it produces.
  `required: false` means the skill works standalone (asks/searches).
  `required: true` means the pipeline MUST provide it.

- [x] B.1.2 **Add contracts to all 7 skills**

  Update each SKILL.md frontmatter with its specific contract.

- [x] B.1.3 **Build contract validator in hog**

  New module `src/engine/skill-contract.ts`:
  ```ts
  interface SkillContract {
    inputs: Record<string, { required: boolean; fallback: "ask" | "search" }>;
    outputs: Record<string, string>; // template paths
  }

  function validateContract(contract: SkillContract, env: Record<string, string>): {
    valid: boolean;
    missing: string[];
  }

  function resolveOutputPaths(contract: SkillContract, vars: { slug: string }): Record<string, string>;
  ```

  The conductor calls `validateContract()` before spawning and
  `resolveOutputPaths()` to auto-wire phase outputs to phase inputs.

- [x] B.1.4 **Wire conductor to read contracts**

  When spawning with a skill (not fallback), read the SKILL.md frontmatter,
  extract the contract, validate inputs, and log warnings for missing required
  vars. Use output paths from the previous phase to populate input vars for
  the next phase — no more filename heuristics.

### B.2 Unified Retry Engine [hog repo]

Replace 5 inline retry blocks with a single, declarative engine.

- [x] B.2.1 **Design the retry engine interface**

  ```ts
  interface RetryGate {
    id: string;
    trigger: (pipeline: Pipeline, phase: PipelineRole, summary?: string) => Promise<GateResult>;
    retryRole: PipelineRole;
    maxRetries: number;
    escalation: "human";
  }

  interface GateResult {
    passed: boolean;
    reason?: string;
    missing?: string[];
    context?: string;
  }
  ```

- [x] B.2.2 **Extract existing gates into RetryGate implementations**

  - `CoverageGate` — story coverage check
  - `StubGate` — stub detection
  - `GreenGate` — test suite pass verification
  - `RedteamGate` — redteam→impl loop
  - `MergeGate` — merge→impl loop

  Each gate is a pure function that takes pipeline state and returns GateResult.

- [x] B.2.3 **Build the retry engine**

  ```ts
  class RetryEngine {
    constructor(private gates: RetryGate[], private questionQueue: QuestionQueue) {}

    async evaluate(pipeline: Pipeline, phase: PipelineRole, summary?: string): Promise<{
      proceed: boolean;
      actions: RetryAction[];
    }>;
  }
  ```

  The engine runs all applicable gates for a phase, collects results, and
  returns a unified decision: proceed (close bead) or retry (reopen beads +
  inject feedback).

- [x] B.2.4 **Replace inline gate logic in conductor**

  The `onAgentCompleted` method becomes:
  ```ts
  const { proceed, actions } = await this.retryEngine.evaluate(pipeline, phase, summary);
  if (!proceed) {
    for (const action of actions) { /* apply retries, escalations */ }
    return;
  }
  // Submit to refinery, close bead, etc.
  ```

### B.3 Pipeline Telemetry [hog repo]

Make the orchestration observable and debuggable.

- [x] B.3.1 **Structured gate results in decision log**

  Every gate evaluation gets a decision log entry with:
  - Gate ID, phase, result (pass/fail)
  - Retry attempt number
  - Missing items, reason
  - Time taken

- [x] B.3.2 **Skill mode indicator in cockpit**

  Show in the pipeline view whether each agent is running a skill or fallback:
  ```
  Test Writer  ● running  [skill: marvin:test-writer]
  Implementer  ● running  [fallback]
  ```

- [x] B.3.3 **Pipeline dry-run command**

  `hog pipeline dry-run "feature name"` — prints what WOULD happen:
  - Which skills (or fallbacks) for each phase
  - Which env vars would be set
  - Which retry loops are active
  - Estimated phase count

  No agents spawned. Pure planning output.

---

## Decision Rationale

### Why fix hooks before anything else?

Stop hooks are the quality enforcement mechanism. Broken hooks mean broken guarantees.
A pipeline that looks like it's enforcing TDD but whose RED-state check is inverted is
worse than no check at all — it gives false confidence.

### Why skill contracts over other "exceptional" features?

The implicit filename contract is the root cause of multiple bugs (FEATURE_ID/slug drift,
BRAINSTORM_PATH confusion, story file resolution). Making the contract explicit fixes a
class of problems, not just individual bugs. It also makes adding new skills to the
pipeline zero-config.

### Why a retry engine instead of just fixing the inline blocks?

Five inline retry blocks with subtly different patterns is a maintenance hazard. The
green-gate had no max retry because it was written separately from the coverage-gate
which did. A shared engine makes it impossible to forget escalation.

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| Stop hooks run in headless mode (`-p`) | Unverified | Need to test before trusting hooks |
| `claude -p "/marvin:test-writer"` invokes the skill | Unverified | Plan assumption still open |
| tsup-plugin-copy or equivalent exists | Unverified | Need to check npm registry |
| SKILL.md frontmatter parsing works for custom keys | Unverified | `contract:` is non-standard YAML key |
| YAML frontmatter in SKILL.md is readable at runtime | Verified | Skills are text files, parseable |

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stop hook fixes break existing skill behavior | Medium | Medium | Test each hook manually before shipping |
| Refinery reordering introduces race conditions | Low | High | Gate evaluation is synchronous; submit is after |
| Skill contracts add complexity without adoption | Medium | Medium | Start with 2 skills, validate the pattern, then expand |
| Unified retry engine is over-engineered | Low | Low | Extract as-is first, optimize later |

## Implementation Order

```
Stream A (Hardening):
  A.1 (hooks) → A.2 (conductor bugs) → A.3 (bundling) → A.4 (role-context)
  ↑ blocks everything — pipeline is untrustworthy without these fixes

Stream B (Exceptional):
  B.1 (contracts) → B.2 (retry engine) → B.3 (telemetry)
  ↑ can start after A.2 completes (conductor is the integration point)
```

Streams can partially overlap: A.1 (toolkit) and A.2 (hog) are in different repos.

## References

- [v2 implementation plan](2026-03-29-feat-skills-first-pipeline-v2-plan.md)
- [Codex systemic review](../../docs/plans/) — findings inline above
- [Claude analysis agents](../../src/engine/conductor.ts) — bug sites confirmed
