---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, security, ux]
---

# NL labels not filtered against validLabels allowlist before gh submission

## Problem Statement

The heuristic parser extracts any `#word` token as a label and the LLM may also suggest labels. These are passed to `gh issue create --label <value>` without filtering against the fetched label allowlist. While `execFileAsync` prevents shell injection (args are array-passed), invalid labels cause `gh` to return a 422 error, failing the entire issue creation. The `validLabels` array is computed and passed to the LLM as a hint, but is **never used to filter the final label list**.

## Findings

- **File:** `src/board/components/nl-create-overlay.tsx` (useEffect, label construction)
- **File:** `src/board/hooks/use-actions.ts`, lines 328–333
- **Security reviewer finding:** Medium severity — not injectable but causes silent API failures
- The security reviewer confirmed: **no shell injection risk** (execFileAsync uses array args)

## Proposed Solutions

### Option A — Filter labels in NlCreateOverlay after parsing (Recommended)

In the `useEffect` after `extractIssueFields` resolves:

```typescript
const allValidLabels = selectedRepo
  ? (labelCache[selectedRepo.name] ?? []).map((l) => l.name)
  : [];

const filteredLabels = allValidLabels.length > 0
  ? result.labels.filter(l => allValidLabels.includes(l))
  : result.labels;

setParsed({ ...result, labels: filteredLabels });
```

Note: `due:YYYY-MM-DD` labels (added by `buildLabelList`) are separately handled in todo #006.

**Pros:** Invalid labels are silently dropped before user sees preview; no API failures.
**Effort:** Small. **Risk:** Low.

### Option B — Show invalid labels as warnings in preview

Mark unrecognized labels with a warning in the preview UI so the user can remove them manually.

**Pros:** User has full visibility.
**Cons:** More complex UI for an edge case.
**Effort:** Medium. **Risk:** Low.

## Recommended Action

Option A — filter before setting parsed state.

## Acceptance Criteria

- [x] Labels not in the repo's label list are not passed to `gh issue create`
- [x] User sees only valid labels in the preview
- [x] `npm run test` passes

## Work Log

- 2026-02-18: Identified by Security reviewer
- 2026-02-18: Resolved — labels filtered in useEffect `.then()` handler using `validLabels` captured via `parseParamsRef`
