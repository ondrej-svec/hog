---
title: "feat: Pipeline interaction model — brainstorm-first + quick picks"
type: plan
date: 2026-03-24
status: complete
brainstorm: docs/brainstorms/2026-03-24-pipeline-interaction-model-brainstorm.md
confidence: high
---

# Pipeline Interaction Model — Brainstorm-First + Quick Picks

**One-line summary:** Every pipeline starts with an interactive Claude Code brainstorm session (tmux). The human refines the spec. `bd close` signals completion. Then autonomous work begins. Quick picks only for mid-pipeline operational triage.

## Problem Statement

The pipeline treats the human as an answering machine (pick 1-9). The human's real value is creative thinking. The pipeline needs brainstorming as its first phase — an interactive Claude Code session where the human and AI refine the spec together — then autonomous execution.

## Proposed Solution

Change the pipeline DAG from 5 phases to 6:

```
OLD: stories → tests → impl → redteam → merge
NEW: brainstorm → stories → tests → impl → redteam → merge
```

The brainstorm phase is interactive (Claude Code in tmux). All other phases are autonomous. The conductor opens the brainstorm session, waits for the bead to close, then proceeds.

The cockpit shows "Press Z to brainstorm" instead of quiz-style decisions for the brainstorm phase.

---

## Implementation Tasks

### Phase 1: Add brainstorm to the DAG

- [x] **1.1 Update `createFeatureDAG` to include brainstorm bead**
  Add a brainstorm bead as the first node. It blocks the stories bead.
  New DAG: brainstorm → stories → tests → impl → redteam → merge (6 beads).
  Update `Pipeline.beadIds` type to include `brainstorm`.

- [x] **1.2 Add brainstorm role to `roles.ts`**
  New `PipelineRole`: `"brainstorm"`. Prompt template instructs:
  - Brainstorm with the human to refine the spec
  - Write user stories to `tests/stories/{slug}.md`
  - When done: `bd close {bead-id} --reason "Brainstorm complete"`

- [x] **1.3 Add brainstorm CLAUDE.md to `role-context.ts`**
  The brainstorm session's CLAUDE.md includes:
  - The user's rough feature description
  - The bead ID to close when done
  - Instructions to write stories file and close the bead
  - Encouragement to ask the human questions, explore approaches

- [x] **1.4 Update `beadToRole` in `roles.ts`**
  Add `[hog:brainstorm]` title prefix → `"brainstorm"` role mapping.

### Phase 2: Interactive launch for brainstorm phase

- [x] **2.1 Update conductor `spawnForRole` to detect brainstorm phase**
  When the ready bead's role is `"brainstorm"`:
  - Don't spawn a background agent
  - Instead, call `launchClaude()` to open an interactive tmux session
  - Pass the brainstorm prompt + bead ID as context
  - Record the session as `mode: "interactive"` in enrichment

- [x] **2.2 Write brainstorm-specific prompt builder**
  Build the prompt that pre-loads the Claude Code session:
  ```
  You're brainstorming a new feature with the human.

  Feature idea: {description}
  Pipeline: {featureId}
  Bead to close when done: {beadId}

  Your job:
  1. Discuss the feature with the human
  2. Refine it into clear user stories with acceptance criteria
  3. Write stories to tests/stories/{slug}.md
  4. When satisfied: bd close {beadId} --reason "Brainstorm complete"
  ```

- [x] **2.3 Update `writeRoleClaudeMd` for brainstorm role**
  The brainstorm CLAUDE.md is permissive (can read anything, discuss anything)
  but includes the completion instruction (`bd close`).

### Phase 3: Cockpit UX for brainstorm phase

