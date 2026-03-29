---
title: "feat: skills-first pipeline — migrate prompts to Heart of Gold toolkit skills"
type: plan
date: 2026-03-29
status: approved
brainstorm: docs/brainstorms/2026-03-29-skills-first-pipeline-brainstorm.md
confidence: medium
---

# Skills-First Pipeline Migration

> "We're building a worse version of what Claude Code already offers."

**One-line summary:** Extract pipeline prompts from TypeScript strings into Heart of Gold toolkit
skills with Stop hooks for structural quality enforcement.

## Problem Statement

hog's pipeline intelligence is trapped in `roles.ts` — 800+ lines of TypeScript string constants
that can't be tested independently, don't support knowledge directories, enforce quality via
self-attestation, and can't be distributed.

Claude Code's skills system provides all of this natively: SKILL.md files with knowledge dirs,
`type: agent` Stop hooks that independently verify work, `allowed-tools` for scope restriction,
dynamic context injection, and plugin packaging.

## Proposed Solution

Four phases, each independently shippable:

```
Phase 1: Extract skills     ─── Move prompts from roles.ts to SKILL.md files
Phase 2: Add Stop hooks     ─── Structural quality gates inside agent lifecycle
Phase 3: Dynamic context    ─── Replace template vars with !`command` injection
Phase 4: Plugin packaging   ─── Distribute via heart-of-gold-toolkit marketplace
```

---

## Phase 1: Extract Skills (target: heart-of-gold-toolkit repo)

**Goal:** Move the 7 role prompts from `roles.ts` string constants into SKILL.md files
in the heart-of-gold-toolkit's `marvin` plugin.

### Tasks

- [ ] 1.1 **Create skill directory structure** in heart-of-gold-toolkit:
  ```
  plugins/marvin/skills/
  ├── hog-brainstorm/SKILL.md
  ├── hog-stories/SKILL.md
  ├── hog-scaffold/SKILL.md
  ├── hog-test/SKILL.md
  ├── hog-impl/SKILL.md
  ├── hog-redteam/SKILL.md
  └── hog-merge/SKILL.md
  ```

- [ ] 1.2 **Write SKILL.md frontmatter** for each skill:
  ```yaml
  ---
  name: hog-test
  description: "Test Writer — writes failing tests from stories with architectural conformance"
  disable-model-invocation: true
  user-invocable: false
  allowed-tools: Read, Edit, Write, Bash, Glob, Grep, Agent
  model: sonnet
  effort: high
  ---
  ```

- [ ] 1.3 **Move prompt content** from roles.ts constants into each SKILL.md body.
  The prompt content stays the same — this is a mechanical extraction, not a rewrite.

- [ ] 1.4 **Extract knowledge files** from inline prompt text:
  - `hog-test/anti-patterns.md` — weak test patterns, from the `<examples>` section
  - `hog-test/conformance-patterns.md` — architectural conformance test patterns
  - `hog-impl/stub-patterns.md` — what stubs look like, grep patterns
  - `hog-redteam/attack-categories.md` — security + architecture audit checklist
  - `hog-brainstorm/architecture-template.md` — the ADR/requirements template
  - `hog-scaffold/tooling-checklist.md` — linter/formatter/test-framework setup

