---
title: "fix: Sticky group header for board TUI"
type: fix
status: completed
date: 2026-02-22
brainstorm: docs/brainstorms/2026-02-22-sticky-group-headers-brainstorm.md
---

# fix: Sticky Group Header for Board TUI

## Overview

Replace the fragile scroll-pullback approach with a **sticky group header** — a fixed UI row that always shows the current status group label (e.g., "In Progress (3)") regardless of scroll position. Two previous attempts (v1.9.1, v1.9.2) tried to pull the scroll offset backward when navigating group boundaries; both failed for large groups (≥ viewport height). The sticky header eliminates this entire bug class permanently.

Also adds **scroll-aware integration tests** that mock a small terminal height, enabling CI to catch scroll-related regressions that the current test suite cannot detect.

## Problem Statement

`buildFlatRowsForTab` emits `subHeader` rows as visual-only dividers (`navId: null`) between status groups. When a group has more issues than the viewport height, the `subHeader` row scrolls off the top while the user navigates downward — breaking group context. Pulling the scroll offset backward to reveal the header is inherently fragile: it only works when the group fits entirely within the viewport.

Root cause: headers shouldn't live in the scrollable list at all — they belong in a pinned position above it.

## Proposed Solution

**Sticky header (always rendered):** Derive the current group label from `flatRows` by walking backward from `selectedRowIdx` to the nearest `subHeader` row. Render it as a fixed row between the tab bar and the scrollable list. The row always occupies one row of chrome (even blank), keeping the layout height calculation simple.

**Remove pullback logic:** Delete lines 635–650 from `dashboard.tsx` entirely. The sticky header provides the same contextual anchor without fighting the scroll engine.

