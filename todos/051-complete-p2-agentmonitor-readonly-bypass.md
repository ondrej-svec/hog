---
status: pending
priority: p2
issue_id: "051"
tags: [code-review, typescript]
dependencies: []
---

# AgentMonitor Readonly Contract Bypassed via Type Casts

## Problem Statement
`AgentMonitor` interface in `src/board/spawn-agent.ts` declares all fields `readonly`, but `attachStreamMonitor` mutates them using 6 type casts to bypass the TypeScript readonly contract. This hides mutable shared state behind a readonly facade.

## Findings
- **File:** `src/board/spawn-agent.ts` lines 233-270
- **Evidence:** `AgentMonitor` interface with all `readonly` fields; `attachStreamMonitor` mutates via `(state as { field: Type }).field = value` casts — 6 such casts in the function body
- **Impact:** Type safety violation; TypeScript's readonly guarantee is meaningless at the call sites; mutations are invisible to callers who hold an `AgentMonitor` reference

## Proposed Solutions
### Option A: Split into Private Mutable and Public Readonly Types (Recommended)
Declare a private mutable type for internal use, export only the `Readonly<>` view to consumers:
```typescript
interface MutableAgentMonitor {
  sessionId: string | undefined;
  status: AgentStatus;
  lastOutput: string;
  startedAt: Date | undefined;
  completedAt: Date | undefined;
  error: string | undefined;
}

export type AgentMonitor = Readonly<MutableAgentMonitor>;

// Inside spawn-agent.ts, work with MutableAgentMonitor; expose as AgentMonitor
```
`attachStreamMonitor` operates on `MutableAgentMonitor` directly without any casts.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] No `as` casts used to bypass readonly on `AgentMonitor` fields
- [ ] External consumers still see all fields as readonly
- [ ] `attachStreamMonitor` compiles without type overrides or casts

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
