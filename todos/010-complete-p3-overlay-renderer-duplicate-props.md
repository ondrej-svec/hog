---
status: complete
priority: p3
issue_id: "010"
tags: [code-review, simplification, architecture]
---

# OverlayRenderer: remove redundant onNlCreateSubmit/onNlCreateCancel props

## Problem Statement

`OverlayRendererProps` had `onNlCreateSubmit` and `onNlCreateCancel` which were always bound to `handleCreateIssueWithPrompt` and `ui.exitOverlay` in `dashboard.tsx` — the same values already passed as `onCreateIssue` and `onExitOverlay`. These props existed only to give the NL path its own names while sharing the same handlers, adding 2 props to a component already carrying 20+.

## Findings

- **File:** `src/board/components/overlay-renderer.tsx`, lines 56–57 (interface) + lines 91–92 (destructure) + lines 188–189 (usage)
- **File:** `src/board/components/dashboard.tsx`, lines 882–883 (callsite)

## Resolution

In `overlay-renderer.tsx`, replaced the `NlCreateOverlay` props:
```tsx
// Before
onSubmit={onNlCreateSubmit}
onCancel={onNlCreateCancel}

// After
onSubmit={onCreateIssue}
onCancel={onExitOverlay}
```

Removed `onNlCreateSubmit` and `onNlCreateCancel` from:
1. `OverlayRendererProps` interface
2. Function destructuring params
3. `<OverlayRenderer>` callsite in `dashboard.tsx`

**Net reduction:** 8 lines (2 interface + 2 destructure + 2 callsite + 2 dashboard).

## Acceptance Criteria

- [x] `OverlayRendererProps` has 2 fewer props
- [x] NL create overlay still functions correctly (uses `onCreateIssue` / `onExitOverlay`)
- [x] `npm run typecheck` passes

## Work Log

- 2026-02-18: Identified by Simplicity reviewer
- 2026-02-18: Fixed — redundant props removed, NL overlay now reuses `onCreateIssue` and `onExitOverlay`
