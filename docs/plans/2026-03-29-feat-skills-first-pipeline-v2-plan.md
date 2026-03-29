---
title: "feat: skills-first pipeline v2 — standalone skills + hog orchestration"
type: plan
date: 2026-03-29
status: approved
brainstorm: docs/brainstorms/2026-03-29-skills-first-pipeline-brainstorm.md
confidence: high
replaces: docs/plans/2026-03-29-feat-skills-first-pipeline-plan.md
---

# Skills-First Pipeline v2

> Skills are the methodology. hog is the orchestrator. Each works without the other.

**One-line summary:** Build 4 new standalone skills in the Heart of Gold toolkit, enhance 2
existing ones, wire hog to chain them with gates and feedback loops via Beads DAG.

## Problem Statement

hog's pipeline intelligence is 800+ lines of TypeScript string constants. The skills system
in the Heart of Gold toolkit provides everything we need: knowledge directories, Stop hooks,
dynamic context injection, and plugin distribution. But the skills must be standalone —
useful without hog. hog adds the orchestration: phase ordering, gates, feedback loops, and
the Refinery merge queue.

## Proposed Solution

### The Skills (Heart of Gold toolkit repo)

| Skill | Plugin | Status | Purpose (standalone) |
|-------|--------|--------|---------------------|
| `deep-thought:brainstorm` | deep-thought | Exists | Explore problems, make decisions |
| `deep-thought:architect` | deep-thought | **NEW** | Turn decisions into stories + architecture doc + ADRs |
| `marvin:scaffold` | marvin | **NEW** | Prepare a project for development |
| `marvin:test-writer` | marvin | **NEW** | Write failing tests from stories |
| `marvin:work` | marvin | Enhance | Execute a plan / make tests pass |
| `marvin:redteam` | marvin | **NEW** | Adversarial review — write failing tests that expose weaknesses |
| `marvin:review` | marvin | Enhance | Code review + merge readiness check |

### The Orchestrator (hog repo)

hog chains the skills via Beads DAG with gates and feedback loops:

```
brainstorm → architect → scaffold → test-writer → work → redteam → review
    │            │           │           │          │        │         │
 (human)    (human confirms) │     (coverage gate) (GREEN) (failures) (failures)
                             │           │          │    ↓        ↓
                             │      retry test   retry  → impl retry
                             │      (max 2x)     impl    (max 2x)
                             │                   (2x)
                          (fast,               then → human
                        mechanical)
```

### How hog passes context to skills

Skills are standalone. When hog invokes them, it passes pipeline context as arguments:

```bash
# Standalone (user invokes directly):
/marvin:test-writer
# → skill asks: "Where are the stories?"

# Via hog pipeline (conductor passes context):
claude -p "/marvin:test-writer" --env STORIES_PATH=docs/stories/quellis.md \
  --env ARCH_PATH=docs/stories/quellis.architecture.md \
  --env FEATURE_ID=feat-1234 \
  --output-format stream-json
# → skill reads env vars, has everything it needs
```

Skills check for env vars first, fall back to asking/searching if not set. This makes
them work in both contexts without modification.

---

## Phase 1: New Skills in Heart of Gold Toolkit

All work in this phase happens in the `heart-of-gold-toolkit` repo.

### Tasks

- [ ] 1.1 **`deep-thought:architect`** — new skill in `plugins/deep-thought/skills/architect/`

  Learns from `deep-thought:plan` but outputs design, not tasks:

  **Standalone behavior:** "What are you building?" → interactive exploration → stories + architecture doc
  **With hog context:** reads brainstorm output, produces stories + arch doc at specified paths

  SKILL.md structure:
  - Phase 1: Read brainstorm output (if `$BRAINSTORM_PATH` set) or ask the user
  - Phase 2: Research codebase for existing patterns (via Agent subagent)
  - Phase 3: Write user stories (`docs/stories/{slug}.md`) with STORY-NNN IDs,
    acceptance criteria, edge cases, [INTEGRATION] tags
  - Phase 4: Write architecture doc (`docs/stories/{slug}.architecture.md`) with:
    Requirements (FR/NFR), ADRs, Dependencies, Integration Pattern, File Structure,
    External Services, Security Considerations
  - Phase 5: Confirm with user (if interactive) or complete (if autonomous)

  Supporting files:
  - `architecture-template.md` — the architecture doc template
  - `adr-format.md` — ADR structure reference
  - `story-format.md` — story format with examples

