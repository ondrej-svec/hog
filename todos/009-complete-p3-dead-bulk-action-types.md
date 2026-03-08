---
status: pending
priority: p3
issue_id: 009
tags: [code-review, quality, simplicity]
dependencies: []
---

# Remove Dead Bulk Action Types

## Problem Statement

The "complete" and "delete" bulk action types exist in the code but are unreachable. The `multiSelectType` is always "github" since TickTick multi-select was removed. This is dead code that adds unnecessary complexity.

**Flagged by:** code-simplicity-reviewer

## Findings

- Bulk action menu includes "complete" and "delete" options that are never reachable
- `multiSelectType` discriminator always resolves to "github"
- TickTick multi-select was removed but the type scaffolding remains

## Proposed Solutions

### Option 1: Remove dead code paths
- Remove unreachable bulk action types
- Simplify or remove `multiSelectType` discriminator
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [ ] No unreachable bulk action code paths
- [ ] Simplified multi-select type handling

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | YAGNI violation |
