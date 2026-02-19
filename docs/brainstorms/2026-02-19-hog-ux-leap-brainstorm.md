---
date: 2026-02-19
topic: hog-ux-leap
---

# hog UX Leap: From Good to Great

## What We're Building

A set of high-impact UX improvements that transform hog from a capable TUI into the
tool that nvim/tmux/lazygit devotees reach for first. The goal is not feature volume —
it's removing the moments where users leave hog and open a browser instead.

Research grounded in: lazygit (37k ★), gh-dash, jira-cli, taskwarrior, calcurse,
and direct codebase analysis of current gaps.

---

## Core Problem

Users leave hog and open the browser for three reasons:
1. **Can't find the issue** they have in mind quickly enough
2. **Can't read it fully** (comments missing from detail panel)
3. **Can't trust what just happened** (no undo, no action log)

Plus one "out of box" gap: **no full issue editing** without the browser.

---

## Feature Set

### 1. Fuzzy Issue Picker (`F` key)
Telescope-style overlay showing **all issues across all repos** in memory.
Type to fuzzy-filter by title, labels, assignee. `j`/`k` to navigate.
`Enter` jumps the board cursor to that issue and closes the picker.

- No extra API calls — data is already in `buildFlatRows()`
- Fuzzy scoring: substring gap tolerance (e.g. "lgnbug" → "login bug")
- Row format: `repo/name · #42 · Fix login bug · [bug] [priority:high] · @alice`
- Works naturally for nvim users who reach for `<leader>ff` by instinct

### 2. My Issues Toggle (`t` key)
Single-keystroke filter: toggles between **all issues** ↔ **assigned to me only**.
Filters `buildFlatRows` output to `issue.assignees.includes(config.board.assignee)`.
Active state shown in status bar: `filter: @me`. `t` again clears it.

- ~30 lines of code, high daily value
- Persistent within session; clears on `R` (full refresh)
- Works alongside `/` search (both filters compose)

### 3. Action Log + Undo
A collapsible pane (bottom-left, ~4 lines) showing the last 5 mutations:

```
✓ #42 moved → In Progress    2s ago
✓ #37 assigned to @me        1m ago
✗ comment failed on #50      [retry: r]
```

`u` undoes the last reversible action (status change, assign/unassign).
Undo re-fetches the previous value from the in-memory snapshot and calls
the inverse mutation via `gh` CLI. Toast confirms: `#42 moved back → Todo`.

- Inspired directly by lazygit's command log — the most cited "trust-building" feature
- Only status + assign/unassign are undoable (comments and creates are not reversible)
- Pane toggled with `L` (log); collapsed by default, auto-expands on error

### 4. Comments in Detail Panel
The detail panel (right side, visible at width ≥ 120) currently shows body + labels.
Extend it to show **last N comments** (default: 5) fetched via `gh issue view --json comments`.

```
─── Comments (3) ─────────────────────
@alice · 2h ago
  Confirmed on staging. The redirect...

@bob · 30m ago
  Fixed in PR #89, awaiting review.
```

- Fetch is deferred: triggered when an issue is selected, cached by issue number
- Loading state shows `fetching comments...` in the panel
- Eliminates "open in browser to read discussion" as the #1 friction point

### 5. Persistent Context Hint Bar
Always-visible 1-line bar at the bottom of the board (above the toast area).
Shows 4–6 relevant keys for the **current mode**. Changes per mode.

```
normal:    [j/k] nav  [m] move  [c] comment  [e] edit  [F] find  [?] more
search:    [type] filter  [Enter] confirm  [Esc] clear
multiSelect: [space] toggle  [Enter] bulk action  [Esc] cancel
```

- Replaces memorization with in-context discovery
- Fixes the current gap where `?` overlay is the only discoverability path
- Also show current mode label: `[MULTI-SELECT]`, `[SEARCH]`, `[FOCUS]`

---

## The "Out of Box" Feature: Full Issue Edit via `$EDITOR`

Press `e` on any issue. hog opens `$EDITOR` (same mechanism as comment editor) with a
structured YAML front matter + markdown body:

```yaml
# --- HOG ISSUE EDIT ---
# title: string
# status: one of → Todo, In Progress, In Review, Done
# labels: list (available: bug, enhancement, priority:high, priority:low)
# assignee: github username or empty
# due: YYYY-MM-DD or natural language (today, friday, next week)
# ────────────────────────────────────────────────────────────────
status: In Progress
labels:
  - bug
  - priority:high
assignee: alice
due: 2026-02-28
---

# Fix login redirect bug

When a user logs in with SSO, the redirect URL is not preserved.
Steps to reproduce: ...
```

