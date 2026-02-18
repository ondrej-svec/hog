---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, ux, architecture]
---

# NL Create: `due:YYYY-MM-DD` label silently fails if not in repo

## Problem Statement

When a user types a due date in the NL create overlay (e.g., `fix bug due friday`), `buildLabelList` appends `due:2026-02-21` to the labels array. This is then passed to `gh issue create --label due:2026-02-21`. If that label doesn't exist in the target repo, the GitHub API rejects the entire call. The user completed the full NL flow and pressed Enter in the preview, only to see a toast error with no actionable guidance.

## Findings

- **File:** `src/board/components/nl-create-overlay.tsx`, lines 182–188
- **Root cause:** `buildLabelList` blindly appends `due:${parsed.dueDate}` without checking the label cache
- **Error surface:** `use-actions.ts handleCreateIssue` catches the error and shows a toast, but the message is generic
- **Flagged by:** Architecture reviewer (as "real UX footgun")

```typescript
function buildLabelList(parsed: ParsedIssue): string[] {
  const labels = [...parsed.labels];
  if (parsed.dueDate) {
    labels.push(`due:${parsed.dueDate}`);  // always added, never validated
  }
  return labels;
}
```

## Proposed Solutions

### Option A — Warn in preview if due label doesn't exist (Recommended)

In the preview render, check `labelCache[selectedRepo?.name ?? ""]` for any label starting with `due:`. If none exists, show a warning:

```tsx
{parsed.dueDate && !hasDueLabelInRepo ? (
  <Text color="yellow">⚠ No due:* label exists in this repo — will be skipped</Text>
) : null}
```

And in `buildLabelList`, conditionally include the label only if `hasDueLabelInRepo` is true (or pass it through to a separate `createDueLabelFirst` action).

**Pros:** User knows before pressing Enter. Good UX.
**Effort:** Medium. **Risk:** Low.

### Option B — Create the label automatically if missing

If `due:*` label doesn't exist, call `gh label create due:YYYY-MM-DD --repo ...` before creating the issue.

**Pros:** Fully automatic.
**Cons:** Creates many `due:*` labels in the repo over time; may not be desirable.
**Effort:** Medium. **Risk:** Medium.

### Option C — Omit due label silently with a toast note

Skip `due:*` from labels if not in cache, and show a toast: "Issue created (due date label not found in repo)".

**Pros:** Issue always created; user informed.
**Cons:** Silently drops user intent.
**Effort:** Small. **Risk:** Low.

## Recommended Action

Option A — warn in preview UI.

## Acceptance Criteria

- [x] If `due:*` label doesn't exist in repo, preview shows a warning before submission
- [x] User can still submit (with or without the due label per their choice)
- [x] `gh issue create` doesn't fail silently due to missing due label

## Work Log

- 2026-02-18: Identified by Architecture reviewer
- 2026-02-18: Resolved — added `hasDueLabelInCache` helper and yellow warning in preview when `due:*` label is absent from the repo cache
