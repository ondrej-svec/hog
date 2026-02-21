---
status: pending
priority: p2
issue_id: "033"
tags: [code-review, architecture, github, abstraction]
dependencies: []
---

# use-actions.ts and edit-issue-overlay.tsx bypass github.ts wrappers with direct execFileAsync calls

## Problem Statement

The declared architecture convention is: "GitHub data always via `gh` CLI — always go through
`github.ts`." However, `use-actions.ts` and `edit-issue-overlay.tsx` call `execFileAsync("gh", ...)`
directly, bypassing the `github.ts` abstraction entirely. This means:
- Timeout defaults, encoding settings, and error handling are duplicated instead of centralized
- Future changes to the GitHub CLI invocation pattern must be made in two places
- `github.ts` is not the true single point of contact for GitHub mutations

## Findings

**`src/board/hooks/use-actions.ts`:**
```typescript
// Line ~316 — comment posting (addCommentAsync already exists in github.ts)
execFileAsync("gh", ["issue", "comment", "--repo", repoName, "--body", body, ...])

// Line ~430 — unassign (unassignIssueAsync already exists in github.ts)
execFileAsync("gh", ["issue", "edit", ..., "--remove-assignee", "@me"])

// Line ~474 — bulk unassign (same)
execFileAsync("gh", ["issue", "edit", ..., "--remove-assignee", "@me"])
```

**`src/board/components/edit-issue-overlay.tsx` lines 252–338:**
```typescript
// Title, body, label, assignee edits all via direct execFileAsync("gh", ["issue", "edit", ...])
// editIssueAsync already exists in github.ts
```

Functions that already exist in `github.ts` but are bypassed:
- `addCommentAsync(repoName, issueNumber, body)` — not used in `handleComment`
- `unassignIssueAsync(repoName, issueNumber)` — not used in `handleUnassign`
- `addLabelAsync(repoName, issueNumber, label)` — not used in label handlers
- `removeLabelAsync(repoName, issueNumber, label)` — not used
- `editIssueAsync(...)` — not used in `edit-issue-overlay.tsx`

## Proposed Solutions

### Option 1: Replace direct calls with github.ts wrapper calls (Recommended)

In `use-actions.ts`:
```typescript
// handleComment: replace execFileAsync("gh", ["issue", "comment",...]) with:
await addCommentAsync(repoName, issue.number, body);

// handleUnassign / bulk unassign: replace with:
await unassignIssueAsync(repoName, issue.number);

// label handlers: replace with:
await addLabelAsync(repoName, issue.number, label);
await removeLabelAsync(repoName, issue.number, label);
```

In `edit-issue-overlay.tsx`: delegate to `editIssueAsync`.

Also: remove the `const execFileAsync = promisify(execFile)` declarations from
`use-actions.ts` and `edit-issue-overlay.tsx` (they'd no longer be needed there).

**Effort:** Small–Medium
**Risk:** Low — the underlying `gh` calls are identical; just routing through the wrapper

### Option 2: Keep direct calls, add missing wrappers where github.ts lacks them

Some operations in `edit-issue-overlay.tsx` may not have wrappers in `github.ts`. If so,
add the missing wrappers first, then migrate.

## Acceptance Criteria

- [ ] `use-actions.ts` no longer contains `execFileAsync("gh", ...)` directly
- [ ] `edit-issue-overlay.tsx` no longer contains `execFileAsync("gh", ...)` directly
- [ ] All callers route through `github.ts` wrappers
- [ ] `npm run ci` passes

## Work Log

- 2026-02-21: Identified by Architecture reviewer (R1), Pattern reviewer (P2-3), Code Simplicity reviewer (12).
