---
title: "Hog Board Command Center"
type: feat
status: active
date: 2026-02-15
---

# Hog Board Command Center

## What We're Building

Transform the hog board from a read-only dashboard into a full personal command center where you can see, understand, and act on all your work without leaving the terminal.

**Current state:** The board shows GitHub issues (with collapsible sections, target dates, labels, search) and TickTick tasks. You can navigate, expand/collapse, search, and open items in browser. Detail panel shows metadata but no issue description.

**Target state:** A board where you can see the full pipeline (In Progress / In Review / Backlog), read issue descriptions at a glance, take actions (pick, comment, change status, create), manage work in bulk, and focus on a single task with a timer.

## Why This Approach

The board is already the central place to see work. The gap is between "seeing" and "doing" — every action today requires leaving the terminal (open browser, find issue, click buttons). Closing this gap makes the board the only tool needed for daily workflow management.

Phased delivery lets us ship value fast (core improvements in days) while building toward the full vision.

## Key Decisions

### Phase 1: Core Improvements (Ship fast)

1. **Issue body in detail panel**
   - Fetch `body` field via `gh issue list --json body`
   - Show first ~15 lines in detail panel, truncated with "..." indicator
   - Detect and highlight Slack thread URLs (`*.slack.com/archives/...`) — make them openable

2. **In Review sub-section**
   - Fetch GitHub Project status for each issue via the existing batched GraphQL query
   - Add `status` field to `GitHubIssue` interface
   - Display three sub-sections per repo: **In Progress** (assigned) → **In Review** (project status = "In Review") → **Backlog** (unassigned, not in review)
   - Issues with "In Review" project status show in their own group regardless of assignment

3. **Slack link detection**
   - Parse issue body for Slack URLs (regex: `https://[^/]+\.slack\.com/archives/[A-Z0-9]+/p[0-9]+`)
   - Show "Slack thread" indicator in detail panel when found
   - `s` key on an issue with Slack link opens it in Slack (via `open` command with `slack://` deep link)
   - Best effort — not all issues will have links

4. **Pick from board (`p` key)**
   - Wire existing `pickIssue()` into live mode
   - On unassigned issue: `p` assigns to self + syncs to TickTick
   - Show confirmation inline, refresh board after

### Phase 2: Board Actions (Power user features)

5. **Quick comment (`c` key)**
   - Opens inline text input at bottom (like search bar)
   - Submit posts comment to GitHub issue via `gh issue comment`
   - Shows confirmation, comment appears on next refresh

6. **Change status (`m` key for "move")**
   - Shows status picker: In Progress / In Review / Done
   - Updates GitHub Project status via existing GraphQL mutation
   - For "Done": triggers configured `completionAction` (addLabel, updateProjectStatus, closeIssue)

7. **Quick assign/unassign**
   - `a` on unassigned issue: assign to self (lighter than pick — no TickTick sync)
   - `u` on self-assigned issue: unassign from self
   - Uses `gh issue edit --add-assignee @me` / `--remove-assignee @me`

8. **Multi-select + bulk operations**
   - `Space` on item toggles selection (visual checkmark)
   - Selection persists while navigating
   - `Enter` on multi-select shows action menu: Assign all / Label all / Move status all
   - `Escape` clears selection
   - Count shown in status bar: "3 selected"

9. **Quick issue create (`n` key)**
   - Opens form overlay: title (required), repo (select from tracked repos), labels (optional)
   - Creates via `gh issue create`
   - New issue appears on next refresh
   - Option to immediately pick the created issue

### Phase 3: Command Center Polish

10. **Activity timeline section**
    - New collapsible section showing recent activity across all repos
    - Sources: recent issue comments, status changes, new issues, completions
    - Shows: "2m ago: jan commented on aibility#142 — 'deployed to staging'"
    - Fetch via `gh api` for recent events
    - Limit to last 10-15 items, refreshes with board

