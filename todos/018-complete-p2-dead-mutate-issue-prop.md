---
status: pending
priority: p2
issue_id: "018"
tags: [code-review, quality, edit-issue-overlay]
dependencies: []
---

# Remove dead mutateIssue prop from EditIssueOverlayProps

## Problem Statement

`src/board/components/edit-issue-overlay.tsx` declares a `mutateIssue` prop in its interface (lines 28-32) but never destructures or calls it in the component body. It is dead code that inflates the public API surface and misleads callers into thinking passing the prop has an effect.

```typescript
// Declared (lines 28-32)
readonly mutateIssue?: (
  repoName: string,
  issueNumber: number,
  updates: Partial<GitHubIssue>,
) => void;

// Never used in component body — not even destructured
```

## Findings

- `src/board/components/edit-issue-overlay.tsx:28-32`: prop declared but not destructured at line 151 (component function signature)
- `src/board/components/overlay-renderer.tsx`: does not pass `mutateIssue` to `EditIssueOverlay` at all
- After editing, the overlay calls `onDone()` and relies on the auto-refresh in Dashboard to update issue state — no optimistic update is performed
- The prop appears to be an unimplemented intent for future optimistic updates

## Proposed Solutions

### Option 1: Remove the prop (recommended)

Delete lines 28-32 from `EditIssueOverlayProps`. If optimistic updates are planned, document that intent in a comment above `onDone`.

**Pros:** Cleaner API, no misleading surface
**Cons:** If optimistic updates are added later, prop needs to be re-added
**Effort:** 5 minutes
**Risk:** None

### Option 2: Implement the prop

Add optimistic update logic in the `finally` block or after successful gh calls.

**Pros:** Better UX (immediate visual feedback without waiting for refresh)
**Cons:** Complex interaction with action log and auto-refresh
**Effort:** 2-3 hours
**Risk:** Medium

## Acceptance Criteria

- [ ] `mutateIssue` removed from `EditIssueOverlayProps` interface
- [ ] `npm run check` passes (no lint/type errors)
- [ ] `npm run test` passes

## Work Log

- 2026-02-19: Identified during code review. Both TypeScript reviewer and architecture strategist flagged this.
