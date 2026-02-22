---
title: "feat: Status sub-tabs two-level navigation"
type: feat
status: active
date: 2026-02-22
brainstorm: docs/brainstorms/2026-02-22-status-sub-tabs-brainstorm.md
---

# feat: Status sub-tabs two-level navigation

## Overview

Replace inline status group dividers ("Backlog", "In Progress" rows between issues) with a dedicated **status sub-tab bar** — a second tab row rendered below the existing repo tab bar. The issue list becomes fully flat: one status at a time, no dividers, no gaps.

This supersedes the v1.9.3 sticky group header (which is removed). Net chrome stays the same on repo tabs; Activity/Tasks gain a row.

```
1:aimee (63)  2:aibility (54)  3:Tasks (6)    ← repo tabs (Tab/Shift-Tab)
[► Backlog 52]  [In Progress 7]  [Planning 4]  ← status sub-tabs (s/S)
──────────────────────────────────────────────
  #96  Make compound-engineering-plugin
  #68  Establish Design PR Code Review
  #57  Standardize translation system
  ...fully flat, 52 issues, no dividers...
──────────────────────────────────────────────
j/k:nav  Tab:next-repo  s/S:next/prev-status  Enter:open  m:status ...
```

## Problem Statement

The board's inline status group rows break the list rhythm (visual noise), scroll away under the cursor (orientation loss), and provide no shortcut to jump between statuses (must scroll). Root cause: status is modeled as data (inline rows) rather than navigation (a UI dimension).

## Proposed Solution

Two-level tab navigation:

- **Top row (unchanged):** repo tabs — same `TabBar` component, same `Tab`/`Shift-Tab` keys
- **Second row (new):** status sub-tab bar — one tab per `BoardGroup`, `s`/`S` to cycle
- **Issue list (flat):** `buildFlatRowsForTab` filtered to the active status group only — no `subHeader`/`gap` rows emitted
- **Sticky header removed:** `stickyHeader` useMemo and its JSX block deleted; the sub-tab bar provides the same "where am I" context

## Key Design Decisions (from brainstorm)

| Decision | Choice |
|----------|--------|
| Status navigation dimension | Second tab row (not inline, not keyboard-only) |
| Issue list view | Flat — only active status group, no dividers |
| "All statuses" tab | No — each status is always isolated |
| Activity / Tasks tabs | Status row hidden entirely |
| Chrome rows (repo tab) | 6 (sticky header removed, status row added — net zero) |
| Chrome rows (Activity/Tasks) | 5 (one row gained for content) |
| Key bindings | `s` = next status, `S` = prev status |
| Slack key binding | Slack currently on `s` — **must be remapped** (see gotcha below) |
| Reset on repo-tab switch | Active status resets to first group |

## ⚠️ Critical Gotcha: `s` Key Conflict

`use-keyboard.ts:181` currently maps `s` → `handleSlack()` (open Slack URL for selected issue). The brainstorm assigns `s`/`S` to status tab navigation. **Slack needs a new key.**

Recommended remap: `o` (for "open external link") — Slack was a minor shortcut, `o` is mnemonically consistent with "open". Check `use-keyboard.ts` for conflicts before committing.

## Technical Approach

### New Data Types

```typescript
// In dashboard.tsx (module level)
interface StatusTab {
  id: string;    // BoardGroup.subId — e.g., "sub:aimee:Backlog"
  label: string; // BoardGroup.label — e.g., "Backlog"
  count: number; // BoardGroup.issues.length
}
```

### New/Modified Functions

**`buildStatusTabs(tabId: string, tree: BoardTree): StatusTab[]`** (new, `dashboard.tsx`)
- If `tabId` is `"activity"` or `"ticktick"`: return `[]`
- Find `BoardSection` where `sectionId === tabId`
- Map `section.groups` → `StatusTab[]`

**`buildFlatRowsForTab(tabId, tree, activeStatusId)` (modified)**
- Add `activeStatusId: string | null` parameter
- For repo tabId: filter to the single `BoardGroup` where `subId === activeStatusId` (or first group if null)
- Emit only `issue` rows for that group — **no `subHeader`, no `gap` rows**
- Activity/ticktick paths: unchanged

