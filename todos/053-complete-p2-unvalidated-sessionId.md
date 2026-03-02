---
status: pending
priority: p2
issue_id: "053"
tags: [code-review, security]
dependencies: []
---

# Unvalidated sessionId Interpolated into Shell Commands

## Problem Statement
`sessionId` from Claude's stream-json output is accepted via an `as string` cast with no format validation, stored in enrichment, and later interpolated directly into `--resume ${sessionId}` in a shell command. A compromised or unexpected Claude binary output could inject malicious content.

## Findings
- **File:** `src/board/spawn-agent.ts` lines 62-63
- **Evidence:** `sessionId` parsed with `as string` cast from stream-json output; no format or length validation before storage
- **Impact:** `sessionId` is later interpolated into `--resume ${sessionId}` at `dashboard.tsx:959`. A compromised Claude binary could emit a `sessionId` containing newlines or shell-special characters, potentially causing command injection issues in the iTerm AppleScript launch path.

## Proposed Solutions
### Option A: Validate sessionId Against a Safe Pattern (Recommended)
Validate the sessionId as alphanumeric with allowed safe separators before accepting it:
```typescript
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
if (sessionId && SESSION_ID_RE.test(sessionId)) {
  state.sessionId = sessionId;
}
```
Invalid sessionIds are silently discarded; the resume feature simply does not activate.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] `sessionId` is validated against a safe alphanumeric pattern before being stored
- [ ] Invalid or unexpected sessionIds are silently discarded without error
- [ ] Valid sessionIds continue to work correctly for `--resume` invocation

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
