# hog

[![CI](https://github.com/ondrej-svec/hog/actions/workflows/ci.yml/badge.svg)](https://github.com/ondrej-svec/hog/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@ondrej-svec/hog)](https://www.npmjs.com/package/@ondrej-svec/hog)
[![codecov](https://codecov.io/gh/ondrej-svec/hog/branch/main/graph/badge.svg)](https://codecov.io/gh/ondrej-svec/hog)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

Your personal command deck — a unified task dashboard for GitHub Projects and TickTick, right in your terminal.

<!-- TODO: Add terminal recording -->
<!-- ![hog board demo](./docs/demo.gif) -->

## Quick Start

```sh
npm install -g @ondrej-svec/hog
hog init        # interactive setup wizard
hog board --live
```

Requires **Node.js 22+** and the [GitHub CLI](https://cli.github.com/) (`gh auth login`).

## Features

**Unified Dashboard** — GitHub issues from multiple repos and TickTick tasks in one view. Filter by repo, assignee, or backlog status.

**Interactive TUI** — Vim-style navigation (`j`/`k`), section collapsing, search (`/`), multi-select with bulk actions, and a detail panel on wide terminals.

**Issue Actions** — Pick up issues (`p`), assign/unassign (`a`/`u`), change status (`m`), comment (`c`), create issues (`n`), add/remove labels (`l`) — all without leaving the terminal.

**Natural Language Issue Creation** — Press `I` and type `fix login bug #backend @alice due friday`. hog extracts the title, labels, assignee, and due date automatically. Optional LLM enhancement via OpenRouter.

**Multi-Line Comments** — Press `ctrl+e` in the comment overlay to open your `$EDITOR` (vim, nano, VS Code, etc.) for longer notes.

**Copy Link** — Press `y` to copy the selected issue's URL to your clipboard.

**Focus Mode** — Built-in Pomodoro timer (`f`). Lock onto an issue and focus for 25 minutes (configurable).

**Auto-Refresh** — Background refresh with age indicators (green/yellow/red) and failure tracking. Manual refresh with `r`.

**Board Profiles** — Multiple board configurations for different contexts (work, personal, etc.).

**TickTick Optional** — Works with just GitHub. Enable TickTick integration when you want it.

**Agent-Friendly** — Every command supports `--json` for structured output, making hog scriptable and LLM-friendly.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate down / up |
| `↓` / `↑` | Navigate down / up |
| `Tab` / `Shift+Tab` | Next / previous section |
| `Space` | Toggle section (on header) or enter multi-select (on issue) |
| `Enter` | Open issue in browser (item) or toggle collapse (section) |
| `/` | Search |
| `n` | Create issue (form wizard) |
| `I` | Create issue from natural language |
| `p` | Pick issue (assign + sync to TickTick) |
| `a` / `u` | Assign / unassign |
| `m` | Change project status |
| `l` | Add / remove labels |
| `c` | Add comment |
| `ctrl+e` | Open `$EDITOR` for multi-line comment |
| `y` | Copy issue URL to clipboard |
| `f` | Focus mode (Pomodoro timer) |
| `C` | Collapse all sections |
| `r` / `R` | Refresh |
| `?` | Toggle help |
| `q` | Quit |

### Multi-Select

Press `Space` on any issue to enter multi-select mode, then:

| Key | Action |
|-----|--------|
| `Space` | Toggle item selection |
| `Enter` / `m` | Open bulk action menu |
| `Escape` | Clear selection and exit multi-select |

## Natural Language Issue Creation

Press `I` on the board to open the NL input. Type a description in plain English:

```
fix auth timeout on mobile #backend #bug @alice due friday
```

hog extracts:
- **Title** — `fix auth timeout on mobile`
- **Labels** — `backend`, `bug` (validated against repo labels)
- **Assignee** — `alice`
- **Due date** — parsed from `due friday`, `due end of month`, `due 2026-03-01`, etc.

A live preview shows the parsed fields before you confirm with `Enter`.

### Heuristic Tokens

These are extracted without any API key:

| Token | Example | Extracts |
|-------|---------|---------|
| `#word` | `#backend` | label |
| `@user` | `@alice` | assignee (`@me` → your GitHub login) |
| `due <expr>` | `due friday` | due date (chrono-node) |

Everything else becomes the title.

### LLM Enhancement (optional)

With an [OpenRouter](https://openrouter.ai) API key, hog sends ambiguous input to an LLM for richer title cleanup and inference. The heuristic tokens still take priority — LLM only fills gaps.

Set up during `hog init`, or any time with:

```sh
hog config ai:set-key sk-or-...   # store key
hog config ai:clear-key            # remove key
hog config ai:status               # show active source
```

Or set an environment variable (takes priority over the stored key):

```sh
export OPENROUTER_API_KEY=sk-or-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
```

### Agent-Native: `hog issue create`

Create issues non-interactively from scripts or AI agents:

```sh
hog issue create "fix login bug #backend @alice due friday" --repo owner/repo
hog issue create "add dark mode" --repo owner/repo --dry-run   # preview only
hog issue create "add dark mode" --repo owner/repo --json      # structured output
```

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

### `hog issue`

Manage issues from the command line.

```sh
hog issue create "fix login bug #backend due friday" --repo owner/repo
hog issue create "add dark mode" --repo owner/repo --dry-run
```

### `hog pick`

Assign a GitHub issue to yourself and create a linked TickTick task.

```sh
hog pick myrepo/145
```

### `hog task`

Manage TickTick tasks directly.

```sh
hog task list
hog task add "Ship the feature"
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
hog config show

# Repos
hog config repos
hog config repos:add owner/repo --project-number 1 --status-field-id PVTSSF_xxx --completion-type closeIssue
hog config repos:rm reponame

# TickTick
hog config ticktick:enable
hog config ticktick:disable

# AI / natural language issue creation
hog config ai:set-key sk-or-...     # store OpenRouter key
hog config ai:clear-key             # remove stored key
hog config ai:status                # show active source and provider

# Profiles
hog config profile:create work
hog config profile:delete work
hog config profile:default work
```

### `hog init`

Interactive setup wizard. Detects your GitHub user, picks repos, configures projects, and optionally sets up an OpenRouter key for AI-enhanced issue creation.

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

Config lives at `~/.config/hog/config.json`. Created by `hog init` or edited manually.

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
    "focusDuration": 1500    // seconds (25 min default)
  },
  "ticktick": {
    "enabled": true          // set false to use without TickTick
  },
  "profiles": {},
  "defaultProfile": ""
}
```

Credentials (TickTick OAuth token, OpenRouter API key) are stored separately in `~/.config/hog/auth.json` with `0600` permissions.

### Status Groups

By default, hog auto-detects status columns from your GitHub Project. Override per-repo:

```json
"statusGroups": ["In Progress", "In Review", "Todo,Backlog"]
```

Each entry is a board section. Comma-separated values merge into one section (header = first value). Terminal statuses (Done, Shipped, Closed, etc.) are always hidden.

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
- **OpenRouter API key** — optional, for AI-enhanced issue creation (`hog config ai:set-key`)

## License

MIT
