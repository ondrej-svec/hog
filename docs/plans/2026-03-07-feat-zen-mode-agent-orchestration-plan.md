---
title: "Zen Mode & Collapsible Left Panel"
type: feat
status: completed
date: 2026-03-07
brainstorm: docs/brainstorms/2026-03-07-zen-mode-agent-orchestration-brainstorm.md
---

# Zen Mode & Collapsible Left Panel

## Overview

Two features that enhance hog's role as an agent orchestration command center:

1. **Zen Mode (`Z`)** — Splits the terminal into a narrow issue list (~35%) + an interactive Claude Code tmux pane (~65%). One agent visible at a time. Cursor-follow auto-switches between agent sessions. Falls back to issue details when cursor is on a non-agent issue.

2. **Collapsible Left Panel (`H`)** — Toggles the repos+statuses left column (24 cols) to give more horizontal space to the issues panel.

---

## Proposed Solution

### Zen Mode

When the user presses `Z`, hog:
1. Enters `zen` UI mode (new state in the UI state machine)
2. Detects if running inside tmux (`isInTmux()` — already exists)
3. Pulls the agent's tmux pane into hog's window via `tmux join-pane -h`
4. The right pane shows the Claude Code session for the currently selected issue
5. hog's Ink layout shrinks to a compact flat issue list (no repos/statuses panels, no detail panel)
6. As cursor moves between issues, hog swaps the right pane content (`break-pane` + `join-pane`)

Exiting zen mode (`Z` again or `Esc`): closes the tmux pane but keeps Claude Code sessions running in their own tmux windows.

### Collapsible Left Panel

When the user presses `H`:
1. Toggle `leftPanelHidden` boolean state
2. `PanelLayout` conditionally omits the left column (`repos + statuses`)
3. Issues panel gains 24 columns via `flexGrow={1}` (automatic)
4. Width calculations subtract `LEFT_COL_WIDTH` only when visible

---

## Technical Considerations

### Tmux split architecture (critical)

When hog creates a `tmux split-window -h`, tmux divides the terminal into two panes. Hog's Ink instance continues rendering in the left pane. Ink's `useStdout` hook detects the narrower pane width via the terminal `resize` event — this happens automatically. The right pane is a separate tmux pane that hog controls via tmux CLI commands but does not render into.

**Proof-of-concept needed**: Before full implementation, verify that Ink correctly re-renders when a tmux split narrows its pane. This is the single most critical assumption.

### Input routing between panes

In a tmux split, only one pane receives keyboard input at a time. The **left pane (hog) stays active by default** — user navigates issues with `j`/`k`, the right pane updates visually. To interact with Claude Code directly, the user uses tmux's native pane switching (`Ctrl-B + arrow`). This is the standard tmux UX and avoids any custom input routing.

### Agent discovery for cursor-follow

Zen mode discovers agent sessions via **tmux window naming convention**: `claude-{issueNumber}` (set by `launchViaTmux()` in `launch-claude.ts:151`). Uses `tmux list-windows -F "#{window_name}"` to check if a window exists. This only finds **interactive tmux-launched agents** (from `C` key), not background agents (`spawn-agent.ts`). Background agents have no tmux window — for those issues, zen mode falls back to showing issue info (title + URL echoed in the right pane).

### Tmux pane management: join-pane / break-pane

Zen mode uses `tmux join-pane` to pull an agent's pane from its window into hog's window, and `tmux break-pane` to send it back. This is fundamentally different from `split-window` + `send-keys` — tmux windows and panes are different concepts, and you cannot make a pane display a different window's content by sending keystrokes. `join-pane`/`break-pane` physically moves panes between windows, which naturally preserves the Claude Code session on zen exit.

### Multiple agents per issue

If an issue has multiple tmux windows (e.g. `claude-42` from different launch times), `tmux list-windows` returns the most recent match. Only one can be shown at a time, and the naming convention (`claude-{number}`) means the latest launch's window name wins.

### Zen mode keyboard scope

In zen mode: `j`/`k` navigation, `Z`/`Esc` exit, `C` launch. All other action keys and digit panel keys (`0-4`) disabled. `H` is a no-op (left panel already gone). Activity panel hidden to maximize issue list height.

### Left panel toggle behavior

- Focus auto-switches to panel 3 (issues) if panels 1 or 2 are focused when hiding
- Not persisted across sessions (ephemeral, like focus mode)
- Does NOT affect layout breakpoints — `layoutMode` is based on terminal width, not content width
- Minimum terminal width for zen mode: 100 columns (`MEDIUM_THRESHOLD`)