- [ ] 1.5 **Update hog conductor** to invoke skills instead of passing raw prompts:
  - Change `spawn-agent.ts` to pass `/marvin:hog-<role>` as the prompt
  - OR read the SKILL.md content and pass it as the prompt (fallback if skills
    aren't installed)
  - Keep `--output-format stream-json` for progress monitoring

- [ ] 1.6 **Verify round-trip** — run a pipeline with the new skill-based invocation.
  Agent should produce equivalent output to the old prompt-based invocation.

- [ ] 1.7 **Simplify roles.ts** — reduce to role metadata only (label, envRole, scope).
  Remove the prompt string constants. The intelligence lives in SKILL.md now.

### Exit Criteria

- [ ] All 7 SKILL.md files exist in heart-of-gold-toolkit
- [ ] hog conductor invokes skills (or reads SKILL.md as fallback)
- [ ] Pipeline produces equivalent output with skills vs. old prompts
- [ ] roles.ts is under 100 lines (metadata only)

---

## Phase 2: Add Stop Hooks

**Goal:** Each skill gets a `type: agent` Stop hook that independently verifies
the agent's work before allowing completion.

### Tasks

- [ ] 2.1 **hog-test Stop hook** — verify before test writer completes:
  - Run test suite → ALL must fail (RED state)
  - grep STORY- in test files → every test references a story
  - For each arch doc dependency → grep test files for import
  - Return `{ok: false, reason: "..."}` if any check fails

- [ ] 2.2 **hog-impl Stop hook** — verify before implementer completes:
  - Run full test suite → ALL must pass
  - For each arch doc dependency → grep source for import
  - grep for stub patterns (hardcoded, TODO, FIXME, placeholder)
  - Return `{ok: false}` if any dependency is NOT imported (= stub)

- [ ] 2.3 **hog-redteam Stop hook** — verify before redteam completes:
  - For each arch doc dependency → grep source for import
  - Run all tests → new redteam tests must FAIL
  - Return `{ok: false}` if missed architecture violations

- [ ] 2.4 **hog-scaffold Stop hook** — verify scaffold didn't create source files:
  - `find . -name "*.ts" -newer $START_TIME` → should be zero (only configs)
  - Dependencies from arch doc should be in package.json

- [ ] 2.5 **PostToolUse auto-lint hook** in plugin `hooks/hooks.json`:
  - On `Edit|Write` of `.ts/.tsx` files → run biome check
  - Feedback injected into agent context

### Exit Criteria

- [ ] Test writer cannot complete without RED state verified
- [ ] Implementer cannot complete with missing arch doc dependencies
- [ ] Redteam catches architecture violations that test writer and impl missed
- [ ] Every file write gets auto-linted

---

## Phase 3: Dynamic Context Injection

**Goal:** Replace `{storiesPath}` template interpolation with `!`command`` in SKILL.md.

### Tasks

- [ ] 3.1 **Set environment variables** in conductor before spawning agents:
  ```typescript
  env: {
    STORIES_PATH: pipeline.storiesPath,
    ARCH_PATH: pipeline.architecturePath,
    CONTEXT_PATH: `docs/stories/${slug}.context.md`,
    FEATURE_ID: pipeline.featureId,
    PIPELINE_TITLE: pipeline.title,
  }
  ```

- [ ] 3.2 **Update SKILL.md files** to use `!`command`` instead of `{variables}`:
  ```markdown
  ## Your inputs
  - Stories: !`cat "$STORIES_PATH"`
  - Architecture doc: !`cat "$ARCH_PATH"`
  - Test failures: !`npm test 2>&1 | tail -50`
  ```

- [ ] 3.3 **Remove template interpolation** from conductor.ts `spawnForRole`:
  - No more `.replace(/\{title\}/g, ...)` chains
  - Env vars handle context passing

- [ ] 3.4 **Add fallback** for when env vars aren't set:
  ```markdown
  - Stories: !`cat "$STORIES_PATH" 2>/dev/null || echo "STORIES_PATH not set — search docs/stories/"`
  ```

### Exit Criteria

- [ ] No `{variable}` template interpolation in conductor.ts
- [ ] Skills read context from env vars via `!`command``
- [ ] Graceful fallback when env vars aren't set

---

## Phase 4: Plugin Packaging

**Goal:** Package everything as the `marvin` plugin in heart-of-gold-toolkit.

### Tasks

- [ ] 4.1 **Update marvin plugin.json** with skills, hooks, agents:
  ```json
  {
    "name": "marvin",
    "version": "1.0.0",
    "description": "Quality pipeline — TDD-enforced agent development",
    "skills": "./skills/",
    "hooks": "./hooks/hooks.json",
    "agents": "./agents/"
  }
  ```

- [ ] 4.2 **Create quality-verifier agent** (`agents/quality-verifier.md`):
  Shared verifier used by Stop hooks — checks architecture conformance,
  stub detection, test coverage.

- [ ] 4.3 **Create plugin hooks.json** with:
  - Safety deny rules (the `DENY_RULES` from `safety-rules.ts`)
  - PostToolUse auto-lint hook
  - PreToolUse git safety (block force push, rm -rf)

- [ ] 4.4 **Update hog conductor** to check if marvin plugin is installed:
  ```typescript
  // If plugin installed: claude -p "/marvin:hog-test"
  // If not: read SKILL.md from bundled fallback and pass as -p
  ```

- [ ] 4.5 **Write marvin plugin README** — installation, what each skill does,
  how to customize, how Stop hooks work.

- [ ] 4.6 **Test end-to-end** — `claude plugin install heart-of-gold-toolkit`,
  run `hog pipeline create "test feature"`, verify full pipeline completes
  with skill-based agents.

### Exit Criteria

- [ ] `claude plugin install heart-of-gold-toolkit` installs the marvin plugin
- [ ] `hog pipeline create` uses marvin skills when available
- [ ] Stop hooks enforce quality without self-attestation
- [ ] Plugin README explains the system

---

## Decision Rationale

### Why marvin plugin, not a standalone hog plugin?

The heart-of-gold-toolkit already has a `marvin` stub (quality/review plugin). The pipeline IS
quality enforcement. Marvin's personality ("brain the size of a planet, sees every flaw") fits
perfectly. And bundling with the toolkit means users who install the toolkit get the pipeline
skills for free.

### Why keep the conductor in TypeScript?

Skills handle the *intelligence* (what each agent does). The conductor handles the
*orchestration* (when to spawn, what order, DAG state). These are different concerns.
The conductor needs: process management, Unix sockets, Beads CLI integration, file persistence.
None of these are agent behaviors.

### Why fallback to bundled SKILL.md content?

Not all users will install the plugin. hog should work standalone. If the marvin plugin isn't
installed, the conductor reads SKILL.md files from a bundled copy and passes them as raw prompts.
Same content, just not using the skills system's extra features (Stop hooks, knowledge dirs).

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| `claude -p "/marvin:hog-test"` works in headless mode | Unverified | Need to test skill invocation via `-p` flag |
| Stop hooks with type:agent respect --output-format stream-json | Unverified | May need testing — Stop hooks run inside the session |
| Env vars are passed through to skill `!`command`` preprocessing | Verified | Research confirms env vars work in skill shell commands |
| Plugin hooks.json is loaded when any plugin skill is active | Verified | Research confirms plugin hooks load on installation |
| SKILL.md content can be read and passed as raw `-p` prompt | Verified | It's just markdown text |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Skill invocation via `-p` doesn't work headless | Medium | High | Fallback: read SKILL.md content, pass as raw prompt |
| Stop hooks add latency (subagent spawns take time) | Medium | Low | Set timeout to 120s. Quality is worth the wait. |
| Two repos to maintain (hog + toolkit) | High | Medium | Skills are the source of truth. hog's roles.ts becomes thin metadata. |
| Plugin versioning mismatches | Medium | Medium | hog checks plugin version. Warns if outdated. |
| Users don't install the plugin | Low | Low | Bundled fallback works without plugin. Plugin adds Stop hooks + knowledge. |

---

## References

- [Brainstorm](../brainstorms/2026-03-29-skills-first-pipeline-brainstorm.md)
- [Prompt Overhaul Plan](2026-03-29-refactor-pipeline-prompt-overhaul-plan.md)
- [Heart of Gold v2.1 Master Plan](2026-03-28-feat-heart-of-gold-v2.1-master-plan.md)
- [Grand Audit](../audits/2026-03-28-hog-grand-audit.md)
