---
status: pending
priority: p2
issue_id: 004
tags: [code-review, architecture, quality]
dependencies: []
---

# Extract use-launch-orchestration.ts from Dashboard

## Problem Statement

~250 lines of agent launch orchestration logic (terminal detection, claude prompt construction, tmux pane management on launch) live inline in dashboard.tsx. This should be extracted to a dedicated hook for clarity and testability.

**Flagged by:** kieran-typescript-reviewer, architecture-strategist, code-simplicity-reviewer

## Findings

- `handleLaunchClaude` and related logic is complex (~250 lines)
- Involves terminal detection, command construction, tmux orchestration
- Mixed with React rendering concerns in dashboard.tsx
- Already partially extracted (`useZenMode`), but launch orchestration remains inline

## Proposed Solutions

### Option 1: Extract `useLaunchOrchestration` hook
- Move all launch-related logic into `src/board/hooks/use-launch-orchestration.ts`
- **Pros:** Clean separation, testable, reduces dashboard.tsx
- **Cons:** Another hook to wire up
- **Effort:** Small-Medium
- **Risk:** Low

## Technical Details

- **Source file:** `src/board/components/dashboard.tsx`
- **Target file:** `src/board/hooks/use-launch-orchestration.ts`

## Acceptance Criteria

- [ ] Launch orchestration extracted to dedicated hook
- [ ] Dashboard uses the hook
- [ ] No behavior changes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Flagged by 3 agents |