---

## Technical Approach

### Phase 1: Collapsible Left Panel (`H` toggle)

Simpler feature, independent of tmux. Ship first.

**Files to modify:**

| File | Change |
|------|--------|
| `src/board/components/dashboard.tsx` | Add `leftPanelHidden` state, adjust `issuesPanelWidth` calc, pass to `PanelLayout` |
| `src/board/components/panel-layout.tsx` | Add `hideLeftPanel` prop to `PanelLayoutProps`, conditionally skip left column `<Box>` |
| `src/board/hooks/use-keyboard.ts` | Add `handleToggleLeftPanel` to `KeyboardActions`, bind `H` in normal mode |
| `src/board/components/hint-bar.tsx` | Add `H` to panel 3 hints |
| `src/board/components/help-overlay.tsx` | Add `H` to shortcuts list under "View" category |

**Implementation details:**

`panel-layout.tsx` — Add `hideLeftPanel?: boolean` to `PanelLayoutProps`. In wide and medium modes, wrap the left column `<Box>` in a conditional:

```typescript
{!hideLeftPanel ? (
  <Box flexDirection="column" width={LEFT_COL_WIDTH}>
    {reposPanel}
    {statusesPanel}
  </Box>
) : null}
```

`dashboard.tsx` — Width calculation adjustment:

```typescript
const effectiveLeftWidth = leftPanelHidden ? 0 : LEFT_COL_WIDTH;
const issuesPanelWidth = Math.max(20,
  layoutMode === "wide"
    ? usableWidth - effectiveLeftWidth - getDetailWidth(termSize.cols)
    : layoutMode === "medium"
      ? usableWidth - effectiveLeftWidth
      : usableWidth,
);
```

**Acceptance criteria:**
- [x] `H` toggles left panel visibility in `normal` mode
- [x] Issues panel expands to fill reclaimed space
- [x] Panel focus keys `1`/`2` are no-ops when left panel is hidden; focus auto-switches to panel 3 if on hidden panel
- [x] `H` hint appears in hint bar and help overlay
- [x] Works across all three layout modes (wide/medium/stacked — in stacked, hides the repos/statuses sections)
- [x] Layout breakpoints are NOT recalculated (based on terminal width, not content width)
- [x] State resets on dashboard mount (not persisted)
- [x] `H` is a no-op in zen mode

---

### Phase 2: Tmux Pane Utilities

New module for tmux pane orchestration commands. Separate from `launch-claude.ts` (which handles session creation).

**New file: `src/board/tmux-pane.ts`**

```typescript
/** Get the tmux window name for an agent session (e.g. "claude-42"). */
function agentWindowName(issueNumber: number): string;

/** Check if a named tmux window exists. */
function windowExists(windowName: string): boolean;

/** Pull an agent's pane from its tmux window into the current window as a right split. Returns the pane ID. */
function joinAgentPane(windowName: string, widthPercent: number): string | null;

/** Send a pane back to its own tmux window (restores the agent's original window). */
function breakPane(paneId: string): void;

/** Check if a tmux pane is still alive. */
function isPaneAlive(paneId: string): boolean;

/** Show issue info in a new right split pane (for issues without an agent). Returns pane ID. */
function splitWithInfo(info: { title: string; url: string }, widthPercent: number): string | null;

/** Kill a tmux pane by ID. */
function killPane(paneId: string): void;
```

**Key tmux commands used:**
- `tmux join-pane -h -s <windowName>.0 -t . -l 65%` — pull agent pane into current window as right split
- `tmux break-pane -d -s <paneId>` — send pane back to its own window (detached, preserves session)
- `tmux split-window -h -l 65% -d -P -F "#{pane_id}" echo <info>` — create info pane for non-agent issues
- `tmux kill-pane -t <paneId>` — cleanup
- `tmux list-windows -F "#{window_name}"` — check if agent window exists
- `tmux list-panes -F "#{pane_id}"` — check if pane is alive

All commands use `execFileSync("tmux", [...])` (synchronous is fine — these are instant).

**Why `join-pane` / `break-pane` instead of `split-window` + `send-keys`:**
tmux panes and windows are different concepts. You can't make a pane display a different window's content by sending keystrokes. `join-pane` physically moves a pane between windows, and `break-pane` restores it. This naturally preserves the Claude Code session on zen exit.

