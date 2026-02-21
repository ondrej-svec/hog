---
status: pending
priority: p2
issue_id: "035"
tags: [code-review, testing, use-actions]
dependencies: []
---

# use-actions.ts has no test file despite being the most complex stateful hook

## Problem Statement

`src/board/hooks/use-actions.ts` (~711 lines) is the most complex stateful module in the
codebase: it handles 10+ async GitHub/TickTick mutations, optimistic updates, undo thunks,
and bulk operations. It has **no test file**. Every other hook in `src/board/hooks/` has
a corresponding test file:

- `use-navigation.test.tsx` ✓
- `use-ui-state.test.tsx` ✓
- `use-toast.test.tsx` ✓
- `use-multi-select.test.tsx` ✓
- `use-data.test.tsx` ✓
- `use-keyboard.test.tsx` ✓
- `use-action-log.test.tsx` ✓
- `use-actions.test.tsx` ✗ **MISSING**

## Findings

Key functions that have zero test coverage:
- `findIssueContext` — the core lookup helper (exported, directly testable)
- `handleStatusChange` — most-used mutation; has optimistic update + rollback logic
- `handleAssign` — mutates assignee, triggers sync state update
- `handleComment` — async, closes overlay (bug identified in 034)
- `handleBulkStatusChange` — complex multi-issue mutation with per-issue error handling
- `handleBulkAssign` / `handleBulkUnassign` — same
- `clearFailedMutations` — parses mutation IDs from navigation IDs

The `failedMutations` state + `pendingMutations` ref pattern (used for optimistic UI blocking)
is particularly subtle and untested.

## Proposed Solutions

### Option 1: Create use-actions.test.tsx following existing patterns

The pattern in other hook tests:
1. Use `renderHook` from `@testing-library/react` wrapped with an Ink test provider
2. Mock `execFile` (via `vi.mock`) for the `gh` CLI calls
3. Mock `github.ts` module functions (via `vi.mock`)
4. Test `findIssueContext` as a pure unit (it's exported)

Priority order for tests:
1. `findIssueContext` — pure unit, no mocks needed
2. `handleStatusChange` — happy path + rollback on error
3. `handleComment` — success closes overlay; failure keeps it open (verifies fix from 034)
4. `handleBulkStatusChange` — partial success scenario
5. `handleAssign` — success path

**Effort:** Medium (2–4 hours)
**Risk:** Zero — tests only

## Acceptance Criteria

- [ ] `src/board/hooks/use-actions.test.tsx` exists
- [ ] `findIssueContext` is unit-tested for null/issue/task/header ID cases
- [ ] `handleStatusChange` is tested for success and failure/rollback
- [ ] `handleComment` is tested to verify overlay stays open on failure (related to 034)
- [ ] Coverage threshold maintained at 80%

## Work Log

- 2026-02-21: Identified by Architecture reviewer (R5, P2 finding).
