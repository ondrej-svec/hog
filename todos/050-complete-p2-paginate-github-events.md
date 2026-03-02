---
status: pending
priority: p2
issue_id: "050"
tags: [code-review, performance]
dependencies: []
---

# Excessive GitHub Events Pagination Blocks Dashboard Refresh

## Problem Statement
`fetchRecentActivity` uses `--paginate` on the GitHub Events API, fetching up to 10 pages (300 events) synchronously per repo. The code then discards all but the last 24 hours capped at 15 events, making all pages beyond the first wasted work.

## Findings
- **File:** `src/board/fetch.ts` line 95
- **Evidence:** `--paginate` flag on GitHub Events API call; downstream code trims results to 24h window and caps at 15 events
- **Impact:** On busy repos, each dashboard refresh triggers up to 10 HTTP round trips where 1-2 would suffice. With 5 repos configured this amounts to up to 10 seconds of blocking fetch time per refresh cycle.

## Proposed Solutions
### Option A: Replace --paginate with --limit 30 (Recommended)
One page of 30 events covers the relevant 24h window for all but the most active repos, and is fetched in a single HTTP round trip:
```sh
gh api /repos/{owner}/{repo}/events --limit 30
```
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] `--paginate` replaced with `--limit 30` in `fetchRecentActivity`
- [ ] Events are still correctly filtered to the 24h window
- [ ] Dashboard refresh is noticeably faster on active repos

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