**Acceptance criteria:**
- [x] `joinAgentPane()` pulls an agent's pane into the current window and returns pane ID
- [x] `breakPane()` sends a pane back to its own window (preserves session)
- [x] `splitWithInfo()` creates an info pane with issue title + URL
- [x] `killPane()` cleans up without error even if pane already closed
- [x] `windowExists()` correctly detects named tmux windows
- [x] `isPaneAlive()` detects dead panes
- [x] All functions handle tmux errors gracefully (return null/false)
- [x] Unit tests mock `execFileSync` for all tmux commands

---

### Phase 3: Zen Mode UI State & Layout

Wire zen mode into the UI state machine and keyboard handler.

**Files to modify:**

| File | Change |
|------|--------|
| `src/board/hooks/use-ui-state.ts` | Add `"zen"` to `UIMode`, `ENTER_ZEN`/`EXIT_ZEN` actions, reducer cases, `enterZen`/`exitZen` callbacks |
| `src/board/hooks/use-keyboard.ts` | Add `handleEnterZen` to `KeyboardActions`, bind `Z` in normal mode, handle `Z`/`Esc` exit in zen mode |
| `src/board/components/dashboard.tsx` | Add zen state (`zenPaneId`, `zenIsAgentPane`), `handleEnterZen`/`handleExitZen` callbacks, zen-mode layout rendering |
| `src/board/components/hint-bar.tsx` | Add zen mode hint section |
| `src/board/components/help-overlay.tsx` | Add `Z` to shortcuts |

**UI state machine additions** (`use-ui-state.ts`):

```typescript
// Add to UIMode union
type UIMode = ... | "zen";

// Add actions
| { type: "ENTER_ZEN" }
| { type: "EXIT_ZEN" }

// Reducer: zen can only be entered from normal mode
case "ENTER_ZEN":
  if (state.mode !== "normal") return state;
  return { ...state, mode: "zen", previousMode: "normal" };
case "EXIT_ZEN":
  return { ...state, mode: "normal" };

// canNavigate: true for zen (issue list navigation still works)
// canAct: false for zen (most actions disabled — only Z/Esc exit, C launch, j/k nav)
// inputActive: add "zen" so useInput hook fires in zen mode
```

**Zen mode layout** (`dashboard.tsx`):

When `ui.state.mode === "zen"`, render a compact layout instead of `PanelLayout`:

```tsx
// Zen mode: compact issue list only (no repos, statuses, detail, activity panels)
<Box flexDirection="column">
  <Panel title="Issues" isActive width={usableWidth} flexGrow={1}>
    {/* Same RowRenderer but compact: no repo/status headers */}
    {visibleRows.map(row => (
      <RowRenderer key={row.key} row={row} ... panelWidth={usableWidth} />
    ))}
  </Panel>
</Box>
```

The right pane is a real tmux pane (not rendered by Ink).

**Acceptance criteria:**
- [x] `Z` enters zen mode from normal mode only (blocked from overlays, multiSelect, focus)
- [x] `Z` shows toast "Zen mode requires tmux" if not in tmux
- [x] `Z` shows toast "Terminal too narrow for Zen mode" if cols < 100
- [x] `Z` or `Esc` exits zen mode
- [x] Zen mode hides PanelLayout and shows compact issue list (no repos, statuses, detail, activity)
- [x] `j`/`k` navigation works in zen mode
- [x] Digit keys `0-4` are no-ops in zen mode
- [x] Most action keys (`m`, `n`, `f`, `l`, etc.) are disabled in zen mode
- [x] `C` (launch Claude Code) works in zen mode
- [x] Hint bar shows zen-specific keys (Z exit, j/k nav, C launch)
- [x] Help overlay documents `Z`

---

### Phase 4: Zen Mode Tmux Orchestration

Connect zen UI state to actual tmux pane management.

**Dashboard state:**

```typescript
// Track zen mode tmux state
const [zenPaneId, setZenPaneId] = useState<string | null>(null);
const [zenIsAgentPane, setZenIsAgentPane] = useState(false); // true if right pane is a joined agent, false if info pane
```

**Dashboard handler: `handleEnterZen`**

