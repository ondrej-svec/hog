---
status: pending
priority: p2
issue_id: 005
tags: [code-review, quality, performance]
dependencies: []
---

# Deduplicate Issue Lookup Logic

## Problem Statement

The pattern of finding a `BoardIssue` by number across repos is duplicated 3 times in the codebase. Each occurrence iterates all repos and their issues to find a match. This should be a shared utility function.

**Flagged by:** kieran-typescript-reviewer, performance-oracle, pattern-recognition-specialist

## Findings

- Same `repos.flatMap(r => r.issues).find(i => i.number === n)` pattern appears 3 times
- Used in: dashboard action handlers, zen mode, and other locations
- O(R*I) lookup each time — could use a Map for O(1)
- Three independent agents flagged this duplication

## Proposed Solutions

### Option 1: Extract `findIssueByNumber` utility + optional Map cache
- Create shared function in a utils module
- Optionally build a `Map<number, BoardIssue>` on data refresh for O(1) lookups
- **Pros:** Single source of truth, better performance
- **Cons:** Minor refactor
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [ ] Single `findIssueByNumber` function used everywhere
- [ ] No duplicated lookup logic
- [ ] Tests for the shared function

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Flagged by 3 agents |
