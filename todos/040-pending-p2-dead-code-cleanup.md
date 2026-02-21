---
status: pending
priority: p2
issue_id: "040"
tags: [code-review, dead-code, simplicity, yagni]
dependencies: []
---

# Dead code cleanup: handleUnassign, dismiss/dismissAll, updateProjectItemStatus duplication

## Problem Statement

Several pieces of code are fully implemented, tested, and exported — but never called in
production code. They bloat the codebase and create maintenance surface area for changes
that have no actual effect.

## Findings

**A — `handleUnassign` in use-actions.ts (~30 lines, never wired):**
The `handleUnassign` callback is exported from `useActions` and appears in the
`UseActionsResult` interface. Zero components or keyboard handlers ever call it.
The CLI `hog issue unassign` covers the unassign use case. This is a YAGNI violation.

**B — `dismiss` and `dismissAll` in use-toast.ts (~15 lines, never used in production):**
```typescript
// Exported from useToast but never destructured in dashboard.tsx or any component
return { toasts, toast, dismiss, dismissAll, handleErrorAction };
```
In `dashboard.tsx`: `const { toasts, toast, handleErrorAction } = useToast();`
Tests call these, but no production code does. The auto-dismiss mechanism is sufficient.

**C — `updateProjectItemStatus` sync/async duplication (~300 lines total):**
`updateProjectItemStatus` (sync, lines 430–528) and `updateProjectItemStatusAsync` (async,
lines 530–625) are near-identical ~95-line functions. `updateProjectItemDateAsync` (lines
636–728) repeats the same 3-step pattern a third time. Together they account for ~300 lines
for what is essentially one algorithm with 3 slight variations.

This is the single largest simplification opportunity in the codebase.

**D — `fetchProjectTargetDates` backward-compat wrapper (8 lines):**
```typescript
// github.ts line 341 — only used in tests, not in any production code
export function fetchProjectTargetDates(...) {
  return fetchProjectEnrichment(...);
}
```
Tests that use `fetchProjectTargetDates` should use `fetchProjectEnrichment` directly.

**E — `findSelectedUrl` in dashboard.tsx (8 lines):**
Used only in `handleOpen`. `findSelectedIssueWithRepo` returns the same issue, so
`found.issue.url` gives the URL. `findSelectedUrl` is a redundant linear scan.

**F — Minor dead code:**
- `const LEGACY_REPOS: RepoConfig[] = []` in `config.ts:73` — empty constant, inline `[]`
- `const repoArg = repo;` in `cli.ts:851` — redundant alias for `repo`

## Proposed Solutions

### Removals (in order of impact):

1. **Extract the 3-step GraphQL pattern** in `github.ts` into a shared `findProjectItem` helper (see todo 032). This collapses the sync/async duplication into ~40 lines.

2. **Remove `handleUnassign`** from `useActions` and `UseActionsResult`. Keep `unassignIssueAsync` in `github.ts` (it's used by the CLI).

3. **Remove `dismiss` and `dismissAll`** from `UseToastResult` public interface. Tests should rely on auto-dismiss timers instead.

4. **Update tests** that use `fetchProjectTargetDates` to use `fetchProjectEnrichment` directly, then delete the wrapper.

5. **Delete `findSelectedUrl`** from `dashboard.tsx`. Replace `handleOpen`:
   ```typescript
   const handleOpen = useCallback(() => {
     const found = findSelectedIssueWithRepo(repos, nav.selectedId);
     if (found) openInBrowser(found.issue.url);
   }, [repos, nav.selectedId]);
   ```

6. **Inline `LEGACY_REPOS` and `repoArg`.**

**Effort:** Medium for the GraphQL extraction (coordinate with 032), Small for others
**Risk:** Low — tests will confirm nothing breaks

## Acceptance Criteria

- [ ] `handleUnassign` removed from `use-actions.ts` and interface
- [ ] `dismiss`/`dismissAll` removed from `UseToastResult` public interface
- [ ] `updateProjectItemStatus` sync/async duplication collapsed (or tracked under 032)
- [ ] `fetchProjectTargetDates` wrapper removed; tests updated
- [ ] `findSelectedUrl` removed from `dashboard.tsx`
- [ ] `npm run ci` passes with no coverage regression

## Work Log

- 2026-02-21: Identified by Code Simplicity reviewer (P1 findings 4, 5), Architecture reviewer, Pattern reviewer.
