---
title: "Skills-First Pipeline — hog v3 architecture"
type: brainstorm
date: 2026-03-29
participants: [Ondrej, Claude]
related:
  - docs/plans/2026-03-28-feat-heart-of-gold-v2.1-master-plan.md
  - docs/plans/2026-03-29-refactor-pipeline-prompt-overhaul-plan.md
  - docs/audits/2026-03-28-hog-grand-audit.md
---

# Skills-First Pipeline — hog v3

## Problem Statement

hog's pipeline prompts are hand-crafted TypeScript string constants in `roles.ts` (~800 lines).
They're hard to edit, impossible to test independently, don't support knowledge directories,
can't enforce quality structurally, and can't be distributed to other teams.

Meanwhile, Claude Code has a native skills system that provides all of this — and more:
Stop hooks that prevent agents from completing without verification, dynamic context injection,
per-skill tool restrictions, and plugin packaging for distribution.

**We're building a worse version of what Claude Code already offers.**

## Context

The v2.1 prompt overhaul added executable self-checks and feedback loops — but these are still
*instructions in a prompt*. The agent self-attests. The impl agent wrote a regex classifier
instead of using the AI SDK and passed its own self-check.

Claude Code's hooks system provides **structural** enforcement: a `type: agent` Stop hook spawns
an independent verifier that runs tests, greps for stub patterns, and returns ok/not-ok. The
agent literally cannot finish its turn if the verifier says no. This is the difference between
asking someone to check their own work and having a building inspector.

## Chosen Approach

### Each pipeline phase becomes a Heart of Gold toolkit skill

The skills live in the `heart-of-gold-toolkit` repository as a plugin (likely the `marvin` plugin —
quality pipeline). hog CLI becomes a thin conductor that:

1. Manages the Beads DAG (bead lifecycle, dependencies, polling)
2. Sets environment variables (`STORIES_PATH`, `ARCH_PATH`, `FEATURE_ID`)
3. Spawns agents via `claude -p "/marvin:test-writer $STORIES_PATH"` (or equivalent)
4. Monitors agent progress via stream-json
5. Routes completions to the Refinery merge queue

The intelligence moves OUT of hog into distributable, testable, independently-evolving skills.

### Skill structure (per phase)

```
heart-of-gold-toolkit/plugins/marvin/skills/
├── hog-brainstorm/
│   ├── SKILL.md                # brainstorm role instructions
│   ├── methodology.md          # ICF, FLOW, coaching methodology (loaded on demand)
│   ├── architecture-template.md # template for the architecture doc output
│   └── adr-template.md         # ADR format reference
├── hog-stories/
│   └── SKILL.md
├── hog-scaffold/
│   ├── SKILL.md
│   └── tooling-checklist.md    # linter/formatter/test-framework setup guide
├── hog-test/
│   ├── SKILL.md
│   ├── anti-patterns.md        # what makes a weak test (loaded on demand)
│   └── conformance-patterns.md # how to write architectural conformance tests
├── hog-impl/
│   ├── SKILL.md
│   └── stub-patterns.md        # what stubs look like, grep patterns to detect
├── hog-redteam/
│   ├── SKILL.md
│   └── attack-categories.md    # security + architectural audit checklist
└── hog-merge/
    └── SKILL.md
```

### Stop hooks for structural quality enforcement

Each skill gets a Stop hook that independently verifies the work:

**hog-test Stop hook:**
```yaml
hooks:
  Stop:
    - hooks:
        - type: agent
          prompt: |
            Verify the test writer's work:
            1. Run the test suite — ALL tests must fail (RED state)
            2. grep -r 'STORY-' in test files — every test references a story
            3. Read the architecture doc's ## Dependencies section
            4. For each dependency, grep test files for an import from that package
            If ANY check fails, return {"ok": false, "reason": "what failed"}
          timeout: 120
```

**hog-impl Stop hook:**
```yaml
hooks:
  Stop:
    - hooks:
        - type: agent
          prompt: |
            Verify the implementer's work:
            1. Run the FULL test suite — ALL must pass
            2. Read the architecture doc's ## Dependencies section
            3. For each dependency, grep source files for an import
            4. If any dependency is NOT imported, return failure — it's a stub
            5. grep for stub patterns (hardcoded, TODO, FIXME, placeholder)
            If ANY check fails, return {"ok": false, "reason": "what failed"}
          timeout: 180
```

**hog-redteam Stop hook:**
```yaml
hooks:
  Stop:
    - hooks:
        - type: agent
          prompt: |
            Verify the redteam's work:
            1. For each dependency in architecture doc, grep source for import
            2. If any dependency is missing, the redteam missed an architecture violation
            3. Run ALL tests — new redteam tests should FAIL
            If checks reveal missed violations, return {"ok": false, "reason": "..."}
          timeout: 120
```

### PostToolUse hooks for real-time quality

```yaml
# In plugin hooks/hooks.json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "if": "Edit(*.ts)|Write(*.ts)|Edit(*.tsx)|Write(*.tsx)",
            "command": "npx biome check --no-errors-on-unmatched ${CLAUDE_TOOL_INPUT_FILE_PATH}"
          }
        ]
      }
    ]
  }
}
```

