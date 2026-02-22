---
title: "feat: lazygit-style 5-panel board layout"
type: feat
status: completed
date: 2026-02-22
brainstorm: docs/brainstorms/2026-02-22-lazygit-panel-layout-brainstorm.md
---

# feat: lazygit-style 5-panel board layout

## Overview

Redesign `hog board --live` from a tab-based single-column TUI to a **5-panel lazygit-inspired layout**. The board becomes a pure GitHub interface with a clear spatial hierarchy: Repos → Statuses → Issues, with a persistent Detail panel and a full-width Activity strip at the bottom.

TickTick is removed from the board display entirely and becomes invisible background infrastructure.

---

## Problem Statement

The current board uses a **horizontal tab bar** to switch between repos, with status groups as sub-tabs. This has several limitations:

1. **Hidden context**: You can only see one repo+status group at a time; the full landscape requires cycling through tabs
2. **No spatial model**: There is no persistent "what else is happening" view — activity and issue detail are overlays that hide the list
3. **TickTick noise**: The Tasks tab adds cognitive overhead for something that is fundamentally a sync engine, not a primary workflow
4. **Limited navigation**: `1-9` digit shortcuts jump to repo tabs, but with a multi-panel layout the same keys can focus panels — far more powerful

---

## Proposed Solution

Five named panels replace tabs entirely:

```
Wide (≥160 cols)
┌──────────────┬──────────────────────┬──────────────────────┐
│ [1] Repos    │                      │                      │
│ ▶ org/api   │   [3] Issues         │   [0] Detail         │
│   org/web   │   ▶ #142 Fix auth    │   #142 Fix auth bug  │
│   org/infra │     #143 Logging     │   State: open · @me  │
├──────────────┤     #144 Perf        │   Status: In Prog    │
│ [2] Statuses │                      │   ─────────────────  │
│ ▶ In Prog 6 │                      │   Body text...       │
│   Review  4  │                      │                      │
│   Backlog 2  │                      │   Comments (3):      │
├──────────────┴──────────────────────┴──────────────────────┤
│ [4] Activity (full width)                                  │
│ 2h @alice commented on #142 — "LGTM"          (org/api)   │
└────────────────────────────────────────────────────────────┘
 j/k move  p pick  m status  c comment  / search  ? help
```

---

## Technical Approach

### Architecture

**New files:**
| File | Purpose |
|------|---------|
| `src/board/hooks/use-panel-focus.ts` | Active panel state, panel-aware key routing |
| `src/board/components/panel-layout.tsx` | Responsive layout shell (3 breakpoints) |
| `src/board/components/repos-panel.tsx` | [1] Repos panel with cursor |
| `src/board/components/statuses-panel.tsx` | [2] Statuses panel with cursor |
| `src/board/components/activity-panel.tsx` | [4] Full-width bottom strip, navigable |

**Modified files:**
| File | Change |
|------|--------|
| `src/board/components/dashboard.tsx` | New layout structure, panel focus wiring |
| `src/board/hooks/use-keyboard.ts` | Panel focus bindings (1/2/3/4/0), remove tab/status cycle |
| `src/board/components/detail-panel.tsx` | Active/inactive border styling |
| `src/board/components/hint-bar.tsx` | Context-sensitive per focused panel |
| `src/board/components/row-renderer.tsx` | Remove task row |
| `src/board/fetch.ts` | Remove ticktick data from `DashboardData` (or stop passing it) |

**Deleted:**
| File | Reason |
|------|--------|
| `src/board/components/tab-bar.tsx` | Replaced by ReposPanel |
| `src/board/components/status-tab-bar.tsx` | Replaced by StatusesPanel |
| `src/board/components/task-row.tsx` | No longer rendered on board |

**Unchanged (reused as-is):**
- `src/board/components/issue-row.tsx`
- `src/board/components/detail-panel.tsx` (structure)
- `src/board/hooks/use-navigation.ts` (drives Issues panel [3] cursor)
- `src/board/hooks/use-actions.ts`
- `src/board/hooks/use-data.ts`
- `src/board/hooks/use-ui-state.ts`
- All overlay components

### Key Data Flow Change

**Current:** `activeTabId` (repo tab) + `activeStatusId` (status sub-tab) → `buildFlatRowsForTab`

