---
status: pending
priority: p2
issue_id: "034"
tags: [code-review, ux, error-handling, comment]
dependencies: []
---

# Comment input closes on failure, discarding user's text

## Problem Statement

When adding a comment fails (network error, GitHub API error), the comment input overlay
closes and the user's text is permanently lost. The `.finally()` block calls `onOverlayDone()`
unconditionally — it fires on both success and failure.

This is a UX regression: the user typed a comment, a transient error occurred, and now
they must re-type the entire comment from scratch.

## Findings

**`src/board/hooks/use-actions.ts` (handleComment, lines ~291–296):**
```typescript
execFileAsync("gh", [...])
  .then(() => {
    toast.info(`Comment added`);
    onOverlayDone();  // ← correct on success
  })
  .catch((err) => {
    toast.error(`Failed to add comment: ${formatError(err)}`);
  })
  .finally(() => {
    onOverlayDone();  // ← BUG: also closes on failure, discarding text
  });
```

The `.finally()` was likely added to ensure the overlay always closes, but it overrides
the desired behavior of keeping the overlay open on failure so the user can retry.

## Proposed Solutions

### Option 1: Move `onOverlayDone` to `.then()` only (Recommended)

```typescript
execFileAsync("gh", [...])
  .then(() => {
    toast.info(`Comment added`);
    onOverlayDone();   // only close on success
  })
  .catch((err) => {
    toast.error(`Failed to add comment: ${formatError(err)} — your text is preserved, press Enter to retry`);
    // overlay stays open; user can edit and retry
  });
  // no .finally()
```

This keeps the overlay open on failure. The user sees the error toast, their text remains,
and they can retry without retyping.

**Effort:** Very small (move one line)
**Risk:** Low — only changes failure behavior; success path unchanged

### Option 2: Keep close-on-failure but copy text to clipboard

On failure, copy the comment text to the clipboard before closing so it can be pasted.
More complex and requires clipboard access. Not recommended.

### Option 3: Show error inline in overlay

Display the error within the CommentInput overlay instead of (or in addition to) the toast.
Requires changes to `CommentInput` component props.

## Acceptance Criteria

- [ ] When comment creation fails, the comment input overlay stays open
- [ ] User's draft text is preserved after a failed comment attempt
- [ ] Error is shown via toast (or inline) with a message that explains retry is possible
- [ ] On success, overlay still closes normally
- [ ] `npm run test` covers the error path

## Work Log

- 2026-02-21: Identified by Architecture reviewer (R4).