Every file write gets auto-linted. The agent sees the feedback and fixes violations in its next turn.

### Dynamic context injection replaces template variables

Instead of `{storiesPath}` interpolation in TypeScript:

```yaml
# hog-test/SKILL.md
---
name: hog-test
---
## Your inputs
- Stories: !`cat "$STORIES_PATH"`
- Architecture doc: !`cat "$ARCH_PATH"`
- Project context: !`cat "$CONTEXT_PATH" 2>/dev/null || echo "No context file yet"`
```

The conductor sets env vars before spawning:

```typescript
const child = spawn("claude", ["-p", "/marvin:hog-test"], {
  env: {
    ...process.env,
    STORIES_PATH: pipeline.storiesPath,
    ARCH_PATH: pipeline.architecturePath,
    CONTEXT_PATH: `docs/stories/${slug}.context.md`,
    FEATURE_ID: pipeline.featureId,
  },
});
```

### Plugin distribution

```
heart-of-gold-toolkit/plugins/marvin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── hog-brainstorm/SKILL.md
│   ├── hog-test/SKILL.md
│   └── ...
├── hooks/
│   └── hooks.json          # PostToolUse auto-linting, safety deny rules
├── agents/
│   ├── quality-verifier.md  # shared Stop hook verifier agent
│   └── architecture-auditor.md
└── README.md
```

Any Claude Code user can:
```bash
claude plugin install heart-of-gold-toolkit
# Now has access to /marvin:hog-test, /marvin:hog-impl, etc.
```

## Why This Approach

**What it optimizes for:**
- Structural quality enforcement (Stop hooks, not self-attestation)
- Distribution (plugin, not repo clone)
- Editability (SKILL.md files, not TypeScript string arrays)
- Separation of concerns (hog = orchestrator, skills = intelligence)
- Knowledge management (supporting files loaded on demand, not inline)

**What it costs:**
- Migration effort from roles.ts to SKILL.md files
- Dependency on Claude Code's skill/hook system (vendor coupling)
- Testing skills requires running Claude (can't unit test a SKILL.md)

**Alternatives rejected:**
- "Keep improving roles.ts prompts" — diminishing returns on string constants.
  Skills are structurally richer.
- "Build our own hook system" — Claude Code already has one. Don't reinvent.
- "Use MCP for quality verification" — MCP is for tool exposure, not workflow enforcement.
  Hooks are the right abstraction.

## Key Design Decisions

### Q1: Stop hooks vs. Refinery gates — RESOLVED
**Decision:** Use Stop hooks for per-agent verification AND keep the Refinery for merge-level gates.
**Rationale:** Stop hooks catch issues during the agent's session (while it can still fix them).
The Refinery catches issues at merge time (cross-agent concerns like rebase conflicts).
They're complementary layers, not alternatives.

### Q2: Plugin naming — RESOLVED
**Decision:** Skills live in the `marvin` plugin (quality/review), not a separate `hog` plugin.
**Rationale:** Marvin is the quality inspector in the H2G2 universe. The pipeline IS quality
enforcement. And the marvin plugin already exists as a stub in heart-of-gold-toolkit.

### Q3: Conductor stays in TypeScript — RESOLVED
**Decision:** The conductor, Beads client, Refinery, and daemon remain TypeScript in the hog repo.
**Rationale:** These are orchestration infrastructure — DAG state machines, Unix sockets,
process management. Skills are behavioral instructions for agents, not infrastructure.

### Q4: How does the conductor invoke skills? — RESOLVED
**Decision:** `claude -p "/marvin:hog-test" --output-format stream-json` with env vars.
**Rationale:** Skills are invoked as slash commands. The conductor sets context via env vars.
The `--output-format stream-json` flag continues to work for progress monitoring.

## Open Questions

1. **Can `claude -p "/skill-name"` work in non-interactive mode?** — needs verification.
   If not, the skill content may need to be read and passed as the prompt text directly.

2. **How do Stop hook timeouts interact with pipeline retry logic?** — if a Stop hook
   causes 3 failed attempts, does Claude abort or keep going?

3. **Can we pass `$ARGUMENTS` to skills when spawning headless?** — e.g.,
   `claude -p "/marvin:hog-test docs/stories/quellis.md"` — does `$0` bind?

4. **Plugin installation in CI** — do pipeline agents need the plugin installed in their
   env, or does the project's `.claude/skills/` work if the plugin is installed at project level?

## Out of Scope

- Rewriting the Beads DAG system
- Rewriting the daemon/RPC architecture
- Rewriting the cockpit TUI
- Supporting non-Claude agents (worker adapter stays as-is)

## Next Steps

- `/plan` to create a phased migration plan
- Phase 1: Extract role prompts from roles.ts into SKILL.md files in the toolkit
- Phase 2: Add Stop hooks to test/impl/redteam skills
- Phase 3: Replace template interpolation with dynamic context injection
- Phase 4: Package as marvin plugin, update hog conductor to invoke via skill names
