---
title: "feat: Hog Board UX Improvements"
type: feat
status: completed
date: 2026-02-15
---

# Hog Board UX Improvements

The live TUI board (`hog board --live`) needs polish for real-world use with many issues. This plan covers bug fixes, collapsible sections, richer issue details, search/filter, and a responsive detail preview panel.

## Bug Fixes

- [x] **Fix `require()` crash in ESM** (`dashboard.tsx:40`) - `openInBrowser` uses `require("node:child_process")` which throws `ReferenceError: require is not defined`. Replace with ESM `import { execFileSync } from "node:child_process"` at file top.
- [x] **Verify arrow key navigation works** - Code at `dashboard.tsx:96-97` handles `key.downArrow`/`key.upArrow` already. Confirm this works after the `require()` fix (the crash may have been masking it). If arrows still don't work, debug `useInput` key object.

## Collapsible Sections

- [x] **Add collapse state to navigation hook** - Track `collapsedSections: Set<SectionId>` in `use-navigation.ts`. New actions: `TOGGLE_SECTION`. Collapsed sections show only header with item count.
- [x] **Sections start collapsed by default** - On initial render, all sections collapsed. Show `▶ repoName (12 issues)`. Expanded shows `▼ repoName (12 issues)` + issue rows.
- [x] **Toggle with Enter/Space on section header** - When cursor is on a section header row (not an issue row), Enter/Space toggles collapse. Need to add section headers as nav items (new `type: "header"` nav item).
- [x] **Skip collapsed section items in navigation** - j/k should skip over items inside collapsed sections.

## Richer Issue Details

- [x] **Show `updatedAt` on issue rows** - `GitHubIssue` already has `updatedAt`. Display as relative time (e.g., "2d ago") right-aligned in `issue-row.tsx`.
- [x] **Show target date on issue rows** - Batched `fetchProjectTargetDates` fetches all target dates from GitHub Projects in one GraphQL call per repo. Enriches issues during board fetch.
- [x] **Show labels on issue rows** - `GitHubIssue` has `labels` array. Display first 1-2 labels as colored badges after title.

## Search / Filter

- [x] **Add `/` key to activate search mode** - Show text input bar at bottom. Uses `TextInput` from `@inkjs/ui`.
- [x] **Filter issues and tasks by title** - Case-insensitive substring match. Update `navItems` to only include matching items. Empty query shows all.
- [x] **Escape to clear search and return to normal navigation**.

## Detail Preview Panel

- [x] **Detect terminal width** - Use Ink's `useStdout()` to get `stdout.columns`. If width >= 120 chars, show two-column layout.
- [x] **Render preview panel on the right** - When an issue/task is selected, show details in a bordered box on the right (~40% width):
  - **GitHub issue**: full title, body excerpt (first 10 lines), labels, assignees, state, updated at, target date, URL
  - **TickTick task**: full title, description, due date, priority, tags, checklist items
- [x] **Graceful fallback** - If terminal < 120 chars wide, hide preview panel entirely (current single-column layout).
- [x] **Respond to terminal resize** - `stdout` emits `resize` events. Re-render layout on resize.

## Key Files

| File | Changes |
|------|---------|
| `hog/src/board/components/dashboard.tsx` | Fix `require()`, add search bar, two-column layout, collapsible rendering |
| `hog/src/board/components/issue-row.tsx` | Add updatedAt, targetDate, labels display |
| `hog/src/board/components/task-row.tsx` | Minor: ensure consistent column widths |
| `hog/src/board/hooks/use-navigation.ts` | Add collapse state, section header nav items, skip collapsed items |
| `hog/src/board/hooks/use-data.ts` | No changes expected |
| `hog/src/board/fetch.ts` | Enrich issues with project field data (targetDate) via batched GraphQL |
| `hog/src/board/components/detail-panel.tsx` | **NEW** - Preview panel component |
| `hog/src/board/components/search-bar.tsx` | **NEW** - Search input component |

## Implementation Order

1. Bug fixes (require crash, verify arrows) - unblocks everything
2. Richer issue details (updatedAt, targetDate, labels) - quick wins
3. Collapsible sections - biggest UX improvement for many issues
4. Search/filter - builds on collapsible, useful with many items
5. Detail preview panel - polish, depends on terminal size detection

## References

- Previous plan: `docs/plans/2026-02-15-feat-hog-unified-task-dashboard-plan.md`
- Ink `useStdout()` for terminal dimensions
- `@inkjs/ui` `TextInput` for search
- `fetchProjectTargetDates` in `hog/src/github.ts` batches project field queries
- No external packages needed beyond what's already installed
