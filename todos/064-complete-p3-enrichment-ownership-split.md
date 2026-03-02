---
status: pending
priority: p3
issue_id: "064"
tags: [code-review, architecture]
dependencies: []
---

# Enrichment Write Ownership Split Between useNudges and useWorkflowState

## Problem Statement
`useNudges` in `src/board/hooks/use-nudges.ts:84,91` calls `saveEnrichment()` directly, while `useWorkflowState` owns the in-memory enrichment state. Two hooks independently writing to the same file creates a potential write-ordering hazard if both hooks trigger in rapid succession.

## Findings
- **File:** `src/board/hooks/use-nudges.ts` lines 84, 91
- **Evidence:** `saveEnrichment` called in `use-nudges.ts` despite `use-workflow-state.ts` being the designated owner of enrichment state
- **Impact:** Possible stale state if both hooks trigger writes in rapid succession; unclear ownership makes future changes error-prone

## Proposed Solutions
### Option A: Route all writes through useWorkflowState (Recommended)
Add an `updateEnrichment(data)` function to `UseWorkflowStateResult`. Change `useNudges` to return updated enrichment data via callback instead of calling `saveEnrichment` directly.
- **Effort:** Medium
- **Risk:** Low

## Acceptance Criteria
- [ ] Only `useWorkflowState` calls `saveEnrichment`
- [ ] `useNudges` delegates persistence to its parent via callback

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
