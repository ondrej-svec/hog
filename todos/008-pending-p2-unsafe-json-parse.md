---
status: pending
priority: p2
issue_id: 008
tags: [code-review, security, quality]
dependencies: []
---

# Unsafe JSON.parse Casts in github.ts

## Problem Statement

Multiple `JSON.parse()` calls in `github.ts` cast results directly to typed interfaces without runtime validation. If the `gh` CLI output format changes, these will silently produce incorrect data instead of failing with clear errors.

**Flagged by:** kieran-typescript-reviewer

## Findings

- Pattern: `JSON.parse(output) as SomeType` used throughout github.ts
- No Zod or runtime validation on gh CLI responses
- Config already uses Zod — same pattern should apply to API responses
- Risk: silent data corruption on gh CLI version changes

## Proposed Solutions

### Option 1: Add Zod schemas for gh CLI response shapes
- Define schemas for each response type
- Parse through Zod instead of raw `JSON.parse() as T`
- **Pros:** Runtime safety, clear error messages, consistent with config pattern
- **Cons:** More schemas to maintain
- **Effort:** Medium
- **Risk:** Low

### Option 2: Validate only critical fields
- Lightweight checks on essential fields without full Zod schemas
- **Pros:** Less boilerplate
- **Cons:** Incomplete validation
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [ ] All JSON.parse calls in github.ts validated at runtime
- [ ] Clear error messages on unexpected response shapes
- [ ] No `as` type assertions on parsed JSON

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Consistent with existing Zod config pattern |
