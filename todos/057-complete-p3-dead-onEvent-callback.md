---
status: pending
priority: p3
issue_id: "057"
tags: [code-review, dead-code]
dependencies: []
---

# Dead onEvent No-op Callback in use-agent-sessions

## Problem Statement
`onEvent` callback in `src/board/hooks/use-agent-sessions.ts:157-159` is a no-op stub with a misleading comment. `attachStreamMonitor`'s `onEvent` parameter is optional, making this dead code with a comment that implies it does something meaningful.

## Findings
- **File:** `src/board/hooks/use-agent-sessions.ts` lines 157-159
- **Evidence:** No-op function body passed where `undefined` would be equivalent; comment misleads readers
- **Impact:** Dead code, misleading comment

## Proposed Solutions
### Option A: Pass undefined instead (Recommended)
Replace the no-op callback with `undefined`: `attachStreamMonitor(child, undefined, onExit)`.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] No-op `onEvent` callback removed
- [ ] `attachStreamMonitor` called with `undefined` for onEvent

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
