---
status: pending
priority: p2
issue_id: 007
tags: [code-review, agent-native]
dependencies: []
---

# Add `config set` CLI Command

## Problem Statement

Currently at 87.5% agent-native parity (28/32 capabilities). The most critical gap is the missing `config set` command — agents cannot programmatically modify configuration. Users must manually edit `~/.config/hog/config.json`.

**Flagged by:** agent-native-reviewer

## Findings

- `hog config show` exists (read-only)
- No way to set individual config values via CLI
- Agents need this to configure repos, assignee, refresh interval, etc.
- Would complete a key user workflow loop for automation

## Proposed Solutions

### Option 1: `hog config set <path> <value>`
- Dot-notation path (e.g., `board.assignee`, `board.refreshInterval`)
- Validate via Zod schema before writing
- **Pros:** Simple, scriptable, agent-friendly
- **Cons:** Complex nested paths need careful handling
- **Effort:** Medium
- **Risk:** Low (Zod validation prevents invalid state)

## Acceptance Criteria

- [ ] `hog config set board.assignee foo` works
- [ ] Validates against Zod schema
- [ ] Supports `--json` output
- [ ] Invalid paths/values produce clear errors

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Critical agent-native gap |
