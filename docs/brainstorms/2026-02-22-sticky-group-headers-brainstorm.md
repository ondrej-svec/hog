# Sticky Group Headers + Scroll-Aware Tests

**Date:** 2026-02-22
**Status:** Decided — proceed to planning

## Problem

The tab-per-repo board (v1.9.x) introduced status group subHeaders (In Progress, Backlog, etc.) as visual dividers in the scrollable issue list. When the user navigates down into a large group, the subHeader scrolls off the top — the user loses context about which status group they're in.

Two attempted scroll-pullback approaches (v1.9.1, v1.9.2) both failed:
- v1.9.1: Only pulled back one row, only worked for the first issue in a group
- v1.9.2: Backward-search pullback, but breaks when group is larger than the viewport

Root cause: **scroll-based approaches are inherently fragile** for this use case. They fight the scroll engine and require special-casing that grows with edge cases.

Additionally, no tests exercise scroll behavior — tests use a huge viewport height so scrolling never triggers.

## What We're Building

### 1. Sticky Group Header

Pin the **current group's label** above the scrollable issue list as a fixed UI element. It updates as the selected issue changes group. The user always sees which status group they're in, regardless of scroll position.

Inspired by: LazyGit (always shows repo/branch context), file managers (always show current directory), terminal music players (always show current track).

### 2. Scroll-Aware Integration Tests

Add Dashboard-level integration tests that mock `stdout.rows` to a small value (e.g., 12) to force scrolling to occur. Navigate with `stdin.write("j")` keypresses, assert that the sticky header is always present in `lastFrame()` regardless of scroll depth.

## Why This Approach

**Sticky header wins because:**
- Always correct — header visibility is independent of scroll position
- Zero special-casing — no fragile "if scroll offset is at boundary, pull back" logic
- Industry standard — LazyGit, `less`, file pickers all use fixed context headers
- Simple to implement — separate rendered element above `flatRows`, not scroll logic
- Eliminates the entire bug class permanently

**Scroll tests win because:**
- Current test gap: viewport is too large, scroll bugs are invisible
- Reproduces the exact real-world failure mode
- Prevents regressions — sticky header correctness verifiable in CI

## Key Design Decisions

### Sticky Header Content
- Show: `{groupLabel} ({groupCount})` — e.g., `In Progress (3)`
- Show only when a tab has issues (hide for Activity tab — no groups)
- Derive from `flatRows`: find the last `subHeader` row at or before `selectedRowIdx`

### Layout Impact
- `CHROME_ROWS` increases by 1 (tab bar + sticky header + hint bar + header = 5 → 6)
- The sticky header occupies one row between the tab bar and the scrollable list
- When no group is active (Activity tab, Tasks tab with no groups) → render an empty Box

### Scroll Logic Simplification
- Remove the v1.9.1/v1.9.2 pullback logic entirely — no longer needed
- Keep the standard up/down scroll adjustment (keep selected item in viewport)
- SubHeader rows in `flatRows` remain as visual gap markers; they no longer need to be pulled into view

### Test Strategy
- Mock `process.stdout.rows = 12` in test setup (forces small viewport)
- Render Dashboard with minimal fixture data (1 group with 5+ issues)
- Simulate `stdin.write("j")` 4+ times to scroll past the subHeader
- Assert `lastFrame()` always contains the group label text
- Add one test per edge case: first issue, middle issue, last issue, cross-group navigation

## Resolved Questions

- **UX direction**: Sticky header chosen (vs. collapsible groups or always-visible flat list) ✓
- **Testing**: Scroll-aware integration tests alongside the fix ✓
- **Inspiration**: LazyGit/nvm approach — fixed context headers ✓

## Open Questions

None — ready to plan.

## Files to Change (Preliminary)

| File | Change |
|------|--------|
| `src/board/components/dashboard.tsx` | Add sticky header element; remove pullback logic; +1 CHROME_ROWS |
| `src/board/components/dashboard.test.tsx` | Add scroll-aware tests with mocked terminal height |
| `src/board/components/row-renderer.tsx` | Possibly extract group-label rendering for sticky header |
