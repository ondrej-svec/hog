# 026: Fix Module-Level Entry ID Counter in use-action-log.ts (P3 - Nice-to-Have)

**Status:** Pending
**Priority:** P3 (Nice-to-Have)
**Issue ID:** 026
**Tags:** code-review, testing, use-action-log
**Created:** 2026-02-19

---

## Problem Statement

`src/board/hooks/use-action-log.ts` exports a `nextEntryId()` function that relies on a module-level mutable counter:

```typescript
let entryIdCounter = 0;

export function nextEntryId(): number {
  return ++entryIdCounter;
}
```

This creates two issues:

1. **Non-deterministic test behavior:** The counter persists across test cases within a test file (module is loaded once per test file in Vitest). Tests that depend on specific ID values or sequences may exhibit flaky behavior depending on test execution order or previous test state.

2. **Tight coupling:** `use-actions.ts` and `edit-issue-overlay.tsx` are tightly coupled to action-log internals. They must import and call `nextEntryId()` directly, creating a hidden dependency on the action-log module's internal state.

---

## Findings

### 1. Current ID Generation Pattern
- **Location:** `src/board/hooks/use-action-log.ts`
- **Pattern:** Module-level `let entryIdCounter = 0` incremented on each call
- **Usage:** Imported by `use-actions.ts` and `edit-issue-overlay.tsx`
- **Risk:** Counter never resets between tests; accumulated state pollutes subsequent tests

### 2. Tests Potentially Affected
- **Test files using `nextEntryId()`:** `*.test.ts` or `*.test.tsx` files in `src/board/`
- **Risk symptoms:**
  - Tests pass in isolation but fail when run with others
  - ID values in assertions depend on test execution order
  - Snapshot tests have unstable snapshot hashes due to changing IDs

### 3. Design Coupling
- **Caller pattern:** `const entryId = nextEntryId()` in multiple files
- **Implication:** Action-log state management is spread across multiple modules
- **Maintainability:** Adding features (e.g., ID prefixes, scoping) requires changes in multiple places

---

## Proposed Solutions

### Option A: Inject Counter (Recommended for P3)
1. Refactor `use-action-log.ts` to accept an optional ID generator function parameter
2. Default behavior: use module-level counter (backward compatible)
3. In tests: inject a fresh counter factory (resets per test)
4. Example:
   ```typescript
   export function useActionLog(options?: { idGenerator?: () => number }) {
     const generateId = options?.idGenerator ?? nextEntryId;
     // ... use generateId() instead of nextEntryId()
   }
   ```
5. Update tests to pass `idGenerator: () => { let id = 0; return ++id; }` per test
6. Estimated effort: 2–3 hours

### Option B: Context-Based ID Generation (More Robust)
1. Create an `ActionLogContext` (React Context) that holds ID generator state
2. `<ActionLogProvider>` wraps the application and provides `idGenerator` to all descendants
3. In tests: wrap test components with a `<ActionLogProvider>` that resets per test
4. Remove module-level counter entirely; all ID generation goes through Context
5. Benefit: Enables future scoping (e.g., separate ID sequences per board instance)
6. Estimated effort: 3–4 hours; higher upside for future extensibility

### Option C: Keep Current, Reset in Setup (Simplest)
1. Keep module-level counter as-is
2. In test setup (via `beforeEach` or test runner config), reset counter: `entryIdCounter = 0`
3. Requires importing and resetting `entryIdCounter` (may need to export it as `resetEntryIdCounter()`)
4. Least invasive but doesn't address coupling concern
5. Estimated effort: 30 minutes

---

## Acceptance Criteria

- [ ] `nextEntryId()` produces deterministic results in tests (same ID sequence on repeated runs)
- [ ] Tests no longer have order-dependent behavior related to ID generation
- [ ] If Option A or B chosen: ID generation is decoupled from module state
- [ ] All existing tests pass
- [ ] New tests added to verify ID counter behavior (determinism, uniqueness)
- [ ] No regression in action-log functionality or performance
- [ ] Code review approved

---

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Initial findings and options. Recommend Option B for extensibility, but Option A is faster. |

---

## Related Issues

- See also: #024 (CLI simplifications), #027 (action-log persistence)

## References

- `src/board/hooks/use-action-log.ts` — nextEntryId() definition
- `src/board/hooks/use-actions.ts` — consumer of nextEntryId()
- `src/board/components/edit-issue-overlay.tsx` — consumer of nextEntryId()
- `src/board/hooks/use-action-log.test.ts` — tests for use-action-log