- [ ] 1.2 **`marvin:scaffold`** — new skill in `plugins/marvin/skills/scaffold/`

  **Standalone:** "What project are you setting up?" → creates dirs, configs, installs deps
  **With hog:** reads `$ARCH_PATH`, creates structure from architecture doc

  SKILL.md structure:
  - Step 1: Read architecture doc (from `$ARCH_PATH` or ask)
  - Step 2: Assess current project state (greenfield vs brownfield)
  - Step 3: For greenfield — create dirs, package manifest, install deps, set up
    linting/formatting/test framework configs
  - Step 4: For brownfield — verify paths, note discrepancies
  - Step 5: Write context file (`{slug}.context.md`) for downstream consumers
  - NEVER create source files or test files

  Stop hook:
  ```yaml
  hooks:
    Stop:
      - hooks:
          - type: command
            command: "find . -name '*.ts' -newer /tmp/scaffold-start -not -name '*.config.*' -not -name '*.d.ts' | head -1 && echo '{\"ok\":false,\"reason\":\"Created source files — scaffold must only create configs\"}' || echo '{\"ok\":true}'"
  ```

- [ ] 1.3 **`marvin:test-writer`** — new skill in `plugins/marvin/skills/test-writer/`

  **Standalone:** "What should I test?" → asks for stories or feature description → writes tests
  **With hog:** reads `$STORIES_PATH` + `$ARCH_PATH`, writes failing tests

  SKILL.md structure:
  - Step 1: Read stories (from `$STORIES_PATH` or ask/search)
  - Step 2: Read architecture doc (from `$ARCH_PATH` or ask/search)
  - Step 3: Write behavioral tests (verify WHAT — acceptance criteria)
  - Step 4: Write architectural conformance tests (verify HOW — each dependency
    from arch doc is imported and used, integration patterns are followed)
  - Step 5: Run tests — ALL must fail (RED state)
  - Executable self-check with feedback loop (fix and retry up to 3x)

  Supporting files:
  - `anti-patterns.md` — weak test patterns that pass with stubs
  - `conformance-patterns.md` — how to write tests that verify architecture compliance

  Stop hook:
  ```yaml
  hooks:
    Stop:
      - hooks:
          - type: agent
            prompt: "Run the test suite. ALL tests must fail. If any pass, return {\"ok\":false,\"reason\":\"Tests should not pass yet\"}."
            timeout: 120
  ```

- [ ] 1.4 **`marvin:redteam`** — new skill in `plugins/marvin/skills/redteam/`

  **Standalone:** "Review this code adversarially" → finds weaknesses, writes failing tests
  **With hog:** reads `$ARCH_PATH`, verifies architectural conformance + security + stubs

  SKILL.md structure:
  - Priority 1: Architecture conformance — grep source for each dependency in arch doc
  - Priority 2: Stub/scaffolding detection — hardcoded returns, regex classifiers, fakes
  - Priority 3: Security and edge cases
  - Priority 4: Story completeness check
  - Writes NEW failing tests for every issue found
  - Never modifies implementation — only exposes problems

  Supporting files:
  - `attack-categories.md` — security + architecture audit checklist
  - `stub-patterns.md` — common stub patterns and grep commands to detect them

  Stop hook:
  ```yaml
  hooks:
    Stop:
      - hooks:
          - type: agent
            prompt: "Read the architecture doc. For each dependency, grep source files for its import. If any dependency is missing from source, return {\"ok\":false,\"reason\":\"Missed architecture violation\"}."
            timeout: 120
  ```

### Tasks — Enhance Existing Skills

