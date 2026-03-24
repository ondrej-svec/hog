---
title: "Pipeline Interaction Model — Creative Sessions + Quick Picks"
type: brainstorm
date: 2026-03-24
participants: [ondrejsvec, claude]
related:
  - docs/brainstorms/2026-03-21-hog-agent-development-platform-brainstorm.md
  - docs/brainstorms/2026-03-01-workflow-conductor-brainstorm.md
  - docs/plans/2026-03-23-feat-cockpit-v2-plan.md
---

# Pipeline Interaction Model — Creative Sessions + Quick Picks

## Problem Statement

The current pipeline treats the human as an answering machine — "pick 1, 2, or 3." But the real value of the human is creative thinking: brainstorming, refining specs, making judgment calls. The pipeline needs to know WHEN it needs a quick answer vs WHEN it needs a real conversation, and provide the right interaction for each.

The original brainstorm (March 1) already stated: "Brainstorm phase: interactive only — this IS the human-AI collaboration, the creative joy." We built the pipeline but forgot the joy.

## Context

- The cockpit (Pipeline View) exists with status bars, DAG visualization, and number key quick-picks
- Claude Code launch via tmux is fully built (`launchClaude()` in `launch-claude.ts`)
- Zen mode (tmux split) exists and can show a Claude Code session alongside the cockpit
- Beads DAG manages phase ordering — beads are closed to signal completion
- The question queue supports `source: "clarity-analyst" | "stuck-agent" | "conductor"`
- The Conductor creates 5 beads: stories → tests → impl → redteam → merge

## Chosen Approach

### Two-Tier Interaction Model

**Tier 1: Creative Session (tmux)** — Every pipeline starts here
- User presses P → types rough idea → Enter
- Pipeline opens a Claude Code brainstorm session in tmux
- Pre-loaded with: the rough idea, project context, pipeline bead ID
- Human + Claude brainstorm together (this IS the creative work)
- Session produces: refined spec, user stories, acceptance criteria
- Completion signal: Claude Code closes the brainstorm bead via `bd close <id>`
- Pipeline reads the output and begins autonomous work

**Tier 2: Quick Pick (number keys)** — Only for mid-pipeline operational questions
- Agent fails repeatedly → "Retry, skip, or stop?" → press 1/2/3
- These are NOT creative decisions — they're operational triage
- Shown inline in the cockpit, answered with number keys

### Brainstorm as First Pipeline Phase

The brainstorm isn't a separate step — it's the first phase. The pipeline flow becomes:

```
Human presses P → types rough idea
  │
  ▼
BRAINSTORM (interactive — tmux Claude Code session)
  Human + Claude refine the spec together
  Output: user stories in tests/stories/{slug}.md
  Signal: bd close <brainstorm-bead> → unblocks next phase
  │
  ▼
TESTS (autonomous — background agent)
  Reads stories from tests/stories/{slug}.md
  Writes failing tests
  │
  ▼
IMPLEMENT (autonomous — background agent)
  Sees only the tests, not the spec
  │
  ▼
REDTEAM (autonomous — background agent)
  Adversarial review
  │
  ▼
MERGE (autonomous — Refinery)
  Rebase, test, quality gates, merge
```

### Handoff via Beads

The brainstorm session signals completion by closing its bead:
```
bd close <brainstorm-bead-id> --reason "Brainstorm complete"
```

This is the same mechanism ALL phases use. The conductor's tick loop detects the closed bead, the tests bead becomes unblocked via the DAG, and autonomous work begins.

The brainstorm session's CLAUDE.md includes:
```
When you and the human are satisfied with the spec:
1. Write user stories to tests/stories/{slug}.md
2. Run: bd close {bead-id} --reason "Brainstorm complete"
This signals the pipeline to begin autonomous work.
```

## Why This Approach

### Why tmux session, not inline chat in the cockpit?

Building a chat interface inside Ink will always be inferior to actual Claude Code. Claude Code has file access, tool use, context management, and a proven interaction model. The cockpit is the LAUNCHPAD — Claude Code is the CREATIVE SPACE. Don't rebuild what already exists.