11. **Focus / Pomodoro mode (`f` key)**
    - Pick an active issue to focus on
    - Board dims all other items, selected issue is prominent
    - Timer starts (configurable: 25min default)
    - Timer visible in header bar
    - When timer ends: notification sound/flash, prompt to:
      - Continue (restart timer)
      - Take a break (pause timer)
      - Mark done (trigger completion flow)
      - Exit focus mode
    - Status bar shows focus state: "Focusing on aibility#142 — 18:32 remaining"

12. **Help overlay (`?` key)**
    - Shows all keyboard shortcuts in a bordered overlay
    - Dismiss with `?` or `Escape`
    - Context-aware: shows relevant shortcuts for current selection type

## Architecture Notes

### Data Fetching Changes

- **Issue body**: Add `body` to `gh issue list --json` fields in `fetchRepoIssues()`
- **Project status**: The batched GraphQL query (`fetchProjectTargetDates`) already queries `fieldValues` — extend it to also return the status `SingleSelectValue` field
- **Activity**: New fetch function using `gh api /repos/{owner}/{repo}/events` or issue timeline events

### New Fields on GitHubIssue

```typescript
export interface GitHubIssue {
  // ... existing fields
  body?: string;           // Issue description (markdown)
  projectStatus?: string;  // "In Progress" | "In Review" | "Done" | etc.
  slackThreadUrl?: string; // Extracted from body (computed, not fetched)
}
```

### Keyboard Binding Map (Full)

```
Navigation:
  j/k or arrows    Move up/down
  Tab/Shift+Tab    Jump between sections
  /                Search/filter
  Escape           Exit search/selection/focus

View:
  Enter            Toggle section (on header) / open in browser (on item)
  Space            Toggle multi-select (on item) / toggle section (on header)
  ?                Help overlay

Actions:
  p                Pick issue (assign + sync to TickTick)
  a                Assign to self
  u                Unassign from self
  c                Comment on issue
  m                Move status (In Progress / In Review / Done)
  n                New issue
  f                Focus mode
  r                Refresh
  q                Quit
```

### Board Section Order (per repo, dynamic)

Statuses are fetched from each GitHub Project board and displayed in project order, excluding terminal statuses ("Done", "Shipped", "Won't Do", etc.). Example for Aibility:

```
  Ready (project status = "Ready")
  In Progress (project status = "In Progress")
  In Review (project status = "In Review")
  Backlog (project status = "Backlog" or no status)
```

Terminal statuses are detected by name pattern (contains "done", "shipped", "won't", "wont", "closed") and hidden from the board.

## Resolved Questions

1. **Status field values** — Vary per project board. Aimee Product: Backlog / In Progress / Review / Shipped / Won't Do. Aibility: Backlog / Ready / In Progress / In Review / Done. **Decision:** Fetch statuses dynamically from project, don't hardcode. Group by fetched status. Show everything except "Done"/"Shipped"/"Won't Do" equivalent (filter out terminal statuses).
2. **Focus mode timer** — Configurable. Add `focusDuration` (seconds) to board config, default 1500 (25 min).
3. **Multi-select across sections** — Same repo only. Selection resets when navigating to a different repo section.

## Open Questions

None — all resolved above.

## Additional Resolved Questions

4. **Activity timeline scope** — All activity across tracked repos, not just board-visible issues. Broader awareness of what's happening.
5. **Slack deep links** — Try `slack://` deep link first (opens Slack app), fall back to web URL if it fails.

## What We're NOT Building (Yet)

- AI-powered issue summaries (deferred — revisit when board is feature-complete)
- Full Slack client integration (read/reply to Slack from board)
- Linked PR / CI status display (not enough linked PRs in current workflow)
- GitHub notifications section
- Standup report generator
- Theme system (dark/light)
- Snapshot tests

## References

- Original plan: `docs/plans/2026-02-15-feat-hog-unified-task-dashboard-plan.md`
- UX improvements plan: `docs/plans/2026-02-15-feat-hog-board-ux-improvements-plan.md`
- GitHub API: `hog/src/github.ts` — existing GraphQL queries for project fields
- Pick flow: `hog/src/pick.ts` — existing assign + sync logic
- Board fetch: `hog/src/board/fetch.ts` — data fetching pipeline
- Config: `hog/src/config.ts` — board settings schema
