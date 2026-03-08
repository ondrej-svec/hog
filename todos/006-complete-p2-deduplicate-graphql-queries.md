---
status: pending
priority: p2
issue_id: 006
tags: [code-review, quality]
dependencies: []
---

# Deduplicate GraphQL Query Patterns

## Problem Statement

The "find project item by issue number" GraphQL query pattern is duplicated 4 times across `github.ts`. Field value extraction logic is also duplicated. These should be consolidated into shared helpers.

**Flagged by:** kieran-typescript-reviewer, pattern-recognition-specialist

## Findings

- Same GraphQL query structure for finding project items appears 4 times
- Field value extraction (`singleSelectValue`, etc.) duplicated
- Each copy slightly differs in which fields are requested
- Risk of queries drifting out of sync

## Proposed Solutions

### Option 1: Extract shared query builder + field extractor
- Create `buildProjectItemQuery()` and `extractFieldValue()` helpers
- **Pros:** DRY, consistent queries, easier to update schema
- **Cons:** Abstraction layer
- **Effort:** Medium
- **Risk:** Low

## Acceptance Criteria

- [ ] Single query builder for project item lookups
- [ ] Shared field value extraction
- [ ] No duplicated GraphQL patterns
- [ ] Existing tests still pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Flagged by 2 agents |
