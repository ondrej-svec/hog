---
status: pending
priority: p1
issue_id: "014"
tags: [code-review, testing, coverage]
dependencies: []
---

# Add test coverage for all new UX Leap components and hooks

## Problem Statement

The hog UX Leap feature set added 5 new components and 1 new hook with **zero test coverage**. The project enforces an 80% coverage threshold (enforced in vitest.config.ts). These files currently have no co-located test files, which risks breaking CI as coverage is measured.

**Files with zero coverage:**
- `src/board/components/action-log.tsx`
- `src/board/components/fuzzy-picker.tsx`
- `src/board/components/hint-bar.tsx`
- `src/board/components/edit-issue-overlay.tsx`
- `src/board/hooks/use-action-log.ts`
- New `hog issue` subcommands in `src/cli.ts`

Every other hook in `src/board/hooks/` has a co-located test file. Every major component has a test file. This is the only batch of new code that breaks that pattern.

## Findings

- `use-action-log.ts`: No `use-action-log.test.tsx`. Testable pure behaviors: `nextEntryId` increments, `pushEntry` keeps last 10 entries, `undoLast` clears the undo property before execution (prevents double-undo), `undoLast` calls `refresh()` on undo failure, `hasUndoable` reflects entry state correctly.
- `hint-bar.tsx`: No test file. Straightforward render tests by `UIMode`: normal hints, search hints, multiSelect count, focus mode text, overlay generic hints, `filter: @me` indicator, `u:undo` only when `hasUndoable` is true.
- `action-log.tsx`: No test file. Tests needed: empty state, slice(-5) boundary (shows only last 5), `[u: undo]` only on most recent undoable entry, `relativeTime` formatting (seconds, minutes, hours). Requires `vi.useFakeTimers()` for the 5s interval.
- `fuzzy-picker.tsx`: No test file. Critical tests: empty query shows first 20, query filters by title/repo/number/label, `keepCursorVisible` scroll logic (pure function, trivially testable), keyboard navigation (ArrowDown/ArrowUp/Ctrl-J/Ctrl-K/Enter/Escape), cursor reset to 0 on query change.
- `edit-issue-overlay.tsx`: Hard to test end-to-end (spawns editor). But `buildEditorFile` and `parseFrontMatter` are pure functions. Test `parseFrontMatter` edge cases: normal parse, missing `---` separator, comment stripping, label list parsing, empty labels, empty title validation, invalid status detection.
- `use-ui-state.test.tsx`: Existing test file not updated for `overlay:fuzzyPicker` and `overlay:editIssue` modes. `enterFuzzyPicker` and `enterEditIssue` transitions need the same coverage as `enterFocus` and `enterComment`.

## Proposed Solutions

### Option 1: Write all tests in one session

Create test files for each new file following the existing patterns:
- Hook tests: use ink-testing-library render harness with globalThis exposure (see `use-toast.test.tsx`)
- Component tests: render with `ink-testing-library`, assert on lastFrame() content
- Pure function tests: import and call directly

**Pros:** Complete coverage in one pass, follows all established patterns

**Cons:** Large single task

**Effort:** 4-6 hours

**Risk:** Low

---

### Option 2: Prioritize hooks and pure functions first

Start with `use-action-log.test.tsx` and the pure function tests in `edit-issue-overlay.tsx` (parseFrontMatter, buildEditorFile), then add component tests.

**Pros:** Fastest path to covering the highest-risk logic

**Effort:** 2-3 hours for phase 1, 2-3 hours for phase 2

**Risk:** Low

## Technical Details

- Test framework: Vitest
- Component testing: `ink-testing-library` (see `dashboard.test.tsx` for patterns)
- Hook testing: `renderHook` from `@testing-library/react` + `ink-testing-library` (see `use-toast.test.tsx`)
- For `ActionLog` timestamp tests: `vi.useFakeTimers()` needed due to 5s setInterval
- For `FuzzyPicker` tests: mock `process.stdout.rows` to avoid NaN from undefined
- For `EditIssueOverlay`: mock `spawnSync` and file system operations

## Acceptance Criteria

- [ ] `src/board/hooks/use-action-log.test.tsx` created with >=6 test cases
- [ ] `src/board/components/hint-bar.test.tsx` created with tests for each UIMode
- [ ] `src/board/components/action-log.test.tsx` created with tests for render cases
- [ ] `src/board/components/fuzzy-picker.test.tsx` created with keyboard + filter tests
- [ ] `src/board/components/edit-issue-overlay.test.tsx` created with parseFrontMatter + buildEditorFile pure function tests
- [ ] `src/board/hooks/use-ui-state.test.tsx` updated with overlay:fuzzyPicker and overlay:editIssue mode coverage
- [ ] `npm run test:coverage` passes 80% threshold after tests added
- [ ] All 283 existing tests still pass

## Work Log

- 2026-02-19: Created during code review of hog UX Leap feature set. All review agents flagged this as highest-priority finding.

## Resources

- Pattern reference: `src/board/hooks/use-toast.test.tsx` (hook testing pattern)
- Pattern reference: `src/board/components/dashboard.test.tsx` (component testing pattern)
- Pattern reference: `src/board/hooks/use-ui-state.test.tsx` (state machine testing)
- PR: hog UX Leap (commits 7514fa2 through ce2da17 on main)