**New:** `selectedRepoName: string | null` + `selectedStatusGroupId: string | null` → `buildFlatRowsForRepo`

The tab abstraction dissolves. Panel [1] owns `selectedRepoName`, panel [2] owns `selectedStatusGroupId`. Selecting in [1] resets [2] and [3] cursor. Selecting in [2] resets [3] cursor.

### Responsive Breakpoints

| Terminal width | Layout |
|----------------|--------|
| `≥ 160 cols` | Full: left col (Repos+Statuses) + center (Issues) + right (Detail) + bottom (Activity) |
| `100–159 cols` | Medium: left col (Repos+Statuses) + center (Issues, wider) + bottom (Activity); Detail hidden |
| `< 100 cols` | Stacked: Repos → Statuses → Issues → Activity (all full width, shorter heights) |

On medium (<160), Detail opens as a right-side overlay when `0` is pressed (same mechanism as current modal overlays).

---

## Implementation Phases

### Phase 1: `use-panel-focus` hook + panel numbers

**Goal:** Panel focus state lives in its own hook. Panels can be focused by number key. Focused panel has a bright border.

**Tasks:**
- [x] Create `src/board/hooks/use-panel-focus.ts`
  - `type PanelId = 0 | 1 | 2 | 3 | 4` (0=Detail, 1=Repos, 2=Statuses, 3=Issues, 4=Activity)
  - `activePanelId: PanelId` state (default `3` — Issues)
  - `focusPanel(id: PanelId): void`
  - `isPanelActive(id: PanelId): boolean`
- [x] Update `src/board/hooks/use-keyboard.ts`
  - In `canAct` block: digit keys `0`-`4` call `panelFocus.focusPanel(n)` (replaces `1-9 → tabNav.jumpTo`)
  - Remove `tabNav` parameter entirely
  - Remove `statusNav` parameter (s/S no longer cycles status sub-tabs)
  - `j`/`k` routing: dispatch to the hook corresponding to the active panel
- [x] Wire `use-panel-focus` into `dashboard.tsx`, pass to `useKeyboard`

**Tests:**
- `src/board/hooks/use-panel-focus.test.ts` — focus transitions, default state
- Update `src/board/hooks/use-keyboard.test.ts` if it exists

---

### Phase 2: New layout shell + Repos/Statuses panels

**Goal:** The left column exists with [1] Repos and [2] Statuses as navigable vertical lists. The existing issues list and detail panel continue to work (just repositioned).

**Tasks:**
- [x] Create `src/board/components/panel-layout.tsx`
  - Props: `cols: number` (from `termSize.cols`)
  - Renders 3 breakpoints based on `cols` (see thresholds above)
  - Left column: `<Box flexDirection="column" width={leftWidth}>`
    - `<Box height={reposPanelHeight} borderStyle="single">` for [1]
    - `<Box flexGrow={1} borderStyle="single">` for [2]
  - Center: `<Box flexGrow={1} flexDirection="column" borderStyle="single">` for [3]
  - Right: `<Box width={detailWidth} flexDirection="column" borderStyle="single">` for [0]
  - Bottom: `<Box height={activityHeight} borderStyle="single">` for [4]
  - Column widths: left ~20%, detail ~45%, center fills rest
  - Dim inactive panel borders, bright active panel border (use `borderColor` prop)
  - Stacked mode: full-width panels in `<Box flexDirection="column">`, fixed heights per panel

- [x] Create `src/board/components/repos-panel.tsx`
  - Props: `repos: Array<{ name: string; openCount: number }>`, `selectedName: string | null`, `isActive: boolean`, `height: number`
  - Renders a scrollable list of `org/repo    12` rows with `▶` cursor
  - Row format: `▶ org/repo  12` (active selected) / `  org/repo  12` (inactive)
  - Bold+cyan when panel is active, dim when inactive

- [x] Create `src/board/components/statuses-panel.tsx`
  - Props: `groups: Array<{ id: string; label: string; count: number }>`, `selectedId: string | null`, `isActive: boolean`, `height: number`
  - Same cursor rendering pattern as `repos-panel`
  - Shows "—" when no repo selected yet

- [x] Remove `<TabBar>` and `<StatusTabBar>` from `dashboard.tsx`
  - Replace with `<ReposPanel>` and `<StatusesPanel>` in the left column of `<PanelLayout>`