**Rejected:** Inline chat in the cockpit — complex to build, always worse than Claude Code, requires maintaining a parallel chat UX.

### Why every pipeline starts with brainstorm, not just unclear ones?

The Clarity Analyst (LLM classifying spec clarity) adds latency and can misjudge. Starting every pipeline with a brainstorm session is simpler, more predictable, and ensures the human is always creatively involved at the start. The brainstorm can be short (2 minutes for a clear spec) or long (30 minutes for a complex feature). The human controls the pace.

**Rejected:** Clarity Analyst classification — adds complexity, latency, and false confidence. The human IS the clarity analyst.

### Why Beads for handoff, not file watching?

Beads provides a strict, structured completion signal. File watching is fragile (what file? what format? what if the file exists but isn't ready?). `bd close` is an explicit, intentional signal that the brainstorm is done. It uses the same mechanism as all other pipeline phases — no special cases.

**Rejected:** File-based handoff — fragile, no explicit completion signal.
**Rejected:** Session exit = done — user might close the session to take a break, not because they're done.
**Rejected:** Explicit cockpit key — requires context switching back to the cockpit just to press a button.

### Why quick picks only for operational questions?

Creative decisions (what to build, how to approach it) need conversation. Operational decisions (retry/skip/stop) need speed. Conflating the two leads to either: (a) creative decisions answered as quizzes (bad), or (b) operational decisions requiring a full brainstorm session (wasteful).

## Key Design Decisions

### Q1: Interaction tiers — RESOLVED
**Decision:** Two tiers. Tier 1 (creative session via tmux) for spec refinement. Tier 2 (quick pick via number keys) for operational triage only.
**Rationale:** The human's creative value is in brainstorming, not quiz-answering. Claude Code is a better creative environment than any TUI chat.
**Alternatives considered:** Three tiers with inline text input (middle tier); single tier with only tmux sessions; Clarity Analyst auto-classification.

### Q2: When to use each tier — RESOLVED
**Decision:** Every pipeline starts with a creative session (brainstorm phase). Quick picks only for mid-pipeline operational questions (agent failures, timeouts).
**Rationale:** Simpler, more predictable, ensures human creative involvement. Short brainstorms for clear specs, long for complex ones.
**Alternatives considered:** LLM-based Clarity Analyst decides; human chooses per-decision.

### Q3: Completion signal — RESOLVED
**Decision:** Beads. The brainstorm session closes its bead via `bd close`. Same mechanism as all pipeline phases.
**Rationale:** Strict, explicit, consistent with the DAG-based pipeline model. No file watching, no special cases.
**Alternatives considered:** File watching; session exit; explicit cockpit key.

### Q4: Brainstorm session context — RESOLVED
**Decision:** Pre-loaded with: user's rough idea, project CLAUDE.md, pipeline bead ID, and a role-specific CLAUDE.md that includes `bd close` instructions.
**Rationale:** The session needs enough context to be immediately productive but not so much that it's overwhelming.

## Open Questions

1. **What if the user doesn't close the bead?** — The pipeline stays blocked forever. Should there be a timeout? A nudge? The cockpit could show "Brainstorm session open for 2h — still working?"
2. **Can the brainstorm session create sub-beads?** — If the brainstorm discovers the feature is actually 3 sub-features, can the session create child beads that each get their own pipeline?
3. **What happens if the user restarts the board during a brainstorm?** — The bead stays open, the session may still be running in tmux. The cockpit should detect this and offer to re-attach.

## Out of Scope

- Inline chat in the cockpit (rejected — always worse than Claude Code)
- Clarity Analyst LLM (rejected — the human IS the clarity analyst)
- Multi-party brainstorming (multiple humans in one session)

## Next Steps

- `/plan` to create implementation plan for the two-tier interaction model
- Update the Conductor to create a brainstorm bead as the first phase
- Update `role-context.ts` to generate brainstorm-phase CLAUDE.md with `bd close` instructions
- Update the cockpit to show "Press Z to brainstorm" instead of just "⚠ DECISION NEEDED" for the brainstorm phase
