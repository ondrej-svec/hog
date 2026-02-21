---
status: complete
priority: p1
issue_id: "031"
tags: [code-review, agent-native, json-output, board]
dependencies: []
---

# `hog board --json` omits projectStatus from issue objects

## Problem Statement

`hog board --json` is the primary machine-readable output for automation and agent workflows.
However, the `projectStatus` field — which determines which column/status an issue is in —
is absent from the serialized output. An agent calling `hog board --json` cannot determine
an issue's current status without a separate follow-up call.

This breaks the most basic agent workflow: "what is the status of each issue?"

## Findings

**`src/board/format-static.ts` lines 162–175:**
```typescript
issues: rd.issues.map((i) => ({
  number: i.number,
  title: i.title,
  url: i.url,
  state: i.state,
  assignee: (i.assignees ?? [])[0]?.login ?? null,
  assignees: (i.assignees ?? []).map((a) => a.login),
  labels: i.labels.map((l) => l.name),
  updatedAt: i.updatedAt,
  isMine: (i.assignees ?? []).some((a) => a.login === selfLogin),
  slackThreadUrl: i.slackThreadUrl ?? null,
  // ← projectStatus is absent
  // ← targetDate is absent
})),
```

`i.projectStatus` and `i.targetDate` are populated by `fetchProjectEnrichment` and are
present on `GitHubIssue` at serialization time. They are simply not included.

Also missing: the `activity` array. `DashboardData.activity` is fetched but not serialized,
so agents cannot see recent activity events (comments, status changes, assignments).

## Proposed Solutions

### Option 1: Add missing fields to renderBoardJson (Recommended, one-line fix)

```typescript
issues: rd.issues.map((i) => ({
  number: i.number,
  title: i.title,
  url: i.url,
  state: i.state,
  projectStatus: i.projectStatus ?? null,   // ← add
  targetDate: i.targetDate ?? null,           // ← add
  assignee: (i.assignees ?? [])[0]?.login ?? null,
  assignees: (i.assignees ?? []).map((a) => a.login),
  labels: i.labels.map((l) => l.name),
  updatedAt: i.updatedAt,
  isMine: (i.assignees ?? []).some((a) => a.login === selfLogin),
  slackThreadUrl: i.slackThreadUrl ?? null,
})),
```

And add activity to the top-level output:
```typescript
return JSON.stringify({
  repos: ...,
  ticktick: ...,
  activity: data.activity,  // ← add
}, null, 2);
```

**Effort:** Very small (add 3 lines)
**Risk:** Additive — no existing consumers break; new fields are additions

## Acceptance Criteria

- [ ] `hog board --json` output includes `projectStatus` on each issue object
- [ ] `hog board --json` output includes `targetDate` on each issue object
- [ ] `hog board --json` output includes top-level `activity` array
- [ ] `npm run test` passes (add/update `format-static.test.ts` to cover new fields)

## Work Log

- 2026-02-21: Identified by Agent-Native reviewer (P1 #1 and P2 #4), confirmed as highest-priority agent-native gap.
