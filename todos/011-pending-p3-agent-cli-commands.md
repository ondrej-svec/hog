---
status: pending
priority: p3
issue_id: 011
tags: [code-review, agent-native]
dependencies: [007]
---

# Add Missing Agent-Native CLI Commands

## Problem Statement

Two CLI commands are missing for full agent-native parity: `issue comments` (list/read comments) and `issue open` (open in browser). These would complete the remaining agent capability gaps.

**Flagged by:** agent-native-reviewer

## Findings

- `hog issue comments <number>` — agents can't read issue discussion
- `hog issue open <number>` — agents can't trigger browser open
- Current parity: 87.5% (28/32 capabilities)
- With `config set` (007) + these: would reach ~97%

## Proposed Solutions

### Option 1: Add both commands to CLI
- `hog issue comments <number>` — wraps `gh issue view --comments`
- `hog issue open <number>` — wraps `gh issue view --web`
- Both support `--json` output
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [ ] `hog issue comments <number>` lists comments
- [ ] `hog issue open <number>` opens in browser
- [ ] Both support `--json` flag

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Would bring parity to ~97% |
