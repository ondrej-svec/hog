# hog

Your personal command deck — a unified task dashboard for GitHub Projects and TickTick, right in your terminal.

<!-- TODO: Add terminal recording -->
<!-- ![hog board demo](./docs/demo.gif) -->

## Quick Start

```sh
npm install -g @hog-cli/hog
hog init     # interactive setup wizard
hog board --live
```

Requires **Node.js 22+** and the [GitHub CLI](https://cli.github.com/) (`gh auth login`).

## Features

**Unified Dashboard** — See GitHub issues from multiple repos and TickTick tasks in one view. Filter by repo, assignee, or backlog status.

**Interactive TUI** — Vim-style navigation (`j`/`k`), section collapsing, search (`/`), multi-select with bulk actions, and a detail panel on wide terminals.

**Issue Actions** — Pick up issues (`p`), assign/unassign (`a`/`u`), change status (`m`), comment (`c`), create issues (`n`) — all without leaving the terminal.

**Focus Mode** — Built-in Pomodoro timer (`f`). Lock onto an issue and focus for 25 minutes (configurable).

**Auto-Refresh** — Background refresh with age indicators (green/yellow/red) and failure tracking. Manual refresh with `r`.

**Toast Notifications** — Every async operation shows clear feedback. Errors persist with retry hints.

**Board Profiles** — Multiple board configurations for different contexts (work, personal, etc.).

**TickTick Optional** — Works with just GitHub. Enable TickTick integration when you want it.

**Agent-Friendly** — Every command supports `--json` for structured output, making hog scriptable and LLM-friendly.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate down / up |
| `Tab` / `Shift+Tab` | Next / previous section |
| `Enter` | Open in browser (item) or toggle (section) |
| `Space` | Toggle section or multi-select |
| `/` | Search |
| `p` | Pick issue (assign + sync to TickTick) |
| `a` / `u` | Assign / unassign |
| `m` | Change status |
| `c` | Comment |
| `n` | Create issue |
| `f` | Focus mode (Pomodoro) |
| `r` | Refresh |
| `?` | Help |
| `q` | Quit |

## Commands

### `hog board`

Open the unified task dashboard.

```sh
hog board --live                    # interactive TUI with auto-refresh
hog board --json                    # full board data as JSON
hog board --mine --json             # only my assigned issues + tasks
hog board --backlog --json          # only unassigned issues
hog board --repo myrepo --json      # filter by repo
hog board --profile work --live     # use a named profile
```

### `hog pick`

Assign a GitHub issue to yourself and create a linked TickTick task.

```sh
hog pick myrepo/145
```

### `hog task`

Manage TickTick tasks directly.

```sh
hog task list                       # list tasks
hog task add "Ship the feature"     # create task
hog task add "Bug fix" -p high -t "urgent"
hog task complete <taskId>
hog task update <taskId> --title "New title" -p medium
hog task delete <taskId>
hog task projects                   # list TickTick projects
hog task use-project <projectId>    # set default project
```

### `hog config`

View and manage configuration.

```sh
hog config show                     # show full config
hog config repos                    # list tracked repos
hog config repos:add owner/repo --project-number 1 --status-field-id PVTSSF_xxx --completion-type closeIssue
hog config repos:rm reponame

hog config ticktick:enable          # enable TickTick integration
hog config ticktick:disable         # disable TickTick integration

hog config profile:create work      # create profile from current config
hog config profile:delete work
hog config profile:default work     # set default profile
```

### `hog init`

Interactive setup wizard. Detects your GitHub user, lets you pick repos, and configures everything.

```sh
hog init            # interactive setup
hog init --force    # overwrite existing config
```

### `hog sync`

Sync GitHub issues with TickTick tasks.

```sh
hog sync run            # run sync
hog sync run --dry-run  # preview changes
hog sync status         # show sync mappings
```

## Configuration

Config lives at `~/.config/hog/config.json`. Created by `hog init` or manually.

```jsonc
{
  "version": 3,
  "repos": [
    {
      "name": "owner/repo",
      "shortName": "repo",
      "projectNumber": 1,
      "statusFieldId": "PVTSSF_xxx",
      "completionAction": { "type": "closeIssue" },
      "statusGroups": ["In Progress", "Todo,Backlog"]  // optional
    }
  ],
  "board": {
    "refreshInterval": 60,   // seconds (min: 10)
    "backlogLimit": 20,
    "assignee": "your-github-username",
    "focusDuration": 1500    // seconds (25 min)
  },
  "ticktick": {
    "enabled": true          // set false to use without TickTick
  },
  "profiles": {},            // named board profiles
  "defaultProfile": ""       // profile to use by default
}
```

### Status Groups

By default, hog auto-detects status columns from your GitHub Project. Override per-repo with `statusGroups`:

```json
"statusGroups": ["In Progress", "In Review", "Todo,Backlog"]
```

Each entry is a section. Comma-separated values merge into one section (header = first value). Terminal statuses (Done, Shipped, Closed, etc.) are always hidden.

### Profiles

Create different board configs for different contexts:

```sh
hog config profile:create work
hog config profile:default work
hog board --profile personal --live
```

## Requirements

- **Node.js 22+**
- **GitHub CLI** (`gh`) — authenticated via `gh auth login`
- **TickTick account** — optional, for task sync

## License

MIT
