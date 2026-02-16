---
title: "Hog Board Command Center"
type: feat
status: active
date: 2026-02-15
---

# Hog Board Command Center

## Overview

Transform the hog board from a read-only dashboard into a full personal command center. The board already shows GitHub issues and TickTick tasks with navigation, search, collapsible sections, and a detail panel. The gap is between "seeing" and "doing" — every action today requires leaving the terminal.

This plan closes that gap in three phases: core read enhancements (issue body, project statuses, Slack links, pick), board actions (comment, status change, assign, multi-select, create), and polish (activity timeline, focus/pomodoro mode, help overlay).

## Problem Statement

Daily workflow requires constant context-switching between terminal board and browser. To pick an issue, read its description, check its Slack thread, change its status, or leave a comment — you must open the browser, find the issue, and click through UI. This friction adds up across dozens of daily interactions.

## Proposed Solution

Add read enhancements and action capabilities directly to the board TUI, organized in three phases of increasing complexity. Each phase ships independently and builds on the previous.

## Technical Approach

### Architecture

The board uses **Ink** (React for CLIs) with `@inkjs/ui`. Key architectural patterns to follow:

- **Separation of concerns**: Data fetching (`fetch.ts`) separate from rendering (`dashboard.tsx`)
- **Custom hooks**: Navigation (`use-navigation.ts`), data (`use-data.ts`) — add new hooks for actions and UI state
- **FlatRow rendering**: All content rendered as typed rows (`sectionHeader | subHeader | issue | task | error | gap`)
- **Synchronous GitHub ops**: `gh` CLI via `execFileSync` for mutations; GraphQL for project fields
- **Graceful degradation**: Errors captured per-repo, non-blocking

**New architectural concept — UI State Machine:**

The board currently has two implicit states: `normal` and `search`. Adding actions requires a proper state machine to prevent conflicts:

```
normal → search (/)
normal → overlay:comment (c)
normal → overlay:status (m)
normal → overlay:create (n)
normal → multiSelect (Space)
normal → focus (f)
any    → overlay:help (?)    // stacks on top
any    → normal (Escape)     // closes topmost
```

**Rule**: Only one primary state active at a time. Help overlay can stack on any state. In overlay/input states, all navigation and action shortcuts are disabled — only Escape/Enter/arrow keys work. This prevents the "pressed 'a' while typing a comment" problem.

### Key Files to Modify

| File | Changes |
|------|---------|
| `hog/src/github.ts` | Add `body` to fetch fields, add `fetchProjectStatuses()`, add `commentOnIssue()`, add `unassignIssue()`, add `createIssue()`, add `fetchRecentActivity()` |
| `hog/src/board/fetch.ts` | Enrich issues with `body`, `projectStatus`, `slackThreadUrl`; add activity fetch |
| `hog/src/board/components/dashboard.tsx` | UI state machine, new keyboard bindings, action dispatch, section grouping by project status |
| `hog/src/board/components/detail-panel.tsx` | Issue body display, Slack link indicator |
| `hog/src/board/components/issue-row.tsx` | Multi-select checkbox, status badge |
| `hog/src/board/hooks/use-navigation.ts` | Multi-select state, section changes for dynamic statuses |
| `hog/src/board/hooks/use-data.ts` | Post-action refresh, optimistic updates |
| `hog/src/config.ts` | Add `focusDuration` to `BoardConfig` |

### New Files

| File | Purpose |
|------|---------|
| `hog/src/board/hooks/use-ui-state.ts` | UI state machine (normal, search, overlay, multiSelect, focus) |
| `hog/src/board/hooks/use-actions.ts` | Action dispatch (pick, comment, status, assign, create) |
| `hog/src/board/components/status-picker.tsx` | Status selection overlay |
| `hog/src/board/components/comment-input.tsx` | Inline comment text input |
| `hog/src/board/components/create-issue-form.tsx` | New issue form overlay |
| `hog/src/board/components/help-overlay.tsx` | Keyboard shortcut reference |
| `hog/src/board/components/focus-mode.tsx` | Focus/pomodoro timer and dim overlay |
| `hog/src/board/components/activity-section.tsx` | Recent activity timeline section |

### New Fields on GitHubIssue

```typescript
// hog/src/github.ts — extend existing interface
export interface GitHubIssue {
  // ... existing: number, title, url, state, updatedAt, labels, assignees, targetDate
  body?: string;           // Issue description (markdown), fetched with gh issue list
  projectStatus?: string;  // e.g. "In Progress", "In Review", "Backlog" — from GraphQL
  slackThreadUrl?: string; // First Slack URL extracted from body (computed, not fetched)
}
```

