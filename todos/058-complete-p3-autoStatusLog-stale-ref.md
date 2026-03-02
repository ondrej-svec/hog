---
status: pending
priority: p3
issue_id: "058"
tags: [code-review, react]
dependencies: []
---

# autoStatusLog Always-Stale Ref in use-auto-status

## Problem Statement
`autoStatusLogRef.current` in `src/board/hooks/use-auto-status.ts` is mutated in a `.then()` callback but has no `useState` setter. The returned `autoStatusLog` is always stale. Currently unused by consumers, making it dead API surface that would be buggy if consumed.

## Findings
- **File:** `src/board/hooks/use-auto-status.ts`
- **Evidence:** Ref mutated in async callback with no reactive update; returned value never reflects latest state
- **Impact:** Dead API surface; would be buggy if consumed

## Proposed Solutions
### Option A: Remove autoStatusLog from return type (Recommended)
Since no consumers use it, remove `autoStatusLog` from the hook's return type entirely.
- **Effort:** Small
- **Risk:** Low

### Option B: Switch to useState for reactive updates
If logging is needed in the future, switch from `useRef` to `useState` so the returned value is always current.
- **Effort:** Medium
- **Risk:** Low

## Acceptance Criteria
- [ ] Either `autoStatusLog` is removed from the hook's return type or made reactive via `useState`

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
