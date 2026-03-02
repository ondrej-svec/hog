---
status: pending
priority: p3
issue_id: "062"
tags: [code-review, robustness]
dependencies: []
---

# Math.max Spread Risk on Large Arrays in use-auto-status

## Problem Statement
`Math.max(...newEvents.map(...))` in `src/board/hooks/use-auto-status.ts:117` will throw `RangeError: Maximum call stack size exceeded` if `newEvents` exceeds approximately 100K elements. Currently capped at 15 per repo but the pattern is fragile if the cap is ever raised.

## Findings
- **File:** `src/board/hooks/use-auto-status.ts` lines 117
- **Evidence:** Spread operator used with `Math.max` on an array whose size is controlled by a separate cap constant
- **Impact:** Theoretical stack overflow if event cap is ever raised significantly

## Proposed Solutions
### Option A: Replace with reduce (Recommended)
Replace the spread call with a `reduce`:
```typescript
const maxTs = newEvents.reduce((max, e) => Math.max(max, e.timestamp.getTime()), 0);
```
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] No `Math.max(...spread)` on potentially large arrays in `use-auto-status.ts`

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