### Implementation Phases

#### Phase 1: Core Improvements (Ship fast — ~2-3 sessions)

Read-only enhancements that require no new UI patterns beyond extending the existing detail panel and section structure.

**1.1 Issue body in detail panel**

- [x] Add `body` to `gh issue list --json` fields in `fetchRepoIssues()` (`github.ts:57-75`)
- [x] Compute `slackThreadUrl` from body during fetch enrichment (`fetch.ts`)
- [x] Display body in detail panel: strip markdown to plain text, hard-wrap at panel width, show first 15 terminal lines
- [x] Truncation indicator: `"... (X more lines — gh issue view <number> for full)"` at bottom
- [x] Handle edge cases: empty body shows `"(no description)"`, very long single lines wrap

```typescript
// detail-panel.tsx — new body section
// After existing metadata fields:
<Text dimColor>--- Description ---</Text>
<Text wrap="wrap">{truncatedBody}</Text>
{remainingLines > 0 && (
  <Text dimColor>... ({remainingLines} more lines)</Text>
)}
```

**1.2 Dynamic project status sections**

- [x] Add `fetchProjectStatuses(repo, projectNumber)` to `github.ts` — GraphQL query to get all `SingleSelectField` options for the status field
- [x] Extend `fetchProjectTargetDates()` (or create new batched query) to also return `projectStatus` for each issue
- [x] Set `projectStatus` on each `GitHubIssue` during fetch enrichment
- [x] In `dashboard.tsx`: group issues by `projectStatus` instead of the current assigned/unassigned split
- [x] Section order: use the order from the project board (as returned by GraphQL)
- [x] Filter out terminal statuses: names matching `/(done|shipped|won't|wont|closed|complete)/i`
- [x] Issues with no project status default to "Backlog" section
- [x] Each status group is a `subHeader` row, collapsible independently

```typescript
// dashboard.tsx — section building
// Replace current "In Progress" / "Backlog" split with:
const statusGroups = groupBy(repoIssues, i => i.projectStatus ?? "Backlog");
const orderedStatuses = projectStatusOrder.filter(s => !isTerminalStatus(s));
for (const status of orderedStatuses) {
  rows.push({ type: "subHeader", text: status, count: statusGroups[status]?.length ?? 0 });
  for (const issue of statusGroups[status] ?? []) {
    rows.push({ type: "issue", issue, repoName });
  }
}
```

**1.3 Slack link detection**

- [x] Parse issue body for Slack URLs: `https://[^/]+\.slack\.com/archives/[A-Z0-9]+/p[0-9]+`
- [x] Store first match as `slackThreadUrl` on `GitHubIssue`
- [x] Show indicator in detail panel: `"Slack thread (s to open)"` when URL present
- [x] `s` key on issue with Slack link: attempt `slack://` deep link via `open` command, fall back to web URL
- [x] If no Slack link: `s` key does nothing (no error)
- [x] Multiple Slack URLs: first one opens; detail panel shows count `"Slack links: 3 (s opens first)"`

**1.4 Pick from board (`p` key)**

- [x] Wire existing `pickIssue()` from `pick.ts` into live mode
- [x] `p` on unassigned issue: calls pick flow (assign + TickTick sync)
- [x] `p` on already-assigned issue: show inline message `"Already assigned to @user"`
- [x] `p` on TickTick task: no-op (not applicable)
- [x] Show confirmation: `"Picked aibility#142 — assigned + synced to TickTick"` in status bar (3s)
- [x] Trigger immediate data refresh after pick completes
- [x] Handle pick failure: show error in status bar, no state change

#### Phase 2: Board Actions (~3-4 sessions)

New interaction patterns: inline text input, selection overlays, multi-select state, form overlays. Requires the UI state machine.

**2.0 UI State Machine (prerequisite)**

- [x] Create `use-ui-state.ts` hook managing board interaction states
- [x] States: `normal`, `search`, `overlay:comment`, `overlay:status`, `overlay:create`, `overlay:help`, `overlay:bulkAction`, `multiSelect`, `focus`
- [x] Transitions enforce rules: only one primary state, help stacks, Escape returns to previous
- [x] In overlay states: disable all navigation/action shortcuts except Escape, Enter, arrow keys
- [x] Refactor existing search mode to use the state machine
- [x] Create `use-actions.ts` hook for action dispatch (centralized error handling, status bar messages, post-action refresh)

