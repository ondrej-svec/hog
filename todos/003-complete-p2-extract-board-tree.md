---
status: pending
priority: p2
issue_id: 003
tags: [code-review, architecture, quality]
dependencies: []
---

# Extract board-tree.ts from Dashboard

## Problem Statement

`dashboard.tsx` is ~1650 lines. ~290 lines are pure functions (`buildNavItems`, `buildFlatRows`, `buildBoardTree`, sorting/grouping logic) that have no React dependencies. These should be extracted to a dedicated `board-tree.ts` module for testability and clarity.

**Flagged by:** kieran-typescript-reviewer, architecture-strategist, code-simplicity-reviewer

## Findings

- `buildNavItems()`, `buildFlatRows()`, `buildBoardTree()` are pure data transforms
- They take `DashboardData` and produce navigable row structures
- Currently untestable in isolation (buried in a 1650-line component file)
- Three independent review agents flagged this same extraction

## Proposed Solutions

### Option 1: Extract to `src/board/board-tree.ts`
- Move all pure tree-building functions to dedicated module
- Add unit tests for the extracted functions
- **Pros:** Immediately testable, reduces dashboard.tsx by ~290 lines
- **Cons:** Minor refactor effort
- **Effort:** Small-Medium
- **Risk:** Low

## Technical Details

- **Source file:** `src/board/components/dashboard.tsx`
- **Target file:** `src/board/board-tree.ts`
- **Functions to extract:** `buildNavItems`, `buildFlatRows`, `buildBoardTree`, related helpers

## Acceptance Criteria

- [ ] Pure functions extracted to `board-tree.ts`
- [ ] Unit tests for extracted functions
- [ ] Dashboard imports and uses extracted functions
- [ ] No behavior changes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Flagged by 3 agents |
