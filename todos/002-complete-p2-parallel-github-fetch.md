---
status: pending
priority: p2
issue_id: 002
tags: [code-review, performance]
dependencies: []
---

# Sequential gh CLI Calls Per Repo

## Problem Statement

`fetchDashboard()` calls `gh` CLI sequentially for each configured repo. With 3 repos, this means 3 serial network round-trips (~1-3s each), making initial load and refresh noticeably slow. This is the single biggest performance bottleneck in the app.

**Flagged by:** performance-oracle, architecture-strategist

## Findings

- Each repo requires separate `gh api` calls for project items, activity, etc.
- `execFileSync` is inherently blocking — can't parallelize in the main thread
- Worker thread already exists for data fetching but still runs repos sequentially
- With 3+ repos, total fetch time is ~3-9s instead of ~1-3s

## Proposed Solutions

### Option 1: Parallel child processes with Promise.all
- Spawn `gh` calls via `execFile` (async) and await all in parallel
- **Pros:** 3x speedup for 3 repos, minimal code change
- **Cons:** Requires converting fetch pipeline to async
- **Effort:** Medium
- **Risk:** Low

### Option 2: Single batched GraphQL query
- Combine all repo queries into one GraphQL request
- **Pros:** Single network round-trip
- **Cons:** Complex query construction, harder to debug
- **Effort:** Large
- **Risk:** Medium

### Option 3: Staggered fetch with incremental rendering
- Fetch repos one at a time but render each as it arrives
- **Pros:** Perceived performance improvement
- **Cons:** Doesn't reduce total time, complex rendering logic
- **Effort:** Medium
- **Risk:** Medium

## Recommended Action

Option 1 — parallel async child processes. Best effort/impact ratio.

## Technical Details

- **Affected files:** `src/board/fetch.ts`, `src/github.ts`
- **Components:** `fetchDashboard()`, worker thread

## Acceptance Criteria

- [ ] Multiple repos fetch in parallel
- [ ] Total fetch time ≈ slowest single repo (not sum)
- [ ] No regression in data accuracy

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Critical performance finding |

## Resources

- File: `src/board/fetch.ts`
- File: `src/github.ts`
