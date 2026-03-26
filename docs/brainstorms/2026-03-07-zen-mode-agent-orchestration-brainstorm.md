# Brainstorm: Zen Mode & Agent Orchestration

**Date:** 2026-03-07
**Status:** Draft
**Topic:** Tmux-integrated Zen mode for monitoring/interacting with Claude Code agent sessions, plus collapsible left panel for more issue real estate

---

## What We're Building

Two related features that enhance hog's role as an agent orchestration command center:

### Feature 1: Zen Mode

A layout mode (toggle via keybind, e.g. `Z`) that splits the terminal into a narrow issue list on the left and a full interactive Claude Code tmux pane on the right. Designed for focusing on one agent session at a time while keeping oversight of all issues.

**How it works:**
1. User presses `Z` on an issue with an active agent
2. hog uses `tmux split-window -h` to create a right pane showing that agent's Claude Code session
3. hog shrinks to a narrow left strip: flat issue list (number + short title), agents highlighted with status indicator
4. As cursor moves to another issue with an active agent, hog swaps the right pane content to that agent's session
5. If cursor moves to an issue without an agent, the right pane shows issue details instead (fallback)
6. Press `Z` again (or `Esc`) to exit Zen mode — hog reclaims full width, tmux pane closes

**Key behaviors:**
- The right pane is a real tmux pane — fully interactive Claude Code (not read-only)
- Only ONE agent visible at a time (others continue running in background tmux windows)
- Cursor-follow: right pane auto-switches when cursor moves between agent issues
- Requires tmux (graceful error if not in tmux)
- Builds on existing `launch-claude.ts` tmux infrastructure

### Feature 2: Collapsible Left Panel

A keybind toggle (e.g. `H`) that hides the left column (Repos + Statuses panels) to give more horizontal space to the issues panel.

**How it works:**
1. Press `H` to hide the left column (repos + statuses panels)
2. Issues panel expands to fill the freed 24 columns
3. Press `H` again to restore
4. In Zen mode, the left column is always hidden (the narrow strip replaces both left column and issues panel)

---

## Why This Approach

### Zen mode via tmux pane orchestration (not Ink-embedded terminal)

We researched five approaches for embedding terminal output in Ink:

| Approach | Feasibility | Interactivity | Verdict |
|----------|-------------|---------------|---------|
| Tmux pane split | High | Full | **Chosen** |
| node-pty + Ink render | High | Possible but complex | Input focus mgmt is hard |
| tmux capture-pane | Moderate | Read-only | Good for peek, not focus |
| xterm.js/headless | Low | Full | Over-engineered, browser lib |
| Blessed terminal widget | Moderate | Full | Wrong framework |

**Why tmux panes win:**
- Full interactivity with zero input-focus complexity — tmux handles it natively (Ctrl-B + arrows)
- No new dependencies (tmux is already required for agent launch)
- Claude Code's TUI renders perfectly (it's a real terminal, not emulation)
- Simple implementation: ~5 tmux CLI commands (`split-window`, `send-keys`, `select-pane`, `resize-pane`, `kill-pane`)

**Why not embed in Ink:**
- Ink can't host a real interactive terminal inside its React tree
- node-pty embedding is technically possible but input routing between hog's keyboard handling and the embedded terminal is a hard UX problem (which panel gets keystrokes?)
- Screen real estate: side-by-side requires 180+ columns; limiting to ONE visible agent makes the math work

### Collapsible left panel via keybind toggle

- Simple boolean state toggle — no config needed
- Recovers 24 columns of horizontal space
- Natural fit: in Zen mode, the repos/statuses panels are irrelevant (you're focused on work, not navigation)
- Pairs well with the existing layout breakpoint system (`panel-layout.tsx`)

---

## Key Decisions

1. **One visible agent at a time** — Screen real estate makes multiple simultaneous agent views impractical. Other agents run in background tmux windows. Zen mode shows the one you're focused on.

2. **Cursor-follow switching** — The right pane content follows the issue cursor. Moving to issue #43 (with agent) swaps the pane to #43's session. Moving to #44 (no agent) shows issue details.

3. **Tmux pane, not Ink rendering** — Real tmux panes for full Claude Code interactivity. hog orchestrates pane lifecycle via tmux CLI commands.

4. **Flat issue list in Zen mode** — All issues visible (not just agent issues), but compact: issue number + truncated title. Agent issues get a status indicator (spinning, done, failed).

5. **Graceful fallback for non-agent issues** — When cursor is on an issue without an active agent, the right pane shows issue details (similar to current detail panel behavior).

6. **Collapsible left panel is independent** — Works in normal mode (just hides repos/statuses) and is implicitly always-on in Zen mode.

7. **Requires tmux** — Zen mode is only available when running inside tmux. Toast error otherwise. This is consistent with the existing Claude Code launch behavior.

---

## Resolved Questions

1. **Tmux pane ratio** — ~35/65% split. Issue list gets ~35% of terminal width (enough for readable titles), Claude Code gets ~65%. Not configurable initially.

2. **Exiting Zen mode** — The tmux pane closes but the Claude Code session keeps running in its own background tmux window. Can be re-attached by entering Zen mode again or switching tmux windows manually.

3. **Launching from Zen mode** — Yes, auto-attach. Pressing `C` on an issue without an agent in Zen mode launches Claude Code and immediately shows it in the right pane.

4. **Keybind choice** — `Z` for Zen mode and `H` for hide left panel. Confirmed no conflicts with existing keybinds.

---

## Prior Art

- **2026-02-24 brainstorm** (`launch-claude-code-from-issue-brainstorm.md`): Established the `C` key launch mechanism, tmux detection, `localPath` config. This brainstorm extends that with the monitoring/orchestration layer.
- **Existing infrastructure**: `launch-claude.ts` (tmux launch), `use-agent-sessions.ts` (agent tracking), `agent-activity-panel.tsx` (status display), `spawn-agent.ts` (background agents with stream monitoring).
