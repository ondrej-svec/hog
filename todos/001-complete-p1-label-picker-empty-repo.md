---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, bug, type-safety]
---

# `defaultRepo ?? ""` passes empty string to LabelPicker

## Problem Statement

In `overlay-renderer.tsx:156`, the `LabelPicker` received `repo={defaultRepo ?? ""}`. The `defaultRepo` prop is `string | null`, and the `selectedIssue` guard does NOT guarantee `defaultRepo` is non-null. If a user is on a row where `selectedIssue` is non-null but `defaultRepo` is null (possible depending on selection state), `LabelPicker` will call `gh label list --repo ""` which will fail or return garbage.

This is a silent bug — no TypeScript error, no runtime panic, just a failed `gh` call.

## Findings

- **File:** `src/board/components/overlay-renderer.tsx`, line 154–163
- **Root cause:** The `mode === "overlay:label" && selectedIssue` guard is necessary but not sufficient — `defaultRepo` can independently be null.
- **Impact:** User triggers label picker, `gh` errors with "must provide repo name", label picker shows an error state or closes silently.
- **Flagged by:** TypeScript reviewer + Architecture reviewer (independently)

```tsx
// Before (line 154):
{mode === "overlay:label" && selectedIssue ? (
  <LabelPicker
    repo={defaultRepo ?? ""}  // BUG: "" if defaultRepo is null
```

## Resolution

Applied Option A — added `&& defaultRepo` to the guard:

```tsx
{mode === "overlay:label" && selectedIssue && defaultRepo ? (
  <LabelPicker
    repo={defaultRepo}  // TypeScript narrows to string
    ...
  />
) : null}
```

## Acceptance Criteria

- [x] TypeScript does not need `?? ""` — `repo` receives a `string`, not `string | null`
- [x] Label picker opens correctly when issue is selected
- [x] `npm run typecheck` passes

## Work Log

- 2026-02-18: Identified by code review agents (TypeScript + Architecture reviewers)
- 2026-02-18: Fixed — guard extended with `&& defaultRepo`, `?? ""` removed
