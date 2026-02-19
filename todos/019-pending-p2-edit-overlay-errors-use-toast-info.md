---
status: pending
priority: p2
issue_id: "019"
tags: [code-review, ux, edit-issue-overlay]
dependencies: []
---

# EditIssueOverlay uses onToastInfo for field errors (should be toast.error)

## Problem Statement

`src/board/components/edit-issue-overlay.tsx` reports field-level save failures using `onToastInfo(...)` which routes to `toast.info`. Info toasts appear as gray/dimmed text in the ToastContainer. Errors should be red to visually distinguish them as failures. This is a UX inconsistency: the user performs a save, one field fails, and they see a gray informational message that looks like a success confirmation.

## Findings

- `src/board/components/edit-issue-overlay.tsx`: Multiple `onToastInfo(...)` calls in catch blocks:
  - Line ~261: `onToastInfo(\`Failed to update title on #${issue.number}\`)`
  - Line ~274: `onToastInfo(\`Failed to update body on #${issue.number}\`)`
  - Line ~288: `onToastInfo(\`Failed to update status on #${issue.number}\`)`
  - Line ~305: `onToastInfo(\`Failed to update labels on #${issue.number}\`)`
  - Line ~342: `onToastInfo(\`Failed to update assignee on #${issue.number}\`)`
- `src/board/hooks/use-toast.ts`: `toast.error` creates a red non-dismissing toast
- `src/board/hooks/use-actions.ts`: Uses `t.reject(...)` (which becomes `toast.error`) for all mutation failures — established pattern

## Proposed Solutions

### Option 1: Pass onToastError and use it for failures

Add `onToastError: (msg: string) => void` to `EditIssueOverlayProps` (matching `onToastInfo`), pass it from `overlay-renderer.tsx` and `dashboard.tsx`, and replace the `onToastInfo` calls in catch blocks with `onToastError`.

**Effort:** 30 minutes
**Risk:** Low

### Option 2: Add onToastError prop pointing to toast.error

Same as option 1 but pass `toast.error` as `onToastError`.

## Acceptance Criteria

- [ ] Field save failures appear as red error toasts, not gray info toasts
- [ ] At least one success message still uses info toast (e.g., "No changes made")
- [ ] `npm run check` passes
- [ ] `npm run test` passes

## Work Log

- 2026-02-19: Identified by pattern-recognition-specialist during code review.