**2.1 Quick comment (`c` key)**

- [x] `c` on GitHub issue: transitions to `overlay:comment` state
- [x] Shows inline text input at bottom of screen (similar pattern to search bar)
- [x] Enter submits: `gh issue comment <number> --body "<text>"`
- [x] Escape cancels: returns to normal state
- [x] Success: status bar shows `"Comment posted on #142"` (3s), trigger refresh
- [x] Failure: status bar shows error, input preserved for retry
- [x] `c` on TickTick task: no-op

**2.2 Change status (`m` key)**

- [x] `m` on GitHub issue: transitions to `overlay:status` state
- [x] Fetch available statuses for the issue's project (cache per-repo, refresh on board refresh)
- [x] Show status picker overlay: vertical list of non-terminal statuses
- [x] Current status highlighted/marked
- [x] j/k to navigate, Enter to select, Escape to cancel
- [x] On select: call `updateProjectItemStatus()` (existing function in `github.ts`)
- [x] Optimistic update: move issue to new section immediately
- [x] If issue has `completionAction` configured and status is terminal: trigger the configured action
- [x] `m` on issue not in a project: status bar shows `"Issue not in a project board"`
- [x] `m` on TickTick task: no-op

**2.3 Quick assign/unassign (`a`/`u` keys)**

- [x] `a` on unassigned issue: `gh issue edit <number> --add-assignee @me`
- [x] `a` on already-assigned issue: status bar shows `"Already assigned to @user"`
- [x] `u` on self-assigned issue: `gh issue edit <number> --remove-assignee @me`
- [x] `u` on issue assigned to someone else: status bar shows `"Assigned to @other — can only unassign self"`
- [x] Both trigger immediate refresh
- [x] `a`/`u` on TickTick task: no-op

**2.4 Multi-select + bulk operations**

- [x] `Space` on an item toggles selection (visual checkmark prefix)
- [x] Selection persists during j/k navigation
- [x] Selection clears on: Escape, action completion, search (/), refresh (r), entering overlay, changing repo section
- [x] Status bar shows count: `"3 selected"`
- [x] `Enter` with active selection: show action menu overlay
  - For GitHub issues: Assign all / Move status all / Unassign all
  - For TickTick tasks: Complete all / Delete all
  - Mixed selection: show only actions valid for all selected types
- [x] Bulk execution: continue on individual failure, show summary: `"4 assigned, 1 failed"`
- [x] Failed items remain selected for easy retry
- [x] After bulk action: full data refresh

**Constraint**: Multi-select within same repo only. Selection resets when navigating to a different repo section.

**2.5 Quick issue create (`n` key)**

- [x] `n` transitions to `overlay:create` state
- [x] Form overlay: title (text input, required), repo (select from tracked repos, pre-populated from current section)
- [x] Tab between fields, Enter to submit, Escape to cancel
- [x] Creates via `gh issue create --repo <owner/repo> --title "<title>" [--label "<label>"]`
- [x] Success: status bar shows `"Created <repo>#<number>"`, trigger refresh
- [x] Offer to immediately pick: `"Pick this issue? (y/n)"`

#### Phase 3: Command Center Polish (~2-3 sessions)

Higher-level features that enhance the board experience. Each is independent and can be implemented in any order.

**3.1 Activity timeline section**

