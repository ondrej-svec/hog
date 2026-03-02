---
status: pending
priority: p2
issue_id: "049"
tags: [code-review, performance]
dependencies: []
---

# Triple getIssueWorkflow Call Per Render

## Problem Statement
`getIssueWorkflow` is called 3 times per render for the same selected issue in `dashboard.tsx`. Each call performs a full linear scan of `enrichment.sessions`, tripling computation cost with every render.

## Findings
- **File:** `src/board/components/dashboard.tsx` lines 769, 1504, 1513
- **Evidence:** Three separate calls to `workflowState.getIssueWorkflow(...)` for the same `selectedItem.issue` within a single render cycle
- **Impact:** Tripled computation cost for every render; performance degrades linearly as session count grows

## Proposed Solutions
### Option A: Memoize with useMemo (Recommended)
Compute the workflow result once per unique selected issue and reuse it across the render:
```typescript
const selectedIssueWorkflow = useMemo(() => {
  if (!selectedItem.issue || !selectedItem.repoName) return null;
  return workflowState.getIssueWorkflow(
    selectedItem.repoName,
    selectedItem.issue.number,
    selectedRepoConfig ?? undefined,
  );
}, [selectedItem.issue, selectedItem.repoName, selectedRepoConfig, workflowState]);
```
Replace the three call sites in lines 769, 1504, and 1513 with `selectedIssueWorkflow`.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] `getIssueWorkflow` is called at most once per unique issue per render cycle
- [ ] Workflow overlay still receives correct phases and `latestSessionId`

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
