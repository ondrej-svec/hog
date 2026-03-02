---
status: pending
priority: p3
issue_id: "060"
tags: [code-review, dead-code]
dependencies: []
---

# Dead findLatestSession Export in enrichment.ts

## Problem Statement
`findLatestSession` in `src/enrichment.ts:118-125` is exported but never imported anywhere. `use-workflow-state.ts` replicates its logic inline instead of importing the shared function.

## Findings
- **File:** `src/enrichment.ts` lines 118-125
- **Evidence:** Exported function with zero importers; duplicate logic exists inline in `use-workflow-state.ts`
- **Impact:** Dead code, maintenance confusion; if the logic is updated in one place the other diverges

## Proposed Solutions
### Option A: Delete the function and keep the inline logic
Remove `findLatestSession` from `enrichment.ts` since it has no importers.
- **Effort:** Small
- **Risk:** Low

### Option B: Import it in use-workflow-state.ts (Recommended)
Import `findLatestSession` in `use-workflow-state.ts` and replace the inline replica with the shared function.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] No unused exported functions in `enrichment.ts`

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
