---
title: "feat: Board cockpit redesign — pipeline-first TUI"
type: plan
date: 2026-03-23
status: approved
brainstorm: docs/brainstorms/2026-03-21-hog-agent-development-platform-brainstorm.md
confidence: high
---

# Board Cockpit Redesign — Pipeline-First TUI

**One-line summary:** Redesign the hog board from an issue browser into a pipeline cockpit where decisions are the hero, agents are center stage, and the board actively pushes you away when there's nothing to do.

## Problem Statement

The board is built around **browsing issues by repo and status group**. In the new agent development platform, the primary activity is **orchestrating pipelines** — starting work, monitoring agents, resolving decisions, reviewing merges. The board currently gives agents 2 rows at the bottom of the screen. That's backwards — agents doing the work should be center stage.

## Proposed Solution

### Core Principle: Decisions Are the Hero

The board tells one story: **"Your agents are building. Here's what they need from you."** Everything in the Pipeline View serves this narrative:
- Pending decisions dominate the screen when they exist
- When nothing needs attention, the board says "All clear — come back in 20 minutes"
- The first-time empty state is an invitation: "What do you want to build?"

### Information Hierarchy (Flipped)

```
OLD: Repos → Statuses → Issues → (agents hidden at bottom)
NEW: Decisions → Pipelines → Agents → Issues (as context)
```

### Single View with Progressive Disclosure (Adam Grant)

Instead of Tab switching between Pipeline and Issues views (which causes attention residue), the board uses **progressive disclosure within one view**:

- **Top level:** Pipelines with progress bars (Yegge's insight — humans read progress bars faster than DAGs)
- **Drill into pipeline:** DAG visualization, agent status, decisions, decision log
- **Drill into phase:** Related issues, agent diff summary, test results
- Issues View accessible via `i` key as an escape hatch, not a co-equal view

### Layout: Pipeline Cockpit

```
┌─────────────────────────────────────────────────────────────┐
│ HOG — 3 pipelines · 5 agents · ⚠ 2 decisions · queue: 1   │
├──────────────────────┬──────────────────────────────────────┤
│ PIPELINES            │ FOCUS                                │
│                      │                                      │
│ ▶ Add user auth      │ ⚠ DECISION NEEDED                   │
│   ████░░░░░░  40%    │                                      │
│   ◐ tests 3m         │ Pipeline: Add user auth              │
│                      │ Phase: stories                       │
│   Rate limiting      │                                      │
│   ██████████ done ✓  │ Q: OAuth providers or password?      │
│                      │ Recommended: OAuth (industry std)    │
│   Fix login bug      │                                      │
│   ░░░░░░░░░░ waiting │ [1] OAuth  [2] Password  [3] Both   │
│                      │                                      │
│ ── Merge Queue ──    │ Context:                             │
│ ◐ rebasing auth      │ User stories mention SSO and         │
│ ○ pending rate       │ enterprise customers...              │
│                      │                                      │
├──────────────────────┤ ── Decision Log ──                   │
│ AGENTS (5)           │ 09:14 stories agent spawned          │
│ ◐ stories  auth  3m  │ 09:12 pipeline started               │
│ ◐ tests    rate  1m  │ 09:10 DAG created (5 beads)          │
│ ✓ stories  rate  ✓   │                                      │
│ ◐ impl     rate 12m  │                                      │
│ ✓ stories  login ✓   │                                      │
├──────────────────────┴──────────────────────────────────────┤
│ 3 pipelines · 5 agents · ⚠ 2 decisions · queue: 1 · 12s   │
└─────────────────────────────────────────────────────────────┘
```

**Left column:**
- **Pipelines section:** Progress bars + one-line status per pipeline (Yegge: bars > DAGs in list)
- **Agents section:** All active agents across all pipelines, sorted by activity
- **Merge Queue:** Current processing + pending

**Right panel (FOCUS):** Shows the most important thing (Cal Newport):
- If decisions pending → decision with context, recommendation, options (Dario: classified by severity)
- If no decisions → selected pipeline's DAG detail, agent output preview, diff summary
- If no pipelines → "What do you want to build?" prompt

**Status Bar (persistent):** Always visible at bottom. Decisions count in RED when > 0.

### Decision Severity (Amodei)

Decisions are visually classified:

| Severity | Visual | Examples |
|----------|--------|----------|
| ⚠ Safety | Red + ⚠ | Auth approach, data access, secrets handling |
| ● Architecture | Yellow + ● | Database schema, public API shape, major patterns |
| ○ Preference | Dim + ○ | Code style, file organization, naming |

Safety decisions get the biggest visual treatment. Preference decisions can be auto-resolved with a default after a timeout.

### Empty State (Seth Godin)

First time opening the board with no pipelines:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              What do you want to build?                     │
│                                                             │
│   Type a feature description to start a pipeline:           │
│   ┌───────────────────────────────────────────────┐         │
│   │ _                                             │         │
│   └───────────────────────────────────────────────┘         │
│                                                             │
│   or press [i] to browse issues                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### All Clear State (Cal Newport)

When all pipelines are running with no decisions:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ✓ All pipelines running. Nothing needs your attention.    │
│                                                             │
│   Estimated next decision: ~8 minutes                       │
│   (stories agent completing for "Add user auth")            │
│                                                             │
│   Go do deep work. Hog will toast when it needs you.        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline Completion Celebration (Adam Grant)

When a pipeline finishes:

```
   ✓ Pipeline complete: Add user authentication

   Built:  4 files changed, 340 insertions
   Tests:  12 passing (3 from red team)
   Quality: 94% mutation score · 0 security issues
   Time:   23 minutes (stories 5m → tests 4m → impl 8m → redteam 4m → merge 2m)

   Merged to main via Refinery.
```

### Wait Time Indicators (Gene Kim)

Between phases, show idle time:

```
  ✓ stories  done in 5m
  ⏳ tests    waiting 2m  (avg: starts within 30s)
```

If wait time exceeds expected, something's wrong — highlight in yellow.

### Agent Diff Summary (Amodei)

In the detail panel, instead of raw agent output, show structured summary:

```
Agent: [impl] Add user auth — running 8m
Files: src/auth.ts (+120), src/auth.test.ts (+80), src/middleware.ts (+15)
Tests: 8 passing, 0 failing
Blast radius: 3 files, auth module only
```

### Adaptive Polling (Yegge)

- When user is actively looking at board (has focus): poll `bd ready` every 2 seconds
- When board is in background (lost focus or idle > 60s): poll every 15 seconds
- Agent stream events always real-time (they're push, not poll)

### Leading Indicators (Gene Kim)

```
  ◐ impl  running 8m  (avg for this repo: 12m)  ████████░░░░  67%
```

Estimated completion based on historical phase durations for this repo.

---

## Implementation Tasks

### Phase 1: Visible Skeleton (Fowler: shape first, data later)

- [ ] **1.1 Build `PipelineView` skeleton with hardcoded data**
  New component at `src/board/components/pipeline-view.tsx`.
  Hardcode 2-3 fake pipelines to nail the layout before real data.
  Left column: pipeline list with progress bars + agents section.
  Right panel: focus area (decision or detail).
  Responsive breakpoints: ≥ 140 two-panel, 100-139 list only, < 100 compact.
  Depends on: nothing

- [ ] **1.2 Wire view switching into dashboard**
  Add `boardView: "pipelines" | "issues"` to UI state.
  `i` key switches to Issues View, `Esc` or `p` returns to Pipeline View.
  Dashboard renders either PipelineView or existing layout.
  Default to Pipeline View when pipelines exist (else Issues View).
  Depends on: 1.1

- [ ] **1.3 Build empty state and all-clear state**
  Empty state: "What do you want to build?" with text input.
  All-clear state: "Nothing needs your attention" with estimated next decision time.
  Depends on: 1.1

### Phase 2: Real Data

- [ ] **2.1 Build `usePipelineData` hook with `useSyncExternalStore`**
  Subscribe to Conductor as external store (Fowler: single source of truth).
  No local useState for pipeline data — derive everything from Conductor on each render.
  Exposes: pipelines, questionQueue, mergeQueue, startPipeline, pausePipeline, resolveQuestion.
  Adaptive polling: 2s when focused, 15s when idle.
  Depends on: Engine class

- [ ] **2.2 Replace hardcoded data with real Conductor data**
  Wire PipelineView to usePipelineData hook.
  Pipeline list shows real pipelines with real progress.
  Agents section shows real tracked agents from AgentManager.
  Depends on: 2.1, 1.1

- [ ] **2.3 Build `PipelineListPanel` with progress bars**
  Each pipeline: title + progress bar + one-line status.
  ```
  ▶ Add user auth       ████░░░░░░  40%   ◐ tests 3m
    Rate limiting        ██████████  done  ✓
  ```
  Collapsible: Enter shows beads with status icons.
  Merge queue section at bottom.
  Depends on: 2.2

- [ ] **2.4 Build `FocusPanel` — the right side**
  Priority rendering:
  1. If decisions pending → show highest-severity decision with context + options
  2. If no decisions → show selected pipeline detail (DAG + agent status + log)
  3. If no pipelines → empty state
  Decision severity classification (safety > architecture > preference).
  Depends on: 2.2

### Phase 3: Interactions

- [ ] **3.1 Add `P` key — start pipeline**
  Opens text input in the focus panel.
  On submit: calls conductor.startPipeline() with the first repo that has localPath.
  Shows "Pipeline started" toast + pipeline appears in list.
  In Issues View: `P` on selected issue uses its title+body as spec.
  Depends on: 2.1

- [ ] **3.2 Add inline decision answering**
  When focus panel shows a decision: `1-4` picks an option, `D` opens custom text input.
  Resolves the question via conductor, pipeline unblocks, focus panel advances to next decision or shows detail.
  Decision recommendations shown with reasoning (when Clarity Analyst provides one).
  Depends on: 2.4

- [ ] **3.3 Add pipeline controls**
  `x` pauses/resumes selected pipeline.
  `X` stops with confirmation overlay.
  `r` manual refresh.
  Depends on: 2.1, 2.3

- [ ] **3.4 Add Zen mode from Pipeline View**
  `Z` on a pipeline with active agent → tmux split showing that agent's Claude session.
  Reuse existing zen mode infrastructure.
  Depends on: 2.3, existing use-zen-mode.ts

### Phase 4: Rich Detail

- [ ] **4.1 Build DAG visualization in detail panel**
  ```
  stories ✓ ──→ tests ◐ ──→ impl ○ ──→ redteam ○ ──→ merge ○
  ```
  Color-coded: green=done, yellow=running, dim=pending, red=failed.
  Wait time indicators between phases (Gene Kim).
  Depends on: 2.4

- [ ] **4.2 Build agent diff summary**
  Per-agent structured view instead of raw output:
  - Files changed with insertions/deletions
  - Test results (passing/failing)
  - Blast radius (modules affected)
  Uses `git diff --stat` on agent's worktree.
  Depends on: 2.4

- [ ] **4.3 Add leading indicators (estimated completion)**
  Track historical phase durations per repo.
  Show progress bar with estimated time: `◐ impl 8m (avg 12m) ████████░░░░ 67%`
  Store history in enrichment.json.
  Depends on: 2.3

- [ ] **4.4 Build pipeline completion celebration**
  On pipeline complete: toast + detail panel shows summary:
  Files built, tests passing, mutation score, security clean, time per phase.
  Retrospective data for continuous learning (Gene Kim).
  Depends on: 2.4

### Phase 5: Status Bar + Polish

- [ ] **5.1 Add persistent status bar**
  Bottom row: `3 pipelines · 5 agents · ⚠ 2 decisions · queue: 1 · 12s`
  Decisions count in RED when > 0 (Cal Newport: decisions are the bottleneck).
  Visible in both views.
  Depends on: 2.1

- [ ] **5.2 Add pipeline badge to Issues View**
  Issues with active pipelines show `[◐]` badge.
  Depends on: 2.1

- [ ] **5.3 Add event toasts**
  Pipeline started, agent completed, decision needed, merge complete.
  OS notifications for decisions when configured.
  Depends on: 2.1

- [ ] **5.4 Build Issues View escape hatch**
  `i` from Pipeline View switches to Issues View (existing board).
  `p` or `Esc` returns to Pipeline View.
  All existing keyboard shortcuts preserved in Issues View.
  Depends on: 1.2

---

## Acceptance Criteria

1. Empty board shows "What do you want to build?" prompt — not a blank screen
2. `P` key starts a pipeline without leaving the board
3. Pending decisions dominate the focus panel — cannot be missed
4. Decisions show severity classification (safety/architecture/preference)
5. Decision answering is inline: one keystroke to pick an option
6. Pipeline progress visible as progress bar at a glance (no expanding required)
7. "All clear" state explicitly tells user to go do deep work
8. Agent diff summary shows structured info (files, tests, blast radius), not raw output
9. Wait time between phases is visible — stalls are obvious
10. Pipeline completion shows celebration summary with metrics
11. Status bar shows decision count in RED when decisions are pending
12. Zen mode works from Pipeline View
13. Issues View fully preserved and accessible via `i` key
14. Responsive at 100+ columns
15. Adaptive polling: 2s when focused, 15s when idle

## Decision Rationale

### Why single view with progressive disclosure instead of Tab switching?

Adam Grant's insight: Tab switching between Pipeline and Issues views causes attention residue. Progressive disclosure within one view eliminates context switching. Issues appear WITHIN the pipeline context when relevant, not in a separate world.

**Rejected:** Two co-equal views with Tab — feels like two separate apps sharing a window.

### Why progress bars instead of inline DAGs in the pipeline list?

Steve Yegge's insight from Gastown: too many moving parts visible at once is overwhelming. Progress bars convey status faster than parsing a 5-node DAG. The DAG is for the detail panel when you've committed to looking at one pipeline.

### Why "decisions as hero" instead of "agents as hero"?

Seth Godin + Cal Newport: agents are the machine working — they don't need attention. Decisions are the human bottleneck — they deserve the spotlight. The board's job is to maximize the value of the human's limited attention.

### Why decision severity classification?

Dario Amodei: not all decisions are equal. Auth decisions deserve deep thought. Naming decisions are rubber-stamps. The visual treatment should match the stakes.

### Why `useSyncExternalStore` instead of useState + polling?

Martin Fowler: three sources of truth (Conductor, Beads, React state) is two too many. useSyncExternalStore makes the Conductor the single authority and React subscribes directly.

## Risk Analysis

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Progressive disclosure too deep (3+ levels) | Medium | Medium | Max 2 levels: pipeline list → pipeline detail. Issues are a separate view, not a third level. |
| Decision dominance is annoying when decisions are trivial | Low | Medium | Preference decisions auto-resolve with default after 5min timeout |
| useSyncExternalStore integration with Ink is tricky | Medium | Medium | Ink uses React 18+; test compatibility early in Phase 2 |
| Historical phase durations are inaccurate early on | Low | High | Show "no estimate yet" until 3+ data points; degrade gracefully |
| Agent diff summary requires worktree git access | Low | Low | Falls back to agent output preview if worktree unavailable |

## References

- [Brainstorm: Agent Development Platform](../brainstorms/2026-03-21-hog-agent-development-platform-brainstorm.md)
- [Plan: Agent Development Platform](2026-03-21-feat-agent-development-platform-plan.md) — engine architecture
- [Current panel layout](../../src/board/components/panel-layout.tsx) — responsive breakpoint system
- [Current UI state machine](../../src/board/hooks/use-ui-state.ts) — FSM to extend
- [Zen mode infrastructure](../../src/board/hooks/use-zen-mode.ts) — tmux pane orchestration to reuse
- Expert panel: Cal Newport (focus/push away), Seth Godin (decisions as hero, emotional first-time), Adam Grant (progressive disclosure, celebration), Dario Amodei (decision classification, diff summary), Steve Yegge (progress bars, adaptive polling), Martin Fowler (useSyncExternalStore, skeleton first), Gene Kim (wait time, leading indicators, retrospective)