**`buildNavItemsForTab(tabId, tree, activeStatusId)` (modified)**
- Same `activeStatusId` filter — only nav items for the active group

### New Component: `status-tab-bar.tsx`

```typescript
// src/board/components/status-tab-bar.tsx
interface StatusTabBarProps {
  tabs: StatusTab[];
  activeTabId: string | null;
  totalWidth: number;
}

export function StatusTabBar({ tabs, activeTabId, totalWidth }: StatusTabBarProps) {
  // Renders: [► Backlog 52]  [In Progress 7]  [Planning 4]
  // Active tab: cyan/bold with ► prefix
  // Inactive tabs: gray
}
```

### State Changes in `Dashboard`

```typescript
// New state (parallel to activeTabId)
const [activeStatusId, setActiveStatusId] = useState<string | null>(null);

// Derived
const statusTabs = useMemo(
  () => buildStatusTabs(effectiveTabId, tree),
  [effectiveTabId, tree],
);
const effectiveStatusId = activeStatusId ?? statusTabs[0]?.id ?? null;
const activeStatusIdx = statusTabs.findIndex((t) => t.id === effectiveStatusId);

// Reset status on repo-tab change (useEffect)
useEffect(() => {
  setActiveStatusId(null);
}, [effectiveTabId]);

// Navigation callbacks
const nextStatus = useCallback(() => { ... }, [activeStatusIdx, statusTabs]);
const prevStatus = useCallback(() => { ... }, [activeStatusIdx, statusTabs]);
```

**Also reset `activeStatusId` in `handleFuzzySelect`** (the fuzzy repo-jump handler that calls `setActiveTabId`).

### CHROME_ROWS: Make Dynamic

```typescript
// Replace constant:
// const CHROME_ROWS = 6;

// With derived value:
const isRepoTab = (id: string | null) =>
  id !== null && id !== "activity" && id !== "ticktick";

const chromeRows = isRepoTab(effectiveTabId) ? 6 : 5;

// Update viewport calculation:
const viewportHeight = Math.max(5, termSize.rows - chromeRows - overlayBarRows - toastRows - logPaneRows);
```

### Keyboard Changes (`use-keyboard.ts`)

```typescript
// In UseKeyboardOptions, add:
statusNav: { next: () => void; prev: () => void } | null;

// In the input handler:
// REMOVE: if (input === "s") { handleSlack(); return; }
// ADD:
if (input === "s") { options.statusNav?.next(); return; }
if (input === "S") { options.statusNav?.prev(); return; }
// Slack remapped: if (input === "o") { handleSlack(); return; }
```

Pass `statusNav: { next: nextStatus, prev: prevStatus }` when calling `useKeyboard` in `dashboard.tsx`.

### Sticky Header Removal

- **Delete** `stickyHeader` useMemo (lines 628–635 in `dashboard.tsx`)
- **Replace** the sticky header `<Box>` JSX (lines 968–981) with `<StatusTabBar>` (conditional: only when `isRepoTab(effectiveTabId)`)

### Hint Bar Update (`hint-bar.tsx`)

Add `s:status` (or `s/S:status`) to normal mode hints. Replace Slack hint with new key.

### Help Overlay Update (`help-overlay.tsx`)

Add a "Status navigation" row to the keyboard shortcut table: `s / S` → "Next / prev status tab". Update Slack shortcut entry.

## Acceptance Criteria

- [ ] Status sub-tab bar renders below the repo tab bar on repo tabs
- [ ] Status sub-tab bar is hidden on Activity and Tasks tabs
- [ ] `s` cycles forward through status tabs; `S` cycles backward
- [ ] Active status tab is visually distinct (cyan, bold, `►` prefix)
- [ ] Issue list shows only issues from the active status group
- [ ] No inline `subHeader` or `gap` rows appear in the issue list
- [ ] Switching repo tabs resets status to the first group
- [ ] `j`/`k` navigation and cursor position work correctly in flat list
- [ ] Chrome row count: 6 on repo tabs, 5 on Activity/Tasks
- [ ] `s` no longer opens the Slack URL; Slack remapped to `o`
- [ ] Hint bar shows `s/S:status`; updated Slack hint
- [ ] Help overlay updated with status navigation entry
- [ ] Existing tests pass; new tests cover status tab navigation