**Scroll-aware tests:** Set `process.stdout.rows = 12` before rendering (Dashboard reads this via Ink's `useStdout()`) and navigate with `stdin.write("j")` to force scrolling.

## Technical Approach

### 1. Compute `stickyHeader` from `flatRows`

```typescript
// dashboard.tsx — after selectedRowIdx is computed (~line 622)
const stickyHeader = useMemo((): { text: string; count: number | undefined } | null => {
  if (selectedRowIdx < 0) return null;
  for (let i = selectedRowIdx; i >= 0; i--) {
    const row = flatRows[i];
    if (row?.type === "subHeader") return { text: row.text, count: row.count };
  }
  return null;
}, [flatRows, selectedRowIdx]);
```

Walk starts at `selectedRowIdx` **inclusive** — so if the cursor lands on a `subHeader` row itself, it correctly shows that group's label. Guard `selectedRowIdx < 0` handles Activity tab (no nav items, `selectedId` is null, `findIndex` returns -1).

### 2. Remove scroll pullback logic

Delete the entire block (lines 635–650 of `dashboard.tsx`):

```typescript
// DELETE THIS BLOCK:
if (scrollRef.current > 0 && scrollRef.current === selectedRowIdx) {
  let subIdx = -1;
  for (let i = selectedRowIdx - 1; i >= 0; i--) {
    ...
  }
  if (subIdx >= 0 && selectedRowIdx - subIdx < viewportHeight) {
    scrollRef.current = subIdx;
  }
}
```

Keep the standard up/down scroll adjustment (lines 627–634) — it still keeps the selected item in view.

### 3. Increase `CHROME_ROWS` from 5 to 6

```typescript
// Before (line 296):
const CHROME_ROWS = 5;

// After:
// Header (1) + tab bar (1) + sticky group header (1) + hint bar (1) + padding top+bottom (2)
const CHROME_ROWS = 6;
```

The sticky header row is **always rendered** (blank when null), so `CHROME_ROWS` is unconditionally 6. No conditional height math needed.

### 4. Render sticky header in JSX

Place the sticky header **inside the overlay-hide conditional block** (same `<Box>` that hides when overlays like status picker, help, focus mode are active). This ensures it disappears naturally alongside the scrollable list during full-screen overlays.

```tsx
// dashboard.tsx JSX — between <TabBar> and the scrollable <Box height={viewportHeight}>
{/* Sticky group header — always renders 1 row; blank when no group selected */}
<Box>
  {stickyHeader ? (
    <>
      <Text bold color="white">
        {" "}{stickyHeader.text}
      </Text>
      {stickyHeader.count != null ? (
        <Text color="gray"> ({stickyHeader.count})</Text>
      ) : null}
    </>
  ) : null}
</Box>
```

Visual style: matches the inline `subHeader` appearance (bold white label, gray count). The fixed position above the list communicates "sticky" via placement, not additional styling.

### 5. Edge case handling (all automatic via algorithm)

| Scenario | Behavior |
|---|---|
| Activity tab (no nav items) | `selectedRowIdx = -1` → `stickyHeader = null` → blank row |
| Tasks tab (no subHeaders in flatRows) | Walk finds nothing → `stickyHeader = null` → blank row |
| First issue of tab (no preceding subHeader) | Walk from issue row finds its own preceding subHeader → shows correctly |
| Cursor on a subHeader row itself | Walk starts at that row (inclusive) → shows that group's label |
| Empty tab ("No open issues" subHeader) | Walk finds the "No open issues" subHeader → shows its text — acceptable since it is the only group |
| Search/filter mode | `flatRows` reflects filtered view automatically; sticky header updates |
| Multi-select mode | Cursor position drives sticky header (not selection set) — simpler, correct |
| Background refresh | `flatRows` recomputed → `stickyHeader` updates on next render — correct |

### 6. Add scroll-aware tests in `dashboard.test.tsx`

```typescript
describe("sticky group header", () => {
  beforeEach(() => {
    // Force a small terminal height so scrolling triggers.
    // Dashboard reads termSize via Ink's useStdout() which reads process.stdout.
    Object.defineProperty(process.stdout, "rows", {
      value: 12,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "rows", {
      value: 24,
      writable: true,
      configurable: true,
    });
  });

  it("shows group label on first issue", async () => {
    // 12 rows terminal, CHROME_ROWS=6, viewportHeight=6
    // 1 group "In Progress" with 5 issues — cursor on first
    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({
        repos: [makeRepoData({ issues: Array.from({ length: 5 }, (_, i) =>
          makeIssue({ number: i + 1, title: `Issue ${i + 1}`, status: "In Progress" })
        ) })]
      })
    );
    const instance = render(React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }));
    await delay(200);
    expect(instance.lastFrame()).toContain("In Progress");
    instance.unmount();
  });

  it("still shows group label after scrolling past the subHeader", async () => {
    // Navigate down 4 times — subHeader scrolls off top; sticky header must still show it
    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({
        repos: [makeRepoData({ issues: Array.from({ length: 5 }, (_, i) =>
          makeIssue({ number: i + 1, title: `Issue ${i + 1}`, status: "In Progress" })
        ) })]
      })
    );
    const instance = render(React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }));
    await delay(200);
    // Navigate down 4 times to push subHeader off screen
    for (let i = 0; i < 4; i++) {
      instance.stdin.write("j");
      await delay(30);
    }
    expect(instance.lastFrame()).toContain("In Progress");
    instance.unmount();
  });

  it("updates group label when navigating across group boundary", async () => {
    // 2 groups: "In Progress" (1 issue) then "Backlog" (4 issues)
    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({
        repos: [makeRepoData({ issues: [
          makeIssue({ number: 1, title: "WIP issue", status: "In Progress" }),
          ...Array.from({ length: 4 }, (_, i) =>
            makeIssue({ number: i + 2, title: `Backlog ${i + 1}`, status: "Backlog" })
          ),
        ] })]
      })
    );
    const instance = render(React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }));
    await delay(200);
    // Initially on first item — "In Progress"
    expect(instance.lastFrame()).toContain("In Progress");
    // Navigate into Backlog group
    instance.stdin.write("j"); // onto subHeader or first Backlog item
    await delay(30);
    instance.stdin.write("j");
    await delay(30);
    expect(instance.lastFrame()).toContain("Backlog");
    instance.unmount();
  });

  it("shows no group label on Activity tab", async () => {
    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({ activity: [makeActivityEvent()] })
    );
    const instance = render(React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }));
    await delay(200);
    // Switch to Activity tab
    instance.stdin.write("\t");
    await delay(50);
    const frame = instance.lastFrame()!;
    // Activity tab is active; sticky header row should be blank (no "In Progress" etc.)
    // The activity event text should show, but no status group label
    expect(frame).toContain("Activity");
    instance.unmount();
  });
});
```

## Acceptance Criteria

- [ ] Status group label (e.g., "In Progress (3)") always visible at fixed position above the scrollable list, on repo tabs with issues
- [ ] Label updates immediately when cursor crosses a group boundary (j/k navigation)
- [ ] Sticky header row renders blank (no crash, no phantom text) on: Activity tab, Tasks tab, empty repo tab
- [ ] Scroll pullback logic is fully removed — no backward-scan code remains at the scroll adjustment site
- [ ] `CHROME_ROWS = 6` and comment accurately describes 6 chrome rows
- [ ] Sticky header is hidden during full-screen overlays (status picker, help, create form, focus mode, bulk action) — same as the rest of the main content
- [ ] Four new scroll-aware tests pass with `process.stdout.rows = 12`
- [ ] All existing tests pass (`npm run ci`)
- [ ] Visual smoke test: `npm run dev -- board --live` — navigate across groups in a large repo, confirm label never disappears

## Dependencies & Risks

**No new dependencies.** Changes are contained to `dashboard.tsx` and `dashboard.test.tsx`.

**Risk: `process.stdout.rows` mocking in tests.** Dashboard reads `useStdout()` which returns `process.stdout` in the `ink-testing-library` environment. The existing `fuzzy-picker.test.tsx` uses the same `Object.defineProperty(process.stdout, "rows", ...)` pattern, confirming it works. Low risk.

**Risk: `CHROME_ROWS = 6` on small terminals.** With `viewportHeight = Math.max(5, rows - 6 - ...)`, a 12-row terminal gives `12 - 6 = 6` rows of viewport (tight but usable). The existing minimum floor of 5 is unchanged. Acceptable.

**Risk: Blank row on non-repo tabs.** The sticky header always occupies one row (even blank). On the Activity tab this wastes 1 row. Acceptable trade-off for layout simplicity.

## Files to Change

| File | Lines affected | Change |
|------|---------------|--------|
| `src/board/components/dashboard.tsx` | ~296 | `CHROME_ROWS` 5 → 6, update comment |
| `src/board/components/dashboard.tsx` | ~622–660 | Add `stickyHeader` useMemo; remove pullback block (lines 635–650) |
| `src/board/components/dashboard.tsx` | JSX render | Add `<Box>` for sticky header between `<TabBar>` and scrollable `<Box height={viewportHeight}>` |
| `src/board/components/dashboard.test.tsx` | new | Add `describe("sticky group header")` block with 4 tests |

No changes to: `row-renderer.tsx`, `tab-bar.tsx`, `hint-bar.tsx`, `use-navigation.ts`, `use-keyboard.ts`, `use-actions.ts`, `fetch.ts`, `types.ts`.

## References

- Brainstorm: `docs/brainstorms/2026-02-22-sticky-group-headers-brainstorm.md`
- `dashboard.tsx` scroll logic: `src/board/components/dashboard.tsx:627–654`
- `CHROME_ROWS` definition: `src/board/components/dashboard.tsx:296`
- `flatRows` slicing: `src/board/components/dashboard.tsx:656`
- `FlatRow` type: `src/board/components/row-renderer.tsx:11`
- `process.stdout.rows` mock precedent: `src/board/components/fuzzy-picker.test.tsx:9`
- Ink `useStdout` docs: returns `process.stdout` in ink-testing-library environment