- [x] Add cursor state to `dashboard.tsx`:
  - `selectedRepoIdx: number` (default 0, index into `boardTree.sections`)
  - `selectedStatusIdx: number` (default 0, index into selected repo's groups)
  - These drive `selectedRepoName` / `selectedStatusGroupId`

**Column widths (chars) — reference:**
```
Wide (≥160):  left=24, issues=cols-24-detailWidth-2, detail=floor(cols*0.40)
Medium:       left=24, issues=cols-24-2 (detail hidden)
Stacked:      all full-width
```

---

### Phase 3: Data flow rewiring

**Goal:** `buildFlatRowsForTab` replaced. Issues panel [3] shows issues for `selectedRepo` + `selectedStatusGroup`. Selecting in [1] auto-selects the first status group in [2] and jumps focus back to [3].

**Tasks:**
- [x] Rename `buildFlatRowsForTab` → `buildFlatRowsForRepo` in `dashboard.tsx`
  - Signature: `(sections: BoardSection[], repoName: string | null, statusGroupId: string | null): FlatRow[]`
  - If no repo selected: render a prompt row `"Select a repo in panel [1]"`
  - If repo selected but no status group: show first group's issues by default

- [x] Rename `buildNavItemsForTab` → `buildNavItemsForRepo`
  - Signature: `(sections: BoardSection[], repoName: string | null, statusGroupId: string | null): NavItem[]`

- [x] Update `j/k` in `use-keyboard.ts` to route by active panel:
  - Panel 1: `reposNav.moveDown()` / `reposNav.moveUp()` (simple index state in dashboard)
  - Panel 2: `statusesNav.moveDown()` / `statusesNav.moveUp()`
  - Panel 3: `nav.moveDown()` / `nav.moveUp()` (existing `useNavigation`)
  - Panel 4: `activityNav.moveDown()` / `activityNav.moveUp()`
  - Panel 0: scroll detail body (new scroll offset for detail panel)

- [x] Update `Enter` routing:
  - Panel 1 Enter: set `selectedRepoIdx`, reset `selectedStatusIdx = 0`, focus panel 3
  - Panel 2 Enter: set `selectedStatusIdx`, focus panel 3
  - Panel 3 Enter: open issue in browser (existing behavior)
  - Panel 4 Enter: jump to issue — set `selectedRepoName` + cursor to issue in [3], focus panel 3

- [x] Delete `activeTabId` / `nextTab` / `prevTab` / `jumpToTab` state from `dashboard.tsx`
- [x] Delete `activeStatusId` / `nextStatus` / `prevStatus` state from `dashboard.tsx`
- [x] Delete `buildTabs()` and `buildStatusTabs()` functions

**Tests:**
- Add tests for `buildFlatRowsForRepo` covering: no-repo-selected, repo-selected-no-status, with issues, empty status group

---

### Phase 4: Activity panel promotion

**Goal:** Activity moves from a tab to [4], a persistent navigable full-width bottom strip.

**Tasks:**
- [x] Create `src/board/components/activity-panel.tsx`
  - Props: `events: ActivityEvent[]`, `isActive: boolean`, `height: number`, `width: number`, `selectedIdx: number`
  - Renders activity rows using existing `timeAgo()` + format logic (extract or inline from `RowRenderer`)
  - `▶` cursor when `isActive` — the currently selected event is highlighted
  - Shows "No recent activity" when empty
  - Scroll within fixed height (clip to `height` rows)

- [x] Add `activitySelectedIdx: number` state to `dashboard.tsx` (default 0)
- [x] Wire panel 4 `j/k` to `activitySelectedIdx` ± 1 (clamped)
- [x] Wire panel 4 `Enter` to jump:
  ```ts
  const event = tree.activity[activitySelectedIdx];
  if (event) {
    const repoIdx = sections.findIndex(s => s.repo.name.endsWith(event.repoShortName));
    if (repoIdx >= 0) {
      setSelectedRepoIdx(repoIdx);
      // find the issue in the repo's groups and set statusIdx
      // set issues cursor to that issue via nav.select(id)
      panelFocus.focusPanel(3);
    }
  }
  ```

- [x] Remove activity from `buildFlatRowsForRepo` (it was a tab before; now it's always the bottom panel)
- [x] Remove the "Activity" tab from `buildTabs()` (already deleted in Phase 3)

---

### Phase 5: TickTick removal from board

**Goal:** Board has zero TickTick UI. `pick` workflow is unchanged (silent sync).

**Tasks:**
- [x] Remove `ticktick` tab from `buildTabs()` (already gone in Phase 3)
- [x] Remove `TaskRow` usage from `RowRenderer` (keep `task-row.tsx` for non-board `hog task` command if used, otherwise delete)
- [x] Remove TickTick detail view from `DetailPanel` (the yellow-border task view, lines ~80-120 in `detail-panel.tsx`)
- [x] Remove `ticktick` case from `buildFlatRowsForTab`/`buildNavItemsForTab` (gone in Phase 3)
- [x] In `dashboard.tsx`: remove `allTasks` stable ref, stop passing tasks to hooks that don't need them
- [x] Verify `pick` action in `use-actions.ts` still silently syncs — no display changes needed, just confirm it doesn't reference any removed UI state
- [x] Update `HintBar` to remove any TickTick-specific hints

**Note:** `src/board/fetch.ts` `fetchDashboard()` can keep fetching TickTick data for `hog task` command compatibility — just stop passing `data.ticktick` to board components.

---

### Phase 6: Responsive + polish

**Goal:** All 3 breakpoints work cleanly. Hint bar is context-sensitive. Panel borders are styled correctly.

**Tasks:**

#### Responsive
- [x] Verify `<PanelLayout>` stacked mode (< 100 cols): panel heights proportional
  - Repos: `Math.max(3, repoCount + 2)` rows
  - Statuses: `Math.max(3, statusCount + 2)` rows
  - Issues: `rows - repos - statuses - activity - chrome` rows
  - Activity: 3 rows
- [x] Verify `<PanelLayout>` medium mode (100–159 cols): Detail hidden, Issues wider
  - Press `0` → opens `DetailPanel` as a right overlay (existing overlay mechanism with new `"overlay:detail"` mode in `UIMode`)
  - `Esc` closes it

#### Hint bar
- [x] Update `src/board/components/hint-bar.tsx`
  - Add `activePanelId: PanelId` prop
  - Context-sensitive hints per panel:
    ```
    Panel 1:  j/k move  Enter filter  ? help
    Panel 2:  j/k move  Enter filter  Esc clear  ? help
    Panel 3:  j/k move  p pick  m status  c comment  / search  n new  ? help
    Panel 4:  j/k scroll  Enter jump  r refresh  ? help
    Panel 0:  j/k scroll  Esc close  ? help
    ```

#### Panel borders
- [x] `<PanelLayout>` passes `isActive` to each panel component
- [x] Active panel: `borderStyle="single" borderColor="cyan"` (or bold white)
- [x] Inactive panel: `borderStyle="single" borderColor="gray"` (dimmed)
- [x] Panel label in top-left of border: `[1] Repos`, `[2] Statuses`, etc. (use `borderTopLeftLabel` if Ink supports it, otherwise a `<Box>` inside the border)

#### Misc polish
- [x] On startup: default to Issues [3] focused, first repo in [1] pre-selected, first status group in [2] pre-selected
- [x] Single-repo config: [1] Repos panel still shows but has only 1 row; consider auto-hiding it in stacked mode
- [x] Empty status group: Issues [3] shows "No issues in this status group" sub-header row
- [x] `r`/`R` global refresh works from any panel

---

## Alternative Approaches Considered

### A: Keep tabs, add Detail as persistent side panel
Incrementally add a persistent right panel without rearchitecting navigation. Lower risk, but doesn't solve the core "hidden landscape" problem — statuses still buried in sub-tabs.

### B: Single-panel with collapsible sections (no layout change)
Use the existing single-column list with repo→status→issues collapsible hierarchy (the old pre-sub-tab design). Simpler, but loses the spatial clarity and "always visible context" that the panel approach provides.

### C: Full lazygit clone (5 left panels + large right panel)
Put Repos, Statuses, Issues, Activity all in the left column (like lazygit's 5 left panels) with a huge right Detail panel. Rejected: Issues is the primary workspace and deserves the center column, not a cramped left panel.

**Chosen: 3-column grid + bottom strip** — Issues gets the most screen real estate, Detail is always visible on wide terminals, Repos+Statuses are compact navigation aids on the left, Activity is ambient context at the bottom.

---

## Acceptance Criteria

### Functional
- [x] `hog board --live` on ≥160 col terminal shows all 5 panels without any keypress
- [x] Pressing `1`/`2`/`3`/`4`/`0` changes the active panel — visible bright border change
- [x] `j`/`k` navigate within the focused panel's list
- [x] Selecting a repo in [1] (Enter) filters Issues [3] to that repo, auto-focuses [3]
- [x] Selecting a status in [2] (Enter) filters Issues [3] to that group, auto-focuses [3]
- [x] Activity panel [4] is navigable (j/k) and Enter jumps to the issue in [3] with correct repo+status selected
- [x] No TickTick rows appear anywhere on the board
- [x] `p` (pick) still works: assigns on GitHub + silently syncs TickTick if enabled
- [x] All existing issue actions work from Issues [3]: `p`, `m`, `c`, `a`, `n`, `I`, `l`, `e`, `f`, `y`, `o`
- [x] All overlays still function: create issue, status picker, comment, bulk actions, search, help, fuzzy picker

### Responsive
- [x] On terminal < 100 cols: all panels stack vertically, usable without horizontal scroll
- [x] On terminal 100–159 cols: 2-column layout (left + issues), Detail hidden, `0` opens it
- [x] Resizing terminal live (dragging window) transitions between breakpoints correctly

### Non-functional
- [x] TypeScript strict: no `any`, no `noUncheckedIndexedAccess` violations
- [x] Biome lint passes: `npm run check`
- [x] Tests pass: `npm run test`
- [x] All new hooks have unit tests
- [x] Performance: no new synchronous operations on render path

---

## Dependencies & Prerequisites

- None — this is a pure UI refactor. The data layer (`fetch.ts`, `github.ts`, `api.ts`) is unchanged.
- The pagination fix for `fetchProjectEnrichment` (cursor-based pagination) should be merged first to ensure status counts in [2] are accurate.

---

## Risk Analysis

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `dashboard.tsx` is already 1250 lines — adding more state makes it unwieldy | High | Phase 3 deletes ~150 lines of tab state; new panel panels are separate components |
| Ink's `<Box>` border clipping on very narrow terminals | Medium | Test with 60 and 80 col terminals; add minimum width constraints |
| Panel [0] Detail overlay on medium terminals — adds new UIMode | Low | Re-use existing overlay mechanism; add `"overlay:detail"` to UIMode |
| `use-keyboard.ts` routing by panel — complex dispatch logic | Medium | `use-panel-focus` hook isolates this concern; keyboard just reads `activePanelId` |
| Breaking the `1-9 → tab jump` keyboard behavior | Low | No external API; users will adapt; new behavior is strictly better |

---

## Future Considerations

- **Configurable column widths** — `config.json: { board: { layout: { leftWidth: 22, detailWidth: 45 } } }`
- **Panel visibility toggle** — hide specific panels (e.g., `H` to toggle Repos panel collapse)
- **Cross-repo issue view** — an "All repos" virtual entry in [1] that shows all issues across repos in [3]
- **Keyboard macro for Activity→Issue** — `ga` to jump to last activity item's issue

---

## References

### Internal
- Current layout logic: `src/board/components/dashboard.tsx:1023-1068`
- Detail panel gate: `src/board/components/dashboard.tsx:641`
- UIMode state machine: `src/board/hooks/use-ui-state.ts:5-19`
- Keyboard routing: `src/board/hooks/use-keyboard.ts:82-312`
- Multi-column Ink pattern: `src/board/components/dashboard.tsx:1023` (Box defaults to row)
- ActivityEvent type: `src/board/fetch.ts:18-25`
- `buildFlatRowsForTab`: `src/board/components/dashboard.tsx:233-269`
- TabBar component: `src/board/components/tab-bar.tsx`
- StatusTabBar component: `src/board/components/status-tab-bar.tsx`

### Design References
- lazygit layout: 5 left-column panels + large right Diff + bottom Command log
- Brainstorm: `docs/brainstorms/2026-02-22-lazygit-panel-layout-brainstorm.md`