## Implementation Plan

### Phase 1: Data layer (no UI)

1. Add `StatusTab` type
2. Add `buildStatusTabs(tabId, tree)` function
3. Add `activeStatusId` state + `statusTabs` derived value + `effectiveStatusId`
4. Add `useEffect` to reset `activeStatusId` on `effectiveTabId` change
5. Modify `buildFlatRowsForTab` + `buildNavItemsForTab` to accept + use `activeStatusId`
6. Make `chromeRows` dynamic

All existing tests should still pass (status = first group by default).

### Phase 2: Keyboard and key rebinding

1. Remap `s` → `statusNav.next`, `S` → `statusNav.prev` in `use-keyboard.ts`
2. Remap Slack to `o`
3. Add `statusNav` to `UseKeyboardOptions`
4. Pass `statusNav` from `dashboard.tsx` to `useKeyboard`

### Phase 3: UI — StatusTabBar component

1. Create `src/board/components/status-tab-bar.tsx`
2. Remove `stickyHeader` useMemo from `dashboard.tsx`
3. Replace sticky header `<Box>` JSX with `<StatusTabBar>` (conditionally rendered)
4. Import and use `StatusTabBar` in `dashboard.tsx`

### Phase 4: Polish

1. Update `hint-bar.tsx` — add `s/S:status`, update Slack hint
2. Update `help-overlay.tsx` — add status navigation entry, update Slack
3. Reset `activeStatusId` in `handleFuzzySelect` (when jumping via fuzzy repo picker)

### Phase 5: Tests

1. Add tests for `buildStatusTabs()`
2. Add tests for `buildFlatRowsForTab` with `activeStatusId` filtering
3. Add integration tests: `s` key cycles status tabs, list updates
4. Confirm `CHROME_ROWS` / viewport height tests for both tab types

## Files Changed

| File | Action | Change |
|------|--------|--------|
| `src/board/components/dashboard.tsx` | Modify | `activeStatusId` state; `buildStatusTabs()`; update `buildFlatRowsForTab`/`buildNavItemsForTab`; dynamic `chromeRows`; remove sticky header; add `<StatusTabBar>`; `statusNav` callbacks; pass to `useKeyboard` |
| `src/board/components/status-tab-bar.tsx` | **Create** | New component: `[► Backlog 52] [In Progress 7]` |
| `src/board/hooks/use-keyboard.ts` | Modify | `s`/`S` → status nav; `o` → Slack; add `statusNav` to options type |
| `src/board/components/hint-bar.tsx` | Modify | Add `s/S:status`; update Slack hint |
| `src/board/components/help-overlay.tsx` | Modify | Add status nav row; update Slack row |
| `src/board/components/dashboard.test.tsx` | Modify | Update tests; add status nav tests |

No changes needed: `row-renderer.tsx`, `use-navigation.ts`, `FlatRow` type, `tab-bar.tsx`.

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-02-22-status-sub-tabs-brainstorm.md`
- `buildFlatRowsForTab`: `src/board/components/dashboard.tsx:209–256`
- `buildNavItemsForTab`: `src/board/components/dashboard.tsx:190–207`
- `buildTabs()` (pattern to mirror): `src/board/components/dashboard.tsx:177–188`
- `TabBar` component (pattern to mirror): `src/board/components/tab-bar.tsx`
- `CHROME_ROWS`: `src/board/components/dashboard.tsx:296`
- Sticky header useMemo: `src/board/components/dashboard.tsx:628–635`
- Sticky header JSX: `src/board/components/dashboard.tsx:968–981`
- `s` → Slack conflict: `src/board/hooks/use-keyboard.ts:181`
- `FlatRow` type: `src/board/components/row-renderer.tsx:11–33`
- `BoardGroup` / `BoardSection` types: `src/board/components/dashboard.tsx:71–167`
- `activeTabId` state pattern: `src/board/components/dashboard.tsx:391–411`
- `statusGroups` config: `src/config.ts:34`
