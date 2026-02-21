---
status: complete
priority: p3
issue_id: "043"
tags: [code-review, patterns, consistency, types]
dependencies: []
---

# Pattern consistency: useData return type, parseInt, prop naming, execFileAsync declarations

## Problem Statement

Several inconsistencies in naming conventions, type declarations, and coding patterns
across the codebase. None cause bugs, but they create cognitive overhead when reading
unfamiliar parts of the code.

## Findings

**A — useData missing named return type interface (use-data.ts line 84):**
Every other hook has a named `Use<Hook>Result` interface:
```
UseNavigationResult, UseToastResult, UseUIStateResult, UseMultiSelectResult,
UseActionsResult, UseActionLogResult
```
`useData` uses an inline intersection type instead:
```typescript
export function useData(...): DataState & {
  refresh: (s?: boolean) => void;
  mutateData: ...;
  // 4 more fields inline
}
```
This means callers cannot reference the return type by name.

**B — `parseInt` vs `Number.parseInt` (use-actions.ts:175, 512):**
Every file in the codebase uses `Number.parseInt(...)`. Two occurrences in `use-actions.ts`
use the bare global `parseInt`. Biome's `noGlobalEval` family of rules may or may not catch
this depending on config, but it's inconsistent.

**C — Error callback prop names inconsistent across components:**
```
LabelPickerProps:     onError(msg: string)
EditIssueOverlayProps: onToastError(msg: string)
OverlayRendererProps:  onLabelError(msg: string) AND onToastError(msg: string)
```
Both `onLabelError` and `onToastError` in `OverlayRenderer` resolve to the same
`toast.error` call at the call site. The split naming makes it unclear which callback
does what.

**D — `const execFileAsync = promisify(execFile)` declared in 4 modules:**
```
src/cli.ts:45
src/github.ts:4
src/board/hooks/use-actions.ts:22
src/board/components/edit-issue-overlay.tsx:15
```
Fine functionally but noisy. Once todo 033 is done (routing through github.ts),
the declarations in `use-actions.ts` and `edit-issue-overlay.tsx` can be removed.

**E — Component export style inconsistent (3 out of 22 use `export function`):**
```
focus-mode.tsx, row-renderer.tsx, toast-container.tsx  → export function Foo(...)
all others (19 components)                              → function Foo(...) + export { Foo }
```

**F — Worker message type not a discriminated union (use-data.ts:139):**
```typescript
worker.on("message", (msg: { type: string; data?: DashboardData; error?: string }) => {
```
`type: string` prevents TypeScript from narrowing on `msg.type`. Should be:
```typescript
type WorkerMessage =
  | { type: "success"; data: DashboardData }
  | { type: "error"; error: string };
```

## Proposed Solutions

**Fix A:** Add `export type UseDataResult = DataState & { refresh: ...; mutateData: ...; ... }` and use it as the return type.

**Fix B:** Replace `parseInt(...)` with `Number.parseInt(...)` in `use-actions.ts` (2 occurrences).

**Fix C:** Standardize error callback prop to `onError` everywhere, or use `onToastError` everywhere. Remove the split between `onLabelError` and `onToastError`.

**Fix D:** Will resolve naturally once todo 033 is complete.

**Fix E:** Choose one style and apply consistently. The trailing `export { Name }` style is the majority and is slightly more flexible (allows re-ordering, easier to spot what a file exports).

**Fix F:** Replace the inline type with a discriminated union type in `use-data.ts`.

**Effort:** Small (B, F), Very small (A, E), Medium (C involves prop threading changes)
**Risk:** Low

## Acceptance Criteria

- [ ] `useData` has a named `UseDataResult` interface
- [ ] `Number.parseInt` used consistently (no bare `parseInt` in src/)
- [ ] Worker message type is a discriminated union
- [ ] `npm run ci` passes

## Work Log

- 2026-02-21: Identified by Pattern reviewer (P2-1, P2-2, P2-4, P2-6, P2-7), TypeScript reviewer (P2-01, P2-05).
