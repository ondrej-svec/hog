---
status: pending
priority: p3
issue_id: "056"
tags: [code-review, dead-code]
dependencies: []
---

# branchPattern Config Field Dead Code

## Problem Statement
`branchPattern` in `AUTO_STATUS_SCHEMA` (`src/config.ts:39`) is defined but never consumed. `extractIssueNumbersFromBranch` in `fetch.ts:128` accepts a `pattern` parameter but is called without it.

## Findings
- **File:** `src/config.ts` lines 39
- **Evidence:** `branchPattern` field exists in `AUTO_STATUS_SCHEMA` but is never read by any caller
- **Impact:** Users who configure a custom branch pattern will see it silently ignored

## Proposed Solutions
### Option A: Wire branchPattern through (Recommended)
Pass `branchPattern` from config through to `extractIssueNumbersFromBranch` at the call site in `fetch.ts`.
- **Effort:** Small
- **Risk:** Low

### Option B: Remove the field
Remove `branchPattern` from `AUTO_STATUS_SCHEMA` entirely until the feature is actually implemented.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] `branchPattern` is either wired through to `extractIssueNumbersFromBranch` or removed from schema

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
