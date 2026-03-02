---
status: pending
priority: p2
issue_id: "048"
tags: [code-review, performance, react]
dependencies: []
---

# Unstable onEnrichmentChange Callback Causes Spurious Re-renders

## Problem Statement
In `src/board/components/dashboard.tsx:444`, `onEnrichmentChange` is an inline arrow function recreated on every render. This destabilizes memoized callbacks in `use-nudges.ts` and triggers unnecessary disk I/O by ignoring the provided `EnrichmentData` argument.

## Findings
- **File:** `src/board/components/dashboard.tsx` lines 444
- **Evidence:** `() => workflowState.reload()` — inline arrow function passed as prop, recreated every render
- **Impact:** Invalidates `snooze` and `dismissNudge` `useCallback` hooks in `use-nudges.ts:77-92`; causes spurious re-renders on every keypress

- **File:** `src/board/hooks/use-nudges.ts` lines 77-92
- **Evidence:** `snooze` and `dismissNudge` callbacks list `onEnrichmentChange` as a dependency; they invalidate whenever `onEnrichmentChange` changes
- **Impact:** Unnecessary disk round-trip on every re-render because `reload()` re-reads from disk instead of using the already-provided updated data

## Proposed Solutions
### Option A: Wrap in useCallback (Recommended)
Stabilize the callback reference with `useCallback`:
```typescript
const handleEnrichmentChange = useCallback(() => workflowState.reload(), [workflowState]);
```
- **Effort:** Small
- **Risk:** Low

### Option B: Use Provided Data Directly
Pass the updated enrichment data directly instead of triggering a disk reload:
```typescript
const handleEnrichmentChange = useCallback(
  (updated: EnrichmentData) => workflowState.setEnrichment(updated),
  [workflowState],
);
```
Add a `setEnrichment` method to `UseWorkflowStateResult`. Eliminates the disk round-trip entirely.
- **Effort:** Medium
- **Risk:** Low

## Acceptance Criteria
- [ ] `onEnrichmentChange` is stable across renders (same reference unless dependencies change)
- [ ] Nudge snooze/dismiss callbacks do not invalidate on unrelated re-renders

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
