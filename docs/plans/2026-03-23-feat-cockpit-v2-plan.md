---
title: "feat: Cockpit v2 — from broken prototype to production-grade agent cockpit"
type: plan
date: 2026-03-23
status: approved
brainstorm: docs/brainstorms/2026-03-21-hog-agent-development-platform-brainstorm.md
confidence: high
---

# Cockpit v2 — From Broken Prototype to Production-Grade Agent Cockpit

**One-line summary:** Fix the critical bugs that make the cockpit non-functional, then build it into a lazygit-quality TUI where agents work autonomously and the human only intervenes for creative decisions.

## Problem Statement

The cockpit prototype has the right architecture but is broken in fundamental ways:

1. **`conductor.start()` is never called** — the orchestration loop doesn't run, agents are never auto-spawned
2. **Blocked pipelines never unblock** — once stuck, forever stuck
3. **Progress bar is fake** — hardcoded 0.4, not connected to bead status
4. **Decision answering not wired** — questions render but can't be answered
5. **No Esc to cancel** the start pipeline overlay
6. **Agent completion ties to wrong pipeline** under multi-pipeline load
7. **No persistence** — restarting the board loses all pipeline state

Beyond bugs, the UX doesn't follow TUI best practices discovered in research:
- lazygit: always-visible panels, discoverable keybindings
- Gastown `gt feed`: three-panel layout, `--problems` exception-based view
- Devin: chunked summaries over raw streams, ambient status
- AG-UI: inline HITL events, non-modal approval widgets

## Proposed Solution

Two phases: **Fix** (make it work) then **Polish** (make it great).

### Design Principles (from research)

1. **Exception-based monitoring** — don't make users watch agents. Surface only what needs attention.
2. **Layered information** — summary at a glance, detail on demand, raw logs on drill-down.
3. **Inline decisions** — non-modal, contextual, one-keystroke answers.
4. **Always-visible panels** — no toggling between views to see critical info.
5. **Keyboard-first with footer hints** — lazygit model: everything discoverable without memorizing.

---

## Phase 1: Fix Critical Bugs (Must Ship First)

These are blocking bugs. Nothing else matters until they work.

- [ ] **1.1 Call `conductor.start()` in `usePipelineData`**
  The conductor's tick loop never runs. Add `conductor.start()` after agent manager start in the useEffect. This unblocks: automatic agent spawning, `bd ready` polling, pipeline progression.

- [ ] **1.2 Fix blocked pipelines never unblocking**
  In `conductor.tick()`, blocked pipelines are skipped with `continue`. When questions are resolved, nothing re-evaluates them. Fix: check blocked pipelines for resolved questions and set status back to `"running"`.

- [ ] **1.3 Fix agent→pipeline mapping**
  `onAgentCompleted` iterates ALL pipelines and closes the first matching bead. With multiple pipelines, wrong bead gets closed. Fix: store `featureId` when launching agent (in session metadata or a `sessionToPipeline` Map), use it in completion handler.

- [ ] **1.4 Fix question queue sync**
  `resolveDecision` in `usePipelineData` saves to disk and updates React state, but doesn't update the conductor's in-memory queue. Fix: add a `resolveQuestion` method on Conductor that updates its internal queue.

- [ ] **1.5 Fix Esc in start pipeline overlay**
  The `useInput` handler returns early in non-normal modes, so Esc never fires. Fix: add an Esc handler in the overlay's own `useInput` or in the dashboard's pipeline handler that works during `overlay:startPipeline`.

- [ ] **1.6 Fix title vs description**
  `startPipeline` passes `(description, description)` — title and description are identical. Fix: extract first sentence or first 60 chars as title, full text as description.

- [ ] **1.7 Write tests for all 6 fixes**
  Each fix gets a test that fails before the fix and passes after.

## Phase 2: Real Progress Tracking

- [ ] **2.1 Connect progress bar to actual bead status**
  Poll bead status via `bd show` for each pipeline's beads. Calculate progress: closed beads / total beads. Update progress bar in real-time (every poll cycle).

- [ ] **2.2 Show per-phase status in DAG visualization**
  The DAG shows `stories ○ → tests ○ → impl ○ → redteam ○ → merge ○` with real status colors: green (closed), yellow (in_progress), dim (open), red (blocked/failed).

- [ ] **2.3 Show wait time between phases (Gene Kim)**
  Between phases, show idle duration: `✓ stories done 5m ago → ⏳ tests waiting 2m`. Reveals bottlenecks.

## Phase 3: Decision Answering

- [ ] **3.1 Wire D key to enter decision mode**
  When focus panel shows a decision, `D` activates decision mode. `1-9` picks an option. Custom text via a text input. Calls `conductor.resolveQuestion()`.

- [ ] **3.2 Wire number keys for quick answers**
  In decision mode, pressing `1` picks option 1, `2` picks option 2, etc. Immediate feedback: "Decision resolved: OAuth". Pipeline unblocks.

- [ ] **3.3 Add decision severity indicators (Amodei)**
  Safety decisions (auth, data) → red ⚠. Architecture decisions → yellow ●. Preference decisions → dim ○. Safety decisions get bigger visual treatment.

## Phase 4: Agent Monitoring

- [ ] **4.1 Show agent activity in pipeline detail**
  Per-agent: role, status, current tool use, elapsed time, files changed count.
  Pattern: layered info — summary line in list, full detail on drill-down.

