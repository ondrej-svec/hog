---
status: pending
priority: p2
issue_id: "036"
tags: [code-review, performance, sync, graphql, n-plus-one]
dependencies: []
---

# sync.ts uses per-issue fetchProjectFields (N+1 calls) instead of batched fetchProjectEnrichment

## Problem Statement

The sync path (`hog sync run`) calls `fetchProjectFields` once per issue. For a board
with 30 open issues across 3 repos, this is 60+ sequential `execFileSync` calls, each
potentially 2 GraphQL round-trips. The board fetch path (`hog board --live`) already uses
the correct batched approach via `fetchProjectEnrichment`, but sync was never updated.

At scale or on slow connections this can hit 30-second timeouts per issue, making sync
unreliable for larger boards.

## Findings

**`src/sync.ts` line 151:**
```typescript
// Inside syncSingleIssue — called once per issue
const projectFields = fetchProjectFields(
  repoConfig.name,
  issue.number,
  repoConfig.projectNumber,
);
```

`fetchProjectFields` makes 2 sequential `execFileSync` calls per issue:
1. Find the project item ID
2. Fetch its status and target date

**`src/board/fetch.ts` — the correct batched approach:**
```typescript
// Fetches all enrichment data for ALL issues in one pass
const enrichMap = fetchProjectEnrichment(repoName, projectNumber);
for (const issue of rd.issues) {
  const e = enrichMap.get(issue.number);
  // ...
}
```

`fetchProjectEnrichment` uses a single paginated GraphQL query to get enrichment for all
issues at once (O(1) GraphQL calls per repo instead of O(n) per issue).

## Proposed Solutions

### Option 1: Update syncGitHubToTickTick to use fetchProjectEnrichment (Recommended)

```typescript
// In sync.ts — before the per-issue loop
for (const repoConfig of config.repos) {
  const issues = fetchIssues(repoConfig.name, { assignee: config.board.assignee });

  // Pre-fetch enrichment for all issues at once (O(1) calls instead of O(n))
  const enrichMap = fetchProjectEnrichment(repoConfig.name, repoConfig.projectNumber);

  for (const issue of issues) {
    // Use enrichMap.get(issue.number) instead of fetchProjectFields(...)
    await syncSingleIssue(issue, enrichMap.get(issue.number), repoConfig, config);
  }
}
```

Update `syncSingleIssue` signature to accept pre-fetched enrichment data.

**Effort:** Small
**Risk:** Low — functionally equivalent; uses existing tested function

### Option 2: Keep fetchProjectFields but parallelize across issues

Use `Promise.all` to run all `fetchProjectFields` calls in parallel within a repo.
Still O(n) calls but they run concurrently.

**Effort:** Very small
**Risk:** Low — but still wastes API calls; Option 1 is better

## Acceptance Criteria

- [ ] `sync.ts` no longer calls `fetchProjectFields` in a per-issue loop
- [ ] Sync uses `fetchProjectEnrichment` for batch enrichment lookup
- [ ] `npm run test` passes (update `sync.test.ts`)
- [ ] `hog sync run` works correctly after change

## Work Log

- 2026-02-21: Identified by Architecture reviewer (R3), Performance Oracle.