- [ ] 1.5 **Enhance `marvin:work`** — add architecture-aware mode:

  Add a section to the existing SKILL.md:
  ```markdown
  ## Architecture-Aware Mode (when $ARCH_PATH is set)

  If an architecture doc is available, it is BINDING:
  - Read `## Dependencies` — install and import EVERY listed package
  - Read `## Integration Pattern` — follow it exactly
  - Read `## File Structure` — create files at specified paths
  - A regex classifier instead of an LLM call is a STUB
  - A hardcoded response instead of a real API call is a STUB
  ```

  Add Stop hook:
  ```yaml
  hooks:
    Stop:
      - hooks:
          - type: agent
            prompt: "If $ARCH_PATH is set, read it. For each dependency, grep source for import. If missing, return {\"ok\":false,\"reason\":\"dependency X not imported — stub\"}. Also run the test suite — all must pass."
            timeout: 180
  ```

- [ ] 1.6 **Enhance `marvin:review`** — add merge readiness mode:

  Add a section to the existing SKILL.md:
  ```markdown
  ## Merge Readiness Mode (when $MERGE_CHECK is set)

  In addition to code review:
  1. Run the FULL test suite — all must pass
  2. Run the project linter — no violations
  3. Run security scanner if available
  4. Verify architecture doc dependencies are all imported in source
  5. Verdict: MERGE or BLOCK (with specific reasons)

  Do NOT execute the merge. Report only — the orchestrator handles merging.
  ```

### Tasks — Plugin Hooks

- [ ] 1.7 **Add plugin hooks** at `plugins/marvin/hooks/hooks.json`:

  ```json
  {
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "Bash",
          "hooks": [
            {
              "type": "command",
              "if": "Bash(rm -rf *)",
              "command": "echo 'Blocked: destructive rm -rf' >&2; exit 2"
            },
            {
              "type": "command",
              "if": "Bash(git push --force*)",
              "command": "echo 'Blocked: force push' >&2; exit 2"
            },
            {
              "type": "command",
              "if": "Bash(git push -f*)",
              "command": "echo 'Blocked: force push' >&2; exit 2"
            },
            {
              "type": "command",
              "if": "Bash(sudo *)",
              "command": "echo 'Blocked: sudo' >&2; exit 2"
            }
          ]
        }
      ],
      "PostToolUse": [
        {
          "matcher": "Edit|Write",
          "hooks": [
            {
              "type": "command",
              "if": "Edit(*.ts)|Write(*.ts)|Edit(*.tsx)|Write(*.tsx)",
              "command": "npx biome check --no-errors-on-unmatched \"${CLAUDE_TOOL_INPUT_FILE_PATH}\" 2>/dev/null || true"
            }
          ]
        }
      ]
    }
  }
  ```

### Exit Criteria — Phase 1

- [ ] 4 new skills exist and work standalone (without hog)
- [ ] 2 enhanced skills work in both standalone and pipeline modes
- [ ] Plugin hooks block destructive commands and auto-lint file writes
- [ ] Each skill with a Stop hook cannot complete without verification passing

---

## Phase 2: Wire hog Conductor to Skills

All work in this phase happens in the `hog` repo.

### Tasks

- [ ] 2.1 **Update conductor to invoke skills by name:**

  In `spawnForRole`, instead of passing the raw prompt from `roles.ts`:
  ```typescript
  // Map pipeline roles to toolkit skill names
  const ROLE_TO_SKILL: Record<PipelineRole, string> = {
    brainstorm: "deep-thought:brainstorm",
    stories: "deep-thought:architect",  // stories phase uses architect skill
    scaffold: "marvin:scaffold",
    test: "marvin:test-writer",
    impl: "marvin:work",
    redteam: "marvin:redteam",
    merge: "marvin:review",
  };
  ```

  Set env vars for pipeline context:
  ```typescript
  env: {
    STORIES_PATH: pipeline.storiesPath,
    ARCH_PATH: pipeline.architecturePath,
    CONTEXT_PATH: contextPath,
    FEATURE_ID: pipeline.featureId,
    MERGE_CHECK: role === "merge" ? "true" : undefined,
    BRAINSTORM_PATH: brainstormPath,
  }
  ```

- [ ] 2.2 **Add skill availability check:**

  Before spawning, check if the skill is installed:
  ```typescript
  // Try skill invocation first, fall back to bundled prompt
  const skillAvailable = checkSkillInstalled(skillName);
  if (skillAvailable) {
    prompt = `/${skillName}`;
  } else {
    prompt = FALLBACK_PROMPTS[role]; // current roles.ts content
  }
  ```

  This ensures hog works without the toolkit installed (degraded mode).

- [ ] 2.3 **Update feedback loops for skill-based agents:**

  The conductor's retry logic stays the same — it doesn't care whether the
  agent ran a skill or a raw prompt. The flow is:

  | Failure | Action | Max retries |
  |---------|--------|-------------|
  | Test coverage <75% | Re-invoke test-writer with retry context | 2 |
  | Tests fail after impl (GREEN) | Re-invoke work with retry context | 2 |
  | Redteam writes failing tests | Re-invoke work with redteam failures as context | 2 |
  | Merge review fails | Re-invoke work with review findings as context | 2 |
  | All retries exhausted | Human escalation via question queue | — |

- [ ] 2.4 **Simplify roles.ts to metadata-only:**

  ```typescript
  export const PIPELINE_ROLES: Record<PipelineRole, RoleConfig> = {
    brainstorm: {
      role: "brainstorm",
      label: "Brainstorm",
      skill: "deep-thought:brainstorm",
      scope: { canRead: [], canWrite: ["docs/stories/**"], forbidden: [] },
    },
    // ... etc
  };
  ```

  Remove the 800+ lines of prompt string constants. The intelligence lives
  in SKILL.md files in the toolkit.

- [ ] 2.5 **Keep fallback prompts bundled:**

  For users without the toolkit installed, bundle simplified versions of the
  skill content as fallback prompts. These are read from files, not string
  constants:
  ```
  src/engine/fallback-prompts/
  ├── brainstorm.md
  ├── architect.md
  ├── scaffold.md
  ├── test-writer.md
  ├── work.md
  ├── redteam.md
  └── review.md
  ```

### Exit Criteria — Phase 2

- [ ] hog invokes toolkit skills when available
- [ ] hog falls back to bundled prompts when toolkit not installed
- [ ] Feedback loops work identically with skills and fallback prompts
- [ ] roles.ts is metadata-only (no prompt strings)

---

## Phase 3: Merge Review → Impl Feedback Loop

### Tasks

- [ ] 3.1 **Add merge→impl retry loop in conductor:**

  When the merge review (marvin:review in merge-check mode) reports BLOCK:
  - If test failures → re-invoke `marvin:work` with the failure details
  - If lint violations → re-invoke `marvin:work` with the violations
  - Max 2 retries, then human escalation
  - Same pattern as redteam→impl loop

- [ ] 3.2 **Unify all retry loops:**

  All feedback loops follow the same pattern:
  ```typescript
  interface RetryLoop {
    trigger: "coverage-gate" | "green-gate" | "redteam-failures" | "merge-failures";
    retryRole: PipelineRole;  // always "impl" (or "test" for coverage)
    maxRetries: number;       // always 2
    escalation: "human";      // always human after max
  }
  ```

### Exit Criteria — Phase 3

- [ ] Merge check failures trigger impl retry (not human immediately)
- [ ] All retry loops use unified RetryLoop pattern
- [ ] Human escalation only after max retries exhausted

---

## Phase 4: Plugin Packaging and Distribution

### Tasks

- [ ] 4.1 **Update marvin plugin.json** with new skills and hooks
- [ ] 4.2 **Update deep-thought plugin.json** with architect skill
- [ ] 4.3 **Write marvin README** — what each skill does, how to use standalone,
  how hog orchestrates them
- [ ] 4.4 **Test end-to-end** — install toolkit, run pipeline, verify skills + hooks work
- [ ] 4.5 **Update hog README** — explain the relationship with heart-of-gold-toolkit

### Exit Criteria — Phase 4

- [ ] `claude plugin install heart-of-gold-toolkit` gives access to all pipeline skills
- [ ] Each skill works standalone via `/marvin:test-writer`, etc.
- [ ] hog pipeline uses skills when toolkit is installed
- [ ] Documentation explains both standalone and orchestrated usage

---

## Decision Rationale

### Why standalone skills, not hog-specific ones?

hog is ONE orchestration pattern. The skills encode methodology — TDD test writing,
architectural conformance, adversarial review. These are valuable without a pipeline.
A developer can `/marvin:test-writer` to write tests for their feature manually.
hog just automates the chaining.

### Why env vars for context passing?

Skills check `$STORIES_PATH` etc. If set (hog pipeline), they use it. If not
(standalone), they ask or search. This is the simplest integration contract —
no special API, no config files, just environment variables. Every shell and
every spawning mechanism supports them.

### Why keep fallback prompts in hog?

Not everyone will install the toolkit. hog should work out of the box. The fallback
prompts are simplified versions of the SKILL.md content — they lose the Stop hooks
and knowledge dirs but the pipeline still runs. This is graceful degradation.

### Why merge check retries impl instead of asking human?

If tests fail at merge time, the code is wrong — not the process. The impl agent
should try to fix it. The human should only see problems that the impl agent can't
solve after 2 attempts. This is consistent with how redteam→impl works.

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| Skills can read env vars in `!`command`` | Verified | Research confirms shell preprocessing |
| Stop hooks work in headless mode (-p) | Unverified | Need to test — PreToolUse works, Stop hooks may differ |
| Plugin hooks load when any plugin skill is invoked | Verified | Research confirms |
| `claude -p "/marvin:test-writer"` invokes the skill | Unverified | Need to test slash command via -p flag |
| Env vars propagate through spawn() to the skill | Verified | spawn() already passes env |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Skill invocation via `-p "/skill"` doesn't work | Medium | High | Fallback: read SKILL.md, pass as raw prompt |
| Stop hooks add 1-3 min per phase | Medium | Low | Quality is worth the time |
| Two repos to maintain | High | Medium | Skills are source of truth. hog is thin orchestrator. |
| Users confused by standalone vs pipeline mode | Medium | Low | README explains both. Skills auto-detect mode via env vars. |

## References

- [Brainstorm](../brainstorms/2026-03-29-skills-first-pipeline-brainstorm.md)
- [Previous plan (replaced)](2026-03-29-feat-skills-first-pipeline-plan.md)
- [Prompt overhaul plan](2026-03-29-refactor-pipeline-prompt-overhaul-plan.md)
