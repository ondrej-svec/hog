---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, bug, ux]
---

# NlCreateOverlay: submittedRef deadlock blocks retry after failure

## Problem Statement

In `nl-create-overlay.tsx`, once the user presses Enter in preview mode, `submittedRef.current` is set to `true` and `onSubmit` is called. If the parent keeps the overlay open (e.g., on `gh issue create` failure), the user sees a `createError` message but pressing Enter does nothing — `submittedRef.current` is permanently `true` for this mount lifecycle.

The user cannot retry without escaping and re-entering the NL create flow.

## Findings

- **File:** `src/board/components/nl-create-overlay.tsx`, lines 54–62
- **Root cause:** `submittedRef.current = true` is set before `onSubmit` is called, with no reset on failure path.
- **Impact:** After a failed `gh issue create`, user sees "Create failed: …" but cannot retry with Enter.

```tsx
if (key.return) {
  if (submittedRef.current) return;  // permanently blocked after first attempt
  submittedRef.current = true;
  // ...
  onSubmit(selectedRepo.name, parsed.title, labels.length > 0 ? labels : undefined);
  // If onSubmit fails and parent keeps overlay open → deadlock
}
```

## Proposed Solutions

### Option A — Always close overlay on submit (Recommended)

If `handleCreateIssue` always calls `onOverlayDone()` (which it currently does in `use-actions.ts` lines 345, 349), the overlay is always unmounted — making the deadlock impossible. Verify this is invariant and add a comment documenting the contract.

**Pros:** Zero code change in `nl-create-overlay.tsx`; enforces the contract at the action layer.
**Effort:** Small (verify + comment). **Risk:** None if contract holds.

### Option B — Reset submittedRef in error path

Have `onSubmit` accept a failure callback, or expose `createError` via the return channel:

```tsx
onSubmit(
  selectedRepo.name,
  parsed.title,
  labels.length > 0 ? labels : undefined,
);
// Reset ref so user can retry if overlay stays open
// (this is safe because the overlay is always closed on success by the parent)
```

Actually simpler: reset in a `useEffect` watching `createError`:
```tsx
useEffect(() => {
  if (createError) submittedRef.current = false;
}, [createError]);
```

**Pros:** Handles the case where overlay stays open.
**Effort:** Small. **Risk:** Could enable double-submit in edge cases.

## Recommended Action

Option A: verify that `handleCreateIssue` always calls `onOverlayDone()` and add a code comment. If ever that contract breaks, implement Option B.

## Acceptance Criteria

- [x] After a failed issue creation, user can press Enter again to retry (or overlay closes)
- [x] No double-submit possible
- [x] Code comment documents the "always close on submit" contract

## Work Log

- 2026-02-18: Identified by TypeScript reviewer
- 2026-02-18: Resolved — added comment above `submittedRef` documenting the contract (Option A)
