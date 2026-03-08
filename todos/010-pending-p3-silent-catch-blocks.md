---
status: pending
priority: p3
issue_id: 010
tags: [code-review, quality]
dependencies: []
---

# Review 46 Silent Catch Blocks

## Problem Statement

46 catch blocks silently swallow errors. While many are intentional (tmux pane operations, optional features), some may hide real bugs. A systematic review would identify which catches should log or report errors.

**Flagged by:** pattern-recognition-specialist

## Findings

- 46 empty/silent catch blocks across the codebase
- Tmux operations: intentionally silent (pane may be gone)
- gh CLI wrappers: some should probably log warnings
- Config operations: should probably surface errors

## Proposed Solutions

### Option 1: Categorize and selectively add logging
- Review each catch block
- Add debug logging where errors might hide bugs
- Keep intentionally-silent ones with comments explaining why
- **Effort:** Medium
- **Risk:** Low

## Acceptance Criteria

- [ ] Each silent catch reviewed and categorized
- [ ] Intentional silences documented with comments
- [ ] Potentially-hiding-bugs catches get logging

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | 46 instances to review |
