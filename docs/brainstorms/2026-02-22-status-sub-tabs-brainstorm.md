# Status Sub-Tabs: Two-Level Navigation

**Date:** 2026-02-22
**Status:** Decided — proceed to planning

## Problem

The board currently displays status groups as inline dividers within the scrollable issue list ("Backlog", "In Progress", "Planning" rows between issue rows). This creates three compounding problems:

1. **Visual noise**: divider rows break the list rhythm and consume space
2. **Orientation loss**: when you scroll, even the sticky group header (v1.9.3) only tells you where you ARE, not where other groups are or how to get to them
3. **No status navigation**: Tab cycles repos but there's no way to jump directly to "In Progress" issues — you scroll

Root cause: status is modeled as data (inline rows) rather than navigation (a UI dimension you move through).

## What We're Building

A **two-level tab navigation system**:
- **Top row (existing)**: repo tabs — `1:aimee (63)  2:aibility (54)  3:Tasks (6)`
- **Second row (new)**: status sub-tabs — `[► Backlog 52]  [In Progress 7]  [Planning 4]`

Within each status sub-tab, the issue list is **completely flat** — no inline subHeader rows, no gaps, no group dividers. Just issues. One status at a time, always isolated.

```
1:aimee (63)  2:aibility (54)  3:Tasks (6)    ← repo tabs (Tab/Shift-Tab)
[► Backlog 52]  [In Progress 7]  [Planning 4]  ← status sub-tabs (s/S)
──────────────────────────────────────────────
  #96  Make compound-engineering-plugin
  #68  Establish Design PR Code Review
  #57  Standardize translation system
  #31  Dark mode
  ...fully flat, 52 issues, no dividers...
──────────────────────────────────────────────
j/k:nav Tab:next-repo s/S:next-status Enter:open m:status ...
```

## Why This Approach

- **Mental model clarity**: "I am in aimee / Backlog" — two dimensions, both explicit in the UI
- **Eliminates the scroll problem**: inline subHeaders don't exist, so they can't scroll away
- **Replaces sticky header**: the active status tab provides the same "where am I" context, plus navigation. The v1.9.3 sticky header becomes redundant and is removed (frees a chrome row on repo tabs)
- **Consistent with existing pattern**: status tabs work exactly like repo tabs — same selection model, same flat list, same detail panel behavior

## Key Design Decisions

### Status Tab Content
- One tab per status group (respects `statusGroups` config — merged groups are one tab)
- Order follows `statusGroups` order, or auto-detected order from status field positions
- Count shown in brackets: `[► In Progress 7]` — active tab highlighted in cyan/bold
- No "All" tab — each status is always isolated

### Activity and Tasks Tabs
- Status sub-tab row **hides entirely** on Activity and Tasks tabs (no status groups)
- CHROME_ROWS: 6 for repo tabs (with status row), 5 for Activity/Tasks (no status row)
- `s`/`S` keys do nothing when on Activity/Tasks tab

### Sticky Header Removal
- The v1.9.3 sticky group header is **removed** — the status sub-tab bar supersedes it
- Net chrome: repo tab → 6 rows still (removed sticky header, added status tab row)
- Non-repo tab → 5 rows (1 row gained for content — Activity/Tasks get more space)

### Key Bindings
- `s` — next status tab (cycles forward within active repo)
- `S` (Shift+s) — previous status tab
- Tab / Shift-Tab — existing repo tab navigation (unchanged)
- `j`/`k` — navigate issues within active status tab
- Scroll resets to top + cursor to first issue when switching status tabs

### Issue List (Flat)
- `buildFlatRowsForTab` for a repo tab now takes BOTH `tabId` and `activeStatusId`
- Returns only issue rows for the matching status group — no subHeader rows, no gap rows
- `buildNavItemsForTab` similarly filtered to that status group

### Keyboard Shortcut for Status Jump (optional / future)
- Status tabs don't get 1-9 numeric shortcuts (those are for repo tabs)
- `s`/`S` cycle is sufficient — status count per repo is usually 2-5

## Implementation Impact

| File | Change |
|------|--------|
| `dashboard.tsx` | Add `activeStatusId` state; `buildStatusTabs()`; update `buildFlatRowsForTab`/`buildNavItemsForTab` to filter by status; add `<StatusTabBar>` in JSX; remove sticky header; update CHROME_ROWS logic |
| `components/status-tab-bar.tsx` | New component — renders `[► Backlog 52]  [In Progress 7]` row |
| `hooks/use-keyboard.ts` | Add `s`/`S` → `statusNav.next/prev` |
| `components/hint-bar.tsx` | Add `s:next-status` to normal mode hints |
| `components/help-overlay.tsx` | Add status navigation to shortcut table |
| `dashboard.test.tsx` | Update existing tests, add status tab navigation tests |

No changes to: `row-renderer.tsx`, `use-navigation.ts`, `FlatRow` union (subHeader rows simply not emitted for repo tab + status view).

## Resolved Questions

- **Navigation dimension**: status is a second tab dimension ✓
- **Isolation**: each status tab shows only its issues (no "All" tab) ✓
- **Non-repo tabs**: status row hides entirely on Activity/Tasks ✓
- **Two-level tab model**: repo on top, status below ✓

## Open Questions

None — ready to plan.