```typescript
const handleEnterZen = useCallback(() => {
  if (!isInTmux()) {
    toast.error("Zen mode requires tmux");
    return;
  }
  if (termSize.cols < 100) {
    toast.error("Terminal too narrow for Zen mode");
    return;
  }

  const found = findSelectedIssueWithRepo(repos, nav.selectedId);
  const windowName = found ? agentWindowName(found.issue.number) : null;
  const hasAgent = windowName && windowExists(windowName);

  let paneId: string | null;
  if (hasAgent && windowName) {
    // Pull agent pane into current window
    paneId = joinAgentPane(windowName, 65);
    setZenIsAgentPane(true);
  } else {
    // Show issue info in a new split
    paneId = splitWithInfo(
      { title: found?.issue.title ?? "", url: found?.issue.url ?? "" },
      65,
    );
    setZenIsAgentPane(false);
  }

  if (!paneId) {
    toast.error("Failed to create tmux pane");
    return;
  }

  setZenPaneId(paneId);
  ui.enterZen();
}, [repos, nav.selectedId, ui, toast, termSize.cols]);
```

**Cursor-follow effect:**

```typescript
// When zen mode is active and selectedId changes, swap the right pane
useEffect(() => {
  if (ui.state.mode !== "zen" || !zenPaneId) return;

  const found = findSelectedIssueWithRepo(repos, nav.selectedId);
  if (!found) return;

  const windowName = agentWindowName(found.issue.number);
  const hasAgent = windowExists(windowName);

  // Clean up current right pane
  if (zenIsAgentPane) {
    breakPane(zenPaneId); // send agent pane back to its window
  } else {
    killPane(zenPaneId); // kill the info pane
  }

  // Create new right pane
  let newPaneId: string | null;
  if (hasAgent) {
    newPaneId = joinAgentPane(windowName, 65);
    setZenIsAgentPane(true);
  } else {
    newPaneId = splitWithInfo(
      { title: found.issue.title, url: found.issue.url },
      65,
    );
    setZenIsAgentPane(false);
  }

  setZenPaneId(newPaneId);
}, [ui.state.mode, zenPaneId, zenIsAgentPane, nav.selectedId, repos]);
```

**Exit handler: `handleExitZen`**

```typescript
const handleExitZen = useCallback(() => {
  if (zenPaneId) {
    if (zenIsAgentPane) {
      breakPane(zenPaneId); // send agent back to its own window (preserves session)
    } else {
      killPane(zenPaneId); // kill the info pane
    }
    setZenPaneId(null);
    setZenIsAgentPane(false);
  }
  ui.exitZen();
}, [zenPaneId, zenIsAgentPane, ui]);
```

**Launch from zen mode:**

Modify `handleLaunchClaude` to detect zen mode — after launching, swap the right pane to show the new agent:

```typescript
// After successful launchClaude() in zen mode:
if (ui.state.mode === "zen" && zenPaneId) {
  // Clean up current right pane
  if (zenIsAgentPane) {
    breakPane(zenPaneId);
  } else {
    killPane(zenPaneId);
  }
  // Small delay for tmux window to be created, then join it
  setTimeout(() => {
    const windowName = agentWindowName(issue.number);
    if (windowExists(windowName)) {
      const newPaneId = joinAgentPane(windowName, 65);
      setZenPaneId(newPaneId);
      setZenIsAgentPane(true);
    }
  }, 500);
}
```

**Acceptance criteria:**
- [x] Entering zen creates a tmux split pane to the right
- [x] If selected issue has an active agent, the pane shows that agent's Claude Code session
- [x] Navigating to another issue with an agent swaps the pane content
- [x] Navigating to an issue without an agent shows a fallback (details or empty)
- [x] Exiting zen closes the tmux pane but keeps agents running
- [x] Pressing `C` in zen mode launches Claude Code and auto-attaches to the pane
- [x] Graceful handling if tmux pane is manually closed by user (detect dead pane, exit zen)

---

### Phase 5: Edge Cases & Polish

**Terminal resize in zen mode:**
- The tmux pane split ratio is set once on creation. If the user resizes their terminal, tmux handles the pane resizing automatically (no hog intervention needed).

**Agent exits while viewed in zen mode:**
- The tmux window stays open after Claude Code exits (tmux default behavior: window shows shell prompt). The pane remains visible. No special handling needed.

**Tmux pane manually closed:**
- Add a periodic check (every 2s) in zen mode: if `zenPaneId` no longer exists (tmux pane was killed externally), auto-exit zen mode and toast.

```typescript
useEffect(() => {
  if (ui.state.mode !== "zen" || !zenPaneId) return;
  const interval = setInterval(() => {
    if (!isPaneAlive(zenPaneId)) {
      handleExitZen();
      toast.info("Zen pane closed");
    }
  }, 2000);
  return () => clearInterval(interval);
}, [ui.state.mode, zenPaneId, handleExitZen, toast]);
```

