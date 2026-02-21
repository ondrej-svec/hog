---
status: pending
priority: p1
issue_id: "029"
tags: [code-review, typescript, react, memoization, immutability]
dependencies: []
---

# GitHubIssue objects mutated in-place breaking React memoization

## Problem Statement

`src/board/fetch.ts` mutates `GitHubIssue` objects returned from `runGhJson` by writing
`targetDate`, `projectStatus`, `body`, and `slackThreadUrl` directly onto them. These
are the same object references that flow into React state. React's `useMemo`/`useCallback`
use referential equality — mutating in-place means `useMemo` sees the same reference and
skips re-computation even though the data changed, or conversely, triggers stale renders.

## Findings

**`src/board/fetch.ts` lines 156–179:**
```typescript
// Enrichment step mutates the raw GitHubIssue objects in place
for (const issue of rd.issues) {
  const e = enrichMap.get(issue.number);
  if (e?.targetDate) issue.targetDate = e.targetDate;   // mutation
  if (e?.projectStatus) issue.projectStatus = e.projectStatus;  // mutation
  if (e?.body) issue.body = e.body;  // mutation
  const slackUrl = extractSlackUrl(issue.body ?? "");
  if (slackUrl) issue.slackThreadUrl = slackUrl;  // mutation
}
```

`GitHubIssue` has no `readonly` modifiers despite being treated as immutable throughout
the application. `BoardIssue` (in `types.ts`) correctly uses `readonly` everywhere.

**Impact:** If a consumer caches a reference to a `GitHubIssue` before enrichment runs
(e.g., via `useMemo` on a stale input), it will see the post-enrichment mutation
without React detecting the change. Inverse: if enrichment modifies the object reference
in the worker, the memoized result in the UI thread sees the old pre-enrichment data.

## Proposed Solutions

### Option 1: Construct new objects during enrichment (Recommended)

```typescript
const enriched = rd.issues.map((issue): GitHubIssue => {
  const e = enrichMap.get(issue.number);
  const slackUrl = extractSlackUrl(e?.body ?? issue.body ?? "");
  return {
    ...issue,
    ...(e?.targetDate !== undefined && { targetDate: e.targetDate }),
    ...(e?.projectStatus !== undefined && { projectStatus: e.projectStatus }),
    ...(e?.body !== undefined && { body: e.body }),
    ...(slackUrl ? { slackThreadUrl: slackUrl } : {}),
  };
});
```

Also add `readonly` modifiers to `GitHubIssue` in `github.ts` to get compile-time
enforcement going forward.

**Effort:** Small
**Risk:** Low — the data itself is unchanged; only the mutation pattern changes

### Option 2: Add readonly to GitHubIssue only

Make `GitHubIssue` fully `readonly` — the compiler will then flag the mutations in `fetch.ts`
and force the fix above.

**Effort:** Very small (marks the problem rather than fixing it)
**Risk:** Zero — compile errors guide the fix

## Acceptance Criteria

- [ ] `fetch.ts` enrichment step creates new issue objects instead of mutating
- [ ] `GitHubIssue` interface in `github.ts` uses `readonly` on all fields (matching `BoardIssue`)
- [ ] No existing tests broken
- [ ] `npm run ci` passes

## Work Log

- 2026-02-21: Identified by TypeScript reviewer (P1-05), Architecture reviewer (P2-05), and Pattern reviewer (P2-5).
