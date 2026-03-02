---
status: pending
priority: p2
issue_id: "055"
tags: [code-review, duplication]
dependencies: []
---

# Duplicate isClaudeInPath Function Defined in Two Modules

## Problem Statement
An identical `isClaudeInPath()` function is defined independently in both `src/board/launch-claude.ts` and `src/board/spawn-agent.ts`. Both implementations call `spawnSync("which", ["claude"])` with identical logic.

## Findings
- **File:** `src/board/launch-claude.ts` line 121
- **Evidence:** `function isClaudeInPath(): boolean { ... spawnSync("which", ["claude"]) ... }`
- **Impact:** DRY violation; if the implementation ever needs to change it must be updated in two places

- **File:** `src/board/spawn-agent.ts` line 128
- **Evidence:** Identical `function isClaudeInPath(): boolean { ... spawnSync("which", ["claude"]) ... }`
- **Impact:** `spawn-agent.ts` already imports from `launch-claude.ts`, so the duplication is unnecessary

## Proposed Solutions
### Option A: Export from launch-claude.ts, Import in spawn-agent.ts (Recommended)
Since `spawn-agent.ts` already imports from `launch-claude.ts`, consolidation requires only:
1. Export `isClaudeInPath` from `launch-claude.ts`
2. Remove the duplicate definition from `spawn-agent.ts`
3. Add `isClaudeInPath` to the existing import in `spawn-agent.ts`
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] Single definition of `isClaudeInPath` exists in the codebase (in `launch-claude.ts`)
- [ ] Both `launch-claude.ts` and `spawn-agent.ts` use the shared function

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