**Panel focus interaction:**
- In zen mode, panel focus keys `0-4` are disabled (only the compact issue list is rendered)
- `1`/`2` pressing in zen mode is a no-op

**Acceptance criteria:**
- [x] Dead pane detection exits zen mode gracefully
- [x] Panel focus keys are no-ops in zen mode
- [x] Terminal resize doesn't break zen layout
- [x] Agent exit doesn't break zen pane

---

## Testing Strategy

### Unit Tests

| Test file | Coverage |
|-----------|----------|
| `src/board/tmux-pane.test.ts` | All tmux commands mocked via `vi.mock("child_process")`. Test `joinAgentPane`, `breakPane`, `splitWithInfo`, `killPane`, `windowExists`, `isPaneAlive`, error handling. |
| `src/board/hooks/use-ui-state.test.ts` | Extend existing tests: `ENTER_ZEN` from normal, `EXIT_ZEN`, zen mode transitions, `canNavigate`/`canAct` in zen. |
| `src/board/hooks/use-keyboard.test.ts` | `Z` key enters zen mode in normal mode, `Z`/`Esc` exits zen, `H` toggles left panel. |
| `src/board/components/panel-layout.test.tsx` | `hideLeftPanel` prop omits left column, issues panel expands. |

### Integration Tests

- Dashboard rendering with `leftPanelHidden=true` — snapshot test showing expanded issues panel
- Zen mode rendering — shows compact issue list, no repos/statuses/detail panels

### Manual Testing Checklist

- [x] In tmux: press `Z` → pane splits, Claude Code visible
- [x] Navigate between agent issues → pane swaps
- [x] Navigate to non-agent issue → fallback shown
- [x] Press `C` on non-agent issue in zen → agent launches and attaches
- [x] Press `Z` to exit → pane closes, agents keep running
- [x] Press `Z` outside tmux → error toast
- [x] Press `H` → left panel hides/shows
- [x] Close tmux pane manually → zen auto-exits

---

## Dependencies & Risks

**Dependencies:**
- tmux must be installed and hog must be running inside a tmux session for zen mode
- Existing `launch-claude.ts` infrastructure (tmux window creation, env detection)
- Existing `use-agent-sessions.ts` for knowing which issues have active agents

**Risks:**
- **Ink pane width detection** — Critical assumption: Ink's `useStdout` correctly detects narrower pane width after tmux split. Must be validated with a proof-of-concept before full implementation.
- **Tmux version differences** — `split-window -l 65%` percentage syntax requires tmux >= 3.1. Need to check and fall back gracefully (older versions use `-p 65`).
- **Pane ID stability** — tmux pane IDs are stable within a session but the pane target format varies. Use `%N` format from `-P -F "#{pane_id}"`.
- **Agent window naming** — the window name `claude-{number}` from `launch-claude.ts` must remain consistent. If a user manually renames the window, attachment will fail silently.
- **Background agents not visible** — Agents launched via workflow overlay (`spawn-agent.ts`) run headlessly and have no tmux window. Zen mode only shows tmux-launched agents (via `C` key). Users may be confused if a workflow agent is running but not visible in zen mode.
- **Auto-refresh cursor stability** — During data refresh in zen mode, if the cursor position changes (e.g., issue reorders), the right pane would unexpectedly switch. The existing `findFallback` logic in `use-navigation.ts` mitigates this but should be tested.

---

## References

- **Brainstorm:** `docs/brainstorms/2026-03-07-zen-mode-agent-orchestration-brainstorm.md`
- **Prior art:** `docs/plans/2026-02-24-feat-launch-claude-code-from-issue-plan.md` (Claude Code launch)
- **Prior art:** `docs/plans/2026-03-01-feat-workflow-conductor-plan.md` (agent session tracking)
- **Panel layout system:** `docs/brainstorms/2026-02-22-lazygit-panel-layout-brainstorm.md`

### Key source files

- `src/board/launch-claude.ts:146` — `launchViaTmux()` function
- `src/board/hooks/use-agent-sessions.ts:47` — `useAgentSessions()` hook
- `src/board/hooks/use-ui-state.ts:5` — `UIMode` union type
- `src/board/hooks/use-keyboard.ts:11` — `KeyboardActions` interface
- `src/board/components/panel-layout.tsx:35` — `PanelLayout` component
- `src/board/components/dashboard.tsx:907` — `handleLaunchClaude` callback