- [x] **3.1 Show "Press Z to brainstorm" for brainstorm bead**
  When the pipeline's active phase is `"brainstorm"` and no agent is running:
  - Focus panel shows: "Ready to brainstorm: {title}"
  - "Press Z to start the brainstorm session"
  - NOT "⚠ DECISION NEEDED" (that's for quick picks only)

- [x] **3.2 Z key opens brainstorm session from Pipeline View**
  When selected pipeline has brainstorm as active phase:
  - Z opens tmux session via `launchClaude()` with brainstorm prompt
  - Zen mode activates (tmux split showing the session)
  - Cockpit shows "Brainstorm in progress..." while session is open

- [x] **3.3 Detect brainstorm bead closure and advance pipeline**
  The conductor's tick loop already handles this via `bd ready`.
  When the brainstorm bead is closed, the stories bead becomes ready.
  The conductor spawns the stories agent automatically.
  Cockpit updates to show progress.

- [x] **3.4 Show re-attach option if brainstorm session exists**
  If the user closes the cockpit and reopens while a brainstorm tmux session
  is still running, show: "Brainstorm in progress — press Z to re-attach"

### Phase 4: Update hint bar and status

- [x] **4.1 Update hint bar for brainstorm state**
  When pipeline has active brainstorm phase:
  `Z:brainstorm  j/k:navigate  P:new pipeline  Tab:issues  q:quit`

- [x] **4.2 Update status bar with brainstorm state**
  Show "1 pipeline (brainstorming)" or "1 pipeline (autonomous)" to distinguish.

### Phase 5: Tests

- [x] **5.1 Test: brainstorm bead is created as first DAG node**
  Verify the DAG has 6 beads with brainstorm blocking stories.

- [x] **5.2 Test: brainstorm role detected from title prefix**
  `[hog:brainstorm]` → `"brainstorm"` role.

- [x] **5.3 Test: conductor opens interactive session for brainstorm**
  When brainstorm bead is ready, conductor calls `launchClaude()` not `spawnBackgroundAgent()`.

- [x] **5.4 Test: pipeline advances after brainstorm bead closed**
  Close the brainstorm bead → stories bead becomes ready → agent spawns.

- [x] **5.5 Test: cockpit shows "Press Z to brainstorm" not "DECISION NEEDED"**
  E2E test: pipeline with brainstorm as active phase renders correct prompt.

- [x] **5.6 Test: quick picks still work for operational questions**
  Mid-pipeline agent failure → retry/skip/stop → number keys.

---

## Acceptance Criteria

1. `P` → type idea → Enter → Claude Code tmux session opens for brainstorming
2. Human brainstorms with Claude, writes stories, runs `bd close`
3. Pipeline automatically advances to autonomous work (tests → impl → etc.)
4. Cockpit shows "Press Z to brainstorm" for the brainstorm phase
5. Quick picks (1-9) still work for mid-pipeline operational questions
6. Brainstorm session can be re-attached after closing the cockpit
7. DAG has 6 phases: brainstorm → stories → tests → impl → redteam → merge

## Decision Rationale

### Why add brainstorm to the DAG instead of making it a pre-pipeline step?

If brainstorm is part of the DAG, it uses the same completion mechanism (bead close) as all other phases. No special cases. The conductor handles it uniformly. Pipeline state is consistent — you can see "brainstorm ✓ → stories ◐ → ..." in the DAG visualization.

### Why open tmux immediately on P instead of showing the pipeline list first?

The user's intent when pressing P is "I want to build something." The creative session IS the first step. Showing an empty pipeline list before the brainstorm adds a useless intermediate state.

Flow: P → type idea → Enter → tmux session opens → brainstorm → bd close → autonomous work begins.

## Risk Analysis

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| User forgets to `bd close` | Pipeline stuck forever | Medium | Cockpit shows "brainstorm open for Xh" nudge after 2h |
| Tmux not available | Brainstorm can't open | Low | Error message: "Tmux required for brainstorming. Install tmux." |
| Brainstorm session crashes | Bead stays open | Low | User can re-launch Z, or manually `bd close` from terminal |
| Stories file not written | Tests phase has no input | Medium | Stories agent checks for file, creates placeholder if missing |

## References

- [Brainstorm: Pipeline Interaction Model](../brainstorms/2026-03-24-pipeline-interaction-model-brainstorm.md)
- [Cockpit v2 Plan](2026-03-23-feat-cockpit-v2-plan.md) — bug fixes and UX improvements
- [launch-claude.ts](../../src/board/launch-claude.ts) — tmux launch infrastructure
- [role-context.ts](../../src/engine/role-context.ts) — per-role CLAUDE.md generation
- [conductor.ts](../../src/engine/conductor.ts) — pipeline orchestration
