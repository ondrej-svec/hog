---
status: pending
priority: p1
issue_id: 001
tags: [code-review, bug, quality]
dependencies: []
---

# Terminal/Ghostty Launch Don't Pass Claude Command

## Problem Statement

The `launchInTerminal` and `launchInGhostty` functions in `launch-claude.ts` don't pass the configured `claudePrompt` command to Claude. Only `launchInIterm` correctly includes the prompt. This means users launching agents from non-iTerm terminals get a bare Claude session without the expected brainstorm workflow command.

**Flagged by:** kieran-typescript-reviewer, code-simplicity-reviewer

## Findings

- `launchInIterm()` correctly passes the command via AppleScript `write text`
- `launchInTerminal()` and `launchInGhostty()` open new windows but don't send the command
- Users on Terminal.app or Ghostty silently get degraded behavior with no error

## Proposed Solutions

### Option 1: Implement command passing for Terminal.app and Ghostty
- **Pros:** Full feature parity across all terminals
- **Cons:** Terminal.app AppleScript may be tricky; Ghostty may need different approach
- **Effort:** Small
- **Risk:** Low

### Option 2: Fall back to clipboard + notification
- **Pros:** Works universally
- **Cons:** Worse UX, requires manual paste
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option 1 — implement proper command passing for both terminals.

## Technical Details

- **Affected files:** `src/board/launch-claude.ts`
- **Functions:** `launchInTerminal()`, `launchInGhostty()`

## Acceptance Criteria

- [ ] `launchInTerminal()` sends the configured claude command after opening
- [ ] `launchInGhostty()` sends the configured claude command after opening
- [ ] Behavior matches `launchInIterm()` for all three terminals

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Found by 2 independent review agents |

## Resources

- PR: full codebase review
- File: `src/board/launch-claude.ts`
