---
status: pending
priority: p1
issue_id: "030"
tags: [code-review, duplication, constants, refactor]
dependencies: []
---

# Business-rule constants duplicated across multiple files (TERMINAL_STATUS_RE, IssueComment, formatError)

## Problem Statement

Three shared constants / types are defined independently in multiple files with no single
source of truth. Any change to these requires touching multiple files — and a missed update
would cause silent behavioral inconsistency (especially TERMINAL_STATUS_RE which drives
completion logic).

## Findings

**A — `TERMINAL_STATUS_RE` in 3 files:**
```
src/board/hooks/use-actions.ts:24     const TERMINAL_STATUS_RE = /^(done|shipped|...)/i;
src/board/components/status-picker.tsx:14  const TERMINAL_STATUS_RE = /^(done|shipped|...)/i;
src/board/components/dashboard.tsx:40  const TERMINAL_STATUS_RE = /^(done|shipped|...)/i;
```
This regex controls whether a status change triggers a completion action (TickTick close,
project field update). If one copy is updated with a new terminal status (e.g., `"resolved"`)
and the others are not, the completion action fires inconsistently.

**B — `IssueComment` interface declared twice:**
```
src/types.ts:14         export interface IssueComment { ... }  // unused — zero imports
src/github.ts:164       export interface IssueComment { ... }  // all consumers use this one
```
All consumers (`detail-panel.tsx`, `dashboard.tsx`, `detail-panel.test.tsx`) import from
`github.ts`. The copy in `types.ts` is dead code and a silent divergence risk.

**C — `formatError` defined in 2 files + 18 inline variants:**
```
src/sync.ts:38     function formatError(err: unknown): string
src/board/fetch.ts:48  function formatError(err: unknown): string
```
Both are identical private functions. Additionally, 18 other occurrences across the
codebase inline the pattern `err instanceof Error ? err.message : String(err)` directly
without calling either copy. Three parallel strategies for the same operation.

**D — `isHeaderId` defined in 2 files:**
```
src/board/components/dashboard.tsx:369   function isHeaderId(id: string | null): boolean
src/board/hooks/use-keyboard.ts:49       function isHeaderId(id: string | null): boolean
```
Identical function bodies.

**E — `timeAgo` defined in 2 files:**
```
src/board/components/dashboard.tsx:329   function timeAgo(date: Date): string
src/board/components/row-renderer.tsx:110  function timeAgo(date: Date): string
```
Identical function bodies.

## Proposed Solutions

### Option 1: Create `src/board/constants.ts` (Recommended)

```typescript
// src/board/constants.ts

/** Statuses that trigger completion actions (TickTick close, project complete). */
export const TERMINAL_STATUS_RE = /^(done|shipped|won't|wont|closed|complete|completed)$/i;
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUS_RE.test(status);
}

/** Returns true if a nav ID is a header row (not a navigable issue/task). */
export function isHeaderId(id: string | null): boolean {
  return id != null && (id.startsWith("header:") || id.startsWith("sub:"));
}

/** Formats a date as a relative "Xm ago" string. */
export function timeAgo(date: Date): string { ... }

/** Formats an unknown error value as a string. */
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

Then:
- Remove the 3 copies of `TERMINAL_STATUS_RE` and import from `constants.ts`
- Remove `IssueComment` from `types.ts` (keep in `github.ts`)
- Remove `formatError` from `sync.ts` and `fetch.ts`, replace 18 inline variants
- Remove duplicate `isHeaderId` from `dashboard.tsx` and `use-keyboard.ts`
- Remove duplicate `timeAgo` from one of `dashboard.tsx` / `row-renderer.tsx`

**Effort:** Medium (many import sites to update)
**Risk:** Low — pure refactor, no behavior changes

### Option 2: Add to existing `src/github.ts`

Put `TERMINAL_STATUS_RE` in `github.ts` since it relates to GitHub project status.
Avoids a new file. Less clean but fewer changes.

## Acceptance Criteria

- [ ] `TERMINAL_STATUS_RE` defined once, imported in `use-actions.ts`, `status-picker.tsx`, `dashboard.tsx`
- [ ] `IssueComment` in `types.ts` removed (or `github.ts` re-exports from `types.ts`)
- [ ] `formatError` extracted to shared location; no more duplicate `function formatError`
- [ ] `isHeaderId` and `timeAgo` each defined once
- [ ] `npm run ci` passes

## Work Log

- 2026-02-21: Identified by Pattern reviewer (P1-1, P1-2, P1-3), Architecture reviewer (R2), Code Simplicity reviewer (1, 2).