**Flow:**
1. hog injects valid option comments from live config + fetched repo labels
2. `$EDITOR` opens; user edits freely in nvim/vim/nano/etc.
3. On save, hog parses the front matter + body
4. Validation: if status/label/assignee is invalid → **reopen editor** with error
   comments injected at the top: `# ERROR: status "Donee" not found → valid: Todo, In Progress, Done`
5. On valid save: apply changes via separate `gh` calls (title, body, status, labels, assignee, due date)
6. Toast confirms each field changed; action log records the edit

**Why this is special:** It makes hog the single surface for full issue lifecycle.
No browser needed for creation, reading, or editing.

---

## CLI Parity / Agent-Native Commands

Every board action gets a non-interactive CLI counterpart. Agents, scripts, and
shell aliases work without running the board.

Current: `hog issue create <text>`

New additions:
```
hog issue move <repo/number> <status>
hog issue assign <repo/number> [--user <username>]
hog issue unassign <repo/number>
hog issue comment <repo/number> <text>
hog issue edit <repo/number> [--title] [--body] [--label] [--due]
hog issue label <repo/number> <label> [--remove]
hog issue show <repo/number>          # full JSON output of issue
```

- All commands support `--json` output (existing global flag)
- All respect the `--dry-run` flag (show what would happen)
- Agents (AI or shell scripts) can drive the same mutations as the board

---

## Future / Document-Only Ideas

These are great but require more design work before implementation:

**Urgency scoring within status groups**
Sort issues within each status column by computed urgency:
`priority_label_weight + staleness_weight + due_date_weight`.
Challenge: label names vary across projects → needs configurable label→weight mapping.
Pattern: taskwarrior's `urgency` formula. Deferred until label config is more structured.

**AI triage: "what should I work on next?"**
Press `A`, LLM analyzes open+assigned issues and suggests top 3.
Challenge: same label variability + requires user to trust LLM suggestions over their own judgment.
Infrastructure exists (OpenRouter/Anthropic already wired). Worth revisiting after label config.

**tmux/wezterm native enhancements**
OSC 8 hyperlinks (clickable issue numbers in terminal), optional tmux popup mode.
Constraint: must work equally well without tmux. Enhancement, not dependency.

---

## Key Decisions

| Decision | Rationale |
|---|---|
| Fuzzy picker over enhanced `/` search | Two different mental models: "find specific thing" vs "filter the view". Keep both. |
| `t` toggle instead of named presets | YAGNI: named presets require config; `t` is immediate value with zero config. |
| YAML front matter for edit | More familiar to developers than custom markup; tooling (nvim yaml highlighting) works. |
| Annotate before + validate after for edit | Editor-agnostic; never silently ignore errors; respects nvim/vim/nano equally. |
| Action log collapsed by default | Power users discover it; casual users aren't distracted by it. Auto-expand on error. |
| CLI parity as first-class feature | Agents can't drive TUIs; hog should be fully usable by AI agents and scripts. |
| Urgency scoring deferred | Label structure varies across projects; needs configurable weight mapping first. |
| `F` for fuzzy picker | Capital-letter consistency with existing `C`, `I` overlay keys. Fast daily use. |
| Comments: lazy fetch | No extra `gh` calls while browsing. Tab/Enter explicitly loads when needed. |
| Action log: `L` toggle pane | Hidden by default (no clutter), auto-expands on error (surfaces issues), dismissible. |
| CLI parity: GitHub only | TickTick is de-emphasized as optional; GitHub is the primary focus. |

---

## Resolved Questions

- **Find UX**: Fuzzy picker (Option 1) + `t` toggle (from Option 2). They solve different problems.
- **Fuzzy picker key**: `F` (capital F). Consistent with hog's existing capital-letter overlay pattern (`C`, `I`, `R`).
- **Comment fetch timing**: Lazy — fetch on explicit `Tab` or `Enter` in the detail panel. Zero extra `gh` calls while browsing.
- **Edit validation**: Annotate before opening (inject valid options as YAML comments) + reopen on error. Never silently fail.
- **Edit for TickTick**: `e` on a TickTick task is out of scope for now. GitHub issues only.
- **CLI parity scope**: GitHub-only first. TickTick is being de-emphasized as optional.
- **Action log position**: Toggle pane with `L` key. Hidden by default, auto-expands on error. Dismissed with `L` or `Esc`.
- **tmux dependency**: hog should work great with and without tmux. No tmux requirement.
- **AI/urgency timing**: Document as future; too complex to do generically without label config.

---

## Next Steps

→ `/workflows:plan` for phased implementation of the feature set above.

Suggested phases:
1. **Phase 1** (quick wins): `t` toggle, hint bar, fix help overlay, comments in detail panel
2. **Phase 2** (core): Fuzzy issue picker
3. **Phase 3** (power): Action log + undo, full issue edit via `$EDITOR`
4. **Phase 4** (platform): CLI parity commands for agent-native use