- [ ] **4.2 Show chunked summaries, not raw streams (Devin pattern)**
  Don't show token-by-token output. Show: "Agent is writing user stories. 3 stories written so far. Elapsed: 4m."
  Extract structured info from `monitor.lastToolUse` and `monitor.lastText`.

- [ ] **4.3 Show agent errors inline (not just toast)**
  When an agent fails, show the error in the pipeline detail panel adjacent to the failed phase. Not a toast that disappears — persistent until resolved.

- [ ] **4.4 Z key attaches to agent tmux session**
  From pipeline view, `Z` on a pipeline with an active agent splits tmux to show the Claude Code session. Reuse existing zen mode infrastructure.

## Phase 5: Pipeline Persistence

- [ ] **5.1 Persist pipeline state to enrichment.json**
  On every pipeline state change, save to `enrichment.json` under a `pipelines` key. On board start, restore active pipelines and reconnect to running agents (via PID polling).

- [ ] **5.2 Resume pipelines after board restart**
  If the board restarts while agents are running, the conductor reconstructs state from: enrichment.json (pipeline metadata) + beads (bead statuses) + PID polling (which agents are still alive).

## Phase 6: Worktree + Refinery Wiring

- [ ] **6.1 Pass WorktreeManager and Refinery to Conductor**
  Currently both are `undefined`. Create and pass them in `usePipelineData`. Each agent spawn creates a worktree. Agent completion submits to merge queue.

- [ ] **6.2 Show merge queue status in pipeline view**
  Replace the empty merge queue with real data from the Refinery. Show: status (rebasing/testing/gating/merged/failed), branch, elapsed time.

## Phase 7: UX Polish

- [ ] **7.1 Always-visible status bar (lazygit pattern)**
  Bottom row across both views: `3 pipelines · 5 agents · ⚠ 2 decisions · queue: 1 · 12s ago`.
  Decisions count in RED. Always visible — not hidden by overlays.

- [ ] **7.2 All-clear / go-away state (Cal Newport)**
  When no decisions pending and all pipelines running smoothly:
  "✓ All running. Nothing needs you. Estimated next decision: ~8m."
  Actively pushes user to do deep work.

- [ ] **7.3 Pipeline completion celebration (Adam Grant)**
  On pipeline complete: "✓ Auth feature merged. 12 tests, 94% mutation score, 0 security issues. 23m total."

- [ ] **7.4 Footer keybinding hints always match current mode (lazygit)**
  Already partially done. Verify every mode has accurate hints. Add `?` help overlay for pipeline view.

---

## Acceptance Criteria

1. `conductor.start()` runs — agents auto-spawn when beads become ready
2. Blocked pipelines unblock when questions are resolved
3. Progress bar shows real bead completion percentage
4. DAG visualization shows real per-phase status colors
5. Decisions can be answered inline with number keys
6. Agent failures show in pipeline detail, not just toasts
7. Esc cancels start pipeline overlay
8. Pipeline state survives board restart
9. `Z` attaches to agent's tmux session from pipeline view
10. Status bar visible at all times with pipeline/agent/decision counts
11. All-clear state tells user to go do deep work

## Decision Rationale

### Why fix bugs before polish?

The cockpit prototype has the right shape but doesn't function. Polishing a broken tool teaches bad habits — users learn to distrust it. Fix first, then polish.

### Why exception-based monitoring over continuous watching?

Research shows: raw agent transcript streaming is an anti-pattern (every source agrees). Users don't want to watch agents think — they want to know when attention is needed. Gastown's `--problems` flag and Devin's chunked summaries both validate this.

### Why inline decisions over modal overlays?

Microsoft's AG-UI research and Smashing Magazine's agentic UX guide both show: separate pages for approvals lead to rubber-stamp behavior. Inline, contextual decisions produce better human judgment.

### Why persistence before worktrees?

Losing pipeline state on board restart is a worse user experience than agents running in the main repo. Persistence is a prerequisite for the board being trustworthy.

## Risk Analysis

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| conductor.start() causes unexpected agent spawns | High | Medium | Add `maxConcurrentAgents` guard (already exists); test with dry-run first |
| Question queue sync race between conductor and React | Medium | High | Single source of truth: conductor owns queue, React subscribes |
| Pipeline persistence format changes break restore | Medium | Low | Version the persistence format; migration on load |
| Worktree creation fails on some systems | Medium | Low | Graceful fallback to main repo directory (already coded) |
| Multiple users on same repo create conflicting pipelines | Low | Low | Pipeline IDs include timestamp + random; beads uses hash-based IDs |

## References

- [Research: Agent Development UIs](./research-agent-dev-uis.md) — Gastown, Devin, lazygit, AG-UI, beads_viewer patterns
- [Brainstorm: Agent Development Platform](../brainstorms/2026-03-21-hog-agent-development-platform-brainstorm.md)
- [Plan: Board Cockpit Redesign](2026-03-23-feat-board-cockpit-redesign-plan.md) — original layout plan
- [Plan: Agent Development Platform](2026-03-21-feat-agent-development-platform-plan.md) — engine architecture
- lazygit: always-visible panels, footer keybinding hints, vim-style navigation
- Gastown `gt feed`: three-panel agent monitoring, `--problems` exception-based view
- Devin 2.0: chunked summaries, favicon ambient status, async-first delegation
- AG-UI: inline HITL events, streaming tool call framing, non-modal approval widgets
- beads_viewer: PageRank DAG visualization, viewport virtualization, robot-mode JSON API