- [x] New collapsible section at top of board: `"Recent Activity (last 24h)"`
- [x] Fetch via `gh api /repos/{owner}/{repo}/events` for each tracked repo (or issue timeline events)
- [x] Show last 10-15 items, format: `"10m ago: @user commented on aibility#142 — 'deployed to staging'"`
- [x] Activity types: comments, status changes, assignments, new issues, closures
- [x] GitHub-only (no TickTick activity — TickTick API doesn't expose this)
- [x] Updates on board refresh (not real-time)
- [x] Collapsed by default to not overwhelm

**3.2 Focus / Pomodoro mode (`f` key)**

- [x] `f` on any issue: transitions to `focus` state
- [x] Selected issue becomes "focused" — highlighted, all other items dimmed (chalk dim)
- [x] Timer starts with configured `focusDuration` (default 25min, configurable in `BoardConfig`)
- [x] Timer shows in header bar: `"Focus: aibility#142 — 23:45 remaining"`
- [x] User can still navigate (j/k) but visual emphasis stays on focused item
- [x] No other actions allowed during focus (pick, comment, etc. disabled)
- [x] Timer completion: terminal bell (`\x07`), status bar flash `"Focus complete!"`
- [x] End-of-timer prompt: Continue (restart) / Break (pause) / Done (mark complete) / Exit
- [x] Escape exits focus mode at any time
- [x] `f` on TickTick task: also works (focus is about the user, not the item type)
- [x] Add `focusDuration: number` (seconds) to `BoardConfig`, default `1500`

**3.3 Help overlay (`?` key)**

- [x] `?` toggles help overlay (can stack on any state)
- [x] Full-screen bordered box showing all keyboard shortcuts
- [x] Grouped by category: Navigation, View, Actions, Focus
- [x] Context-aware: current state shown at top, shortcuts available in current state highlighted vs. dimmed
- [x] Dismiss with `?` or Escape
- [x] Shortcuts NOT actionable from help overlay (view-only)

### Keyboard Binding Map (Complete)

```
Navigation (always available except in overlays):
  j / Down       Move down
  k / Up         Move up
  Tab            Jump to next section
  Shift+Tab      Jump to previous section

View:
  Enter          Toggle section (on header) / Open in browser (on item)
  Space          Toggle section (on header) / Toggle multi-select (on item)
  /              Enter search mode
  ?              Toggle help overlay (stacks on any state)
  Escape         Exit current state → normal

Actions (normal state only, GitHub issues only unless noted):
  p              Pick issue (assign + sync to TickTick)
  a              Assign issue to self
  u              Unassign self from issue
  c              Comment on issue
  m              Move status (status picker)
  s              Open Slack thread (if link detected)
  n              Create new issue (any context)
  f              Start focus mode (issues and tasks)

Board:
  r              Refresh data
  q              Quit
```

**Key context rules:**
- In search/comment/create input: all keys type characters, only Escape/Enter are special
- In overlay (status picker, help): only j/k/Enter/Escape work
- In focus mode: only Escape, r, q, ? work
- In multi-select: all normal shortcuts work, Enter opens bulk action menu

## Acceptance Criteria

### Functional Requirements

- [x] Issue body visible in detail panel for all issues with descriptions
- [x] Issues grouped by project status (fetched dynamically), not just assigned/unassigned
- [x] Terminal statuses (Done, Shipped, Won't Do) hidden from board
- [x] Slack URLs detected in issue body, openable with `s` key
- [x] Pick issue from board with `p` key (reuses existing flow)
- [x] Comment on issue with `c` key (inline input)
- [x] Change project status with `m` key (status picker)
- [x] Assign/unassign with `a`/`u` keys
- [x] Multi-select issues with Space, bulk actions with Enter
- [x] Create new issue with `n` key (form overlay)
- [x] Activity timeline shows recent cross-repo activity
- [x] Focus mode with configurable pomodoro timer
- [x] Help overlay shows context-aware keyboard shortcuts
- [x] All actions show confirmation/error feedback in status bar
- [x] Board refreshes after every mutation

### Non-Functional Requirements

- [x] Board startup time not degraded >500ms by additional fetches
- [x] Actions respond within 2s (network-dependent, show loading indicator)
- [x] No render loops or flicker from action state changes
- [x] Graceful degradation: missing project fields don't break board
- [x] Works in terminals >= 80 cols wide (detail panel hidden below 120)

### Quality Gates

- [x] All existing board functionality preserved (no regressions)
- [x] Each phase independently shippable
- [x] TypeScript strict mode, no `any` types in new code
- [x] Error paths tested: network failure, permission denied, missing project

## Success Metrics

- **Primary**: Can complete daily workflow (view, pick, comment, status change) without opening browser
- **Secondary**: Board startup time stays under 3s
- **Tertiary**: All keyboard shortcuts discoverable via `?` help overlay

## Dependencies & Prerequisites

- **Existing**: `gh` CLI authenticated, TickTick API configured, GitHub Projects set up with status fields
- **Per-repo config**: `statusFieldId` already in `RepoConfig` — needed for status mutations
- **No new dependencies**: All features use existing `gh` CLI, `@inkjs/ui`, and Ink

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Render loops from action state changes | High — happened before (commit b42642a) | Use state machine hook with explicit transitions, avoid derived state in useEffect deps |
| GraphQL rate limiting from status fetches | Medium — adds queries per repo | Cache project statuses per-repo, refresh only on manual 'r' |
| `execFileSync` blocking during actions | Medium — UI freezes during gh calls | Show "working..." indicator; consider async exec for Phase 2+ |
| Multi-select state complexity | Medium — interactions with search, refresh, overlays | Clear selection on any state change except navigation; explicit rules |
| Issue body size bloating fetch | Low — bodies can be large | Already fetching 100 issues; body adds ~1-5KB each. Monitor. Lazy-load if needed |

#### Phase 4: UX Refinements

**4.1 Collapsible status sub-sections**

Currently, status groups within a repo (e.g. "In Progress (3)", "Backlog (5)") are always-visible decorative sub-headers. This phase makes them collapsible, matching the behavior of top-level repo sections.

- [x] Promote status sub-headers from decorative rows (`navId: null`) to navigable items with `navId` (e.g. `sub:owner/repo:In Progress`)
- [x] Add status sub-headers to `buildNavItems` as a new `"subHeader"` type so they appear in the navigation list
- [x] Track collapsed state via the existing `useNavigation` toggle/collapse mechanism (reuse `isCollapsed(sectionId)`)
- [x] In `buildFlatRows`, skip child issues when a status sub-section is collapsed; show count in the sub-header label
- [x] Enter/Space on a status sub-header toggles its collapsed state (same UX as repo section headers)
- [x] Visual indicator: collapsed sub-headers show `▶` prefix, expanded show `▼`
- [x] Default state: all status sub-sections expanded (current behavior preserved)
- [x] Collapsed state persists during navigation but resets on data refresh (same as repo sections)
- [x] Works with multi-select: collapsing a sub-section does NOT deselect items in it (selection is by ID, not visibility)

**Files to modify:**
| File | Change |
|------|--------|
| `hog/src/board/components/dashboard.tsx` | Update `FlatRow` type, `buildNavItems`, `buildFlatRows`, `RowRenderer` for sub-header navigation + collapse |
| `hog/src/board/hooks/use-navigation.ts` | May need to support nested section IDs for sub-headers (or reuse existing flat toggle) |

## Future Considerations

Explicitly deferred (from brainstorm "NOT building yet"):
- AI-powered issue summaries
- Full Slack client integration (read/reply)
- Linked PR / CI status display
- GitHub notifications section
- Standup report generator
- Theme system (dark/light)
- Snapshot tests

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-15-hog-board-command-center-brainstorm.md`
- Prior plans: `docs/plans/2026-02-15-feat-hog-unified-task-dashboard-plan.md`, `docs/plans/2026-02-15-feat-hog-board-ux-improvements-plan.md`
- Board entry: `hog/src/board/live.tsx`
- Dashboard component: `hog/src/board/components/dashboard.tsx` (lines 310-334 for current key bindings)
- Data fetching: `hog/src/board/fetch.ts`
- GitHub API: `hog/src/github.ts` (lines 57-75 fetchRepoIssues, lines 157-218 fetchProjectTargetDates, lines 224-322 updateProjectItemStatus)
- Pick flow: `hog/src/pick.ts` (lines 103-146)
- Navigation hook: `hog/src/board/hooks/use-navigation.ts`
- Data hook: `hog/src/board/hooks/use-data.ts`
- Config: `hog/src/config.ts` (lines 40-46 HogConfig)
- Render loop fix: commit `b42642a`

### Design Decisions (from SpecFlow analysis)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| TickTick task actions | No GitHub-specific actions (comment, status, assign, pick). Focus mode works on tasks. Multi-select supports bulk complete/delete. | TickTick API doesn't support comments; other actions are GitHub-specific |
| Multi-select persistence | Cleared on search, refresh, action completion, Escape. Preserved during j/k navigation only. | Simple mental model — selection is ephemeral |
| Overlay stacking | One primary overlay at a time. Help (?) stacks on anything. | Prevents deadlocked UI states |
| Post-action refresh | Single actions: optimistic update + immediate refetch. Bulk: full refetch after completion. | User sees immediate feedback, data converges quickly |
| Action failure (bulk) | Continue on failure, show summary, keep failed items selected | User can retry failed items without re-selecting |
| Issue body rendering | Plain text (strip markdown), hard-wrap at panel width, 15 terminal lines | Keep it simple; full body available via `gh issue view` |
| Slack URL handling | First URL opens with 's', detail panel shows count | Most issues have 0-1 Slack links |
