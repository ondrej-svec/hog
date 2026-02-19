---
status: pending
priority: p1
issue_id: "015"
tags: [code-review, quality, testing, fuzzy-picker]
dependencies: []
---

# Fix process.stdout.rows undefined in FuzzyPicker (NaN VISIBLE breaks tests and CI)

## Problem Statement

`src/board/components/fuzzy-picker.tsx` line 99 reads `process.stdout.rows` without a guard:

```typescript
const VISIBLE = Math.min(process.stdout.rows - 4, 15);
```

In non-TTY environments (CI, Vitest tests, piped output), `process.stdout.rows` is `undefined`. This makes `VISIBLE = Math.min(undefined - 4, 15)` = `Math.min(NaN, 15)` = `NaN`. The downstream `results.slice(scrollOffset, scrollOffset + NaN)` returns an empty array, so the picker renders no results without any error. This is a silent failure that:
1. Makes the component impossible to test correctly without mocking process.stdout
2. Will cause fuzzy-picker tests (once written — see todo 014) to always show 0 results

## Findings

- `src/board/components/fuzzy-picker.tsx:99`: `process.stdout.rows` used without null guard
- `Math.min(NaN, 15)` evaluates to `NaN` in JavaScript
- `Array.prototype.slice(NaN, NaN)` returns `[]` — empty, no error
- All other terminal-height logic in the codebase goes through `useStdout()` in Dashboard (which correctly handles resize via the `resize` event)
- The `keepCursorVisible` calls inside `useInput` also use `VISIBLE` — the handler captures the value at registration time, creating a stale-closure risk on terminal resize
- The project uses `noUncheckedIndexedAccess` everywhere else; this is the only place where an environment property is used without a fallback

## Proposed Solutions

### Option 1: Add fallback in place (minimal fix)

```typescript
const VISIBLE = Math.min((process.stdout.rows ?? 24) - 4, 15);
```

`24` is a standard 80x24 terminal default.

**Pros:** One-line fix, immediately testable, consistent with TypeScript strict mode philosophy

**Cons:** `VISIBLE` still recomputes on every render but doesn't update on resize (existing behavior unchanged)

**Effort:** 5 minutes

**Risk:** None

---

### Option 2: Receive terminal height via props (proper fix)

Pass `visibleRows` from Dashboard (which already tracks `termSize` via `useStdout()`):

```typescript
// In Dashboard, pass to OverlayRenderer -> FuzzyPicker:
visibleRows={Math.max(5, termSize.rows - 4)}

// In FuzzyPicker:
const VISIBLE = Math.min(props.visibleRows, 15);
```

**Pros:** Responsive to terminal resize, consistent with how all other height-dependent rendering works

**Cons:** Requires OverlayRenderer prop change

**Effort:** 30 minutes

**Risk:** Low

## Technical Details

- File: `src/board/components/fuzzy-picker.tsx:99`
- All other height-responsive rendering: `src/board/components/dashboard.tsx` uses `useStdout()` and passes `termSize` via `overlayBarRows`, `viewportHeight` etc.

## Acceptance Criteria

- [ ] `process.stdout.rows` access has a fallback (`?? 24` or equivalent)
- [ ] `FuzzyPicker` renders correctly in non-TTY environments (verified in tests)
- [ ] `npm run test` continues to pass

## Work Log

- 2026-02-19: Identified during code review. Multiple agents flagged this independently.

## Resources

- File: `src/board/components/fuzzy-picker.tsx`
- Related: todo 014 (missing tests — this fix is a prerequisite for testing FuzzyPicker)
