# Migrating from hog v1 to v2

## What changed

hog v2 is a pipeline orchestrator. The GitHub Issues dashboard was removed. Pipelines are the core product; GitHub is an optional sync target.

## Removed commands

| v1 command | v2 replacement | Notes |
|------------|---------------|-------|
| `hog board --live` | `hog cockpit` | Pipeline-focused TUI |
| `hog board --json` | (removed) | Use `hog pipeline list --json` |
| `hog pick <ref>` | `hog pipeline create --issue <ref>` | Starts a pipeline linked to the issue |
| `hog issue create` | `gh issue create` | Use GitHub CLI directly |
| `hog issue show/close/reopen/move/assign/comment` | `gh issue ...` | Use GitHub CLI directly |
| `hog task *` | (removed) | TickTick was dropped in v1.x |
| `hog sync *` | (removed) | TickTick sync was dropped in v1.x |

Running any removed command prints a helpful migration message — you won't see "unknown command."

## New commands

| Command | What it does |
|---------|-------------|
| `hog cockpit` | Pipeline monitoring TUI |
| `hog pipeline create` | Start a new AI development pipeline |
| `hog pipeline list/status/pause/resume/cancel/done` | Pipeline management |
| `hog decisions` | View and resolve pending human decisions |
| `hog beads status/start/stop` | Manage the Beads/Dolt server |

## Config migration (v4 to v5)

Config is automatically migrated on first run. The migration:

1. Adds a `pipeline` section derived from `board` settings
2. Bumps version from 4 to 5
3. Preserves all existing fields

| v4 path | v5 path |
|---------|---------|
| `board.assignee` | `pipeline.owner` |
| `board.workflow.maxConcurrentAgents` | `pipeline.maxConcurrentAgents` |
| `board.workflow.defaultPhases` | `pipeline.phases` |
| `board.workflow.phasePrompts` | `pipeline.phasePrompts` |
| `board.workflow.notifications` | `pipeline.notifications` |
| `board.claudeLaunchMode` | `pipeline.launchMode` |
| `board.claudeTerminalApp` | `pipeline.terminalApp` |

The `board` section is kept for backward compatibility but is no longer the primary config.

## New requirements

- **Beads** (`bd` CLI) — required for pipelines. Install from [github.com/steveyegge/beads](https://github.com/steveyegge/beads).
- **GitHub CLI** (`gh`) — now optional, only needed if you configure GitHub sync.
