---
status: pending
priority: p2
issue_id: "052"
tags: [code-review, lint]
dependencies: []
---

# eslint-disable Comment in Biome Project Has No Effect

## Problem Statement
`src/board/hooks/use-agent-sessions.ts:94` contains an `eslint-disable-next-line` comment, but the project uses Biome for linting, not ESLint. The suppression comment is completely ineffective.

## Findings
- **File:** `src/board/hooks/use-agent-sessions.ts` line 94
- **Evidence:** `// eslint-disable-next-line react-hooks/exhaustive-deps`
- **Impact:** The suppression does nothing; Biome does not read ESLint disable comments. This is inconsistent with the rest of the codebase convention and may mask a real lint warning that goes unaddressed.

## Proposed Solutions
### Option A: Replace with Biome Ignore Comment (Recommended)
Replace the ineffective ESLint comment with the correct Biome suppression syntax, including an explanation:
```typescript
// biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount to reconcile orphaned result files
```
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] No `eslint-disable` comments exist anywhere in the codebase (`grep -r eslint-disable src/` returns zero results)
- [ ] The Biome ignore comment includes a clear explanation for the suppression

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
