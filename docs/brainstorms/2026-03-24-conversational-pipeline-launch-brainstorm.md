# Conversational Pipeline Launch

**Date:** 2026-03-24
**Status:** draft
**Builds on:** [Pipeline Interaction Model](2026-03-24-pipeline-interaction-model-brainstorm.md)

## What We're Building

Pipelines emerge from any Claude Code session — not just the cockpit. You're mid-conversation, an idea forms, and thirty seconds later it's being built autonomously while you keep working.

**The shift:** The cockpit becomes a monitoring tool, not a launch pad. The entry point for pipeline creation is wherever you already are.

### The Two Paths

**Path A: Cockpit-initiated (existing, stays as fallback)**
P → type idea → brainstorm session → stories → `/pipeline` → autonomous work

**Path B: Organic (new, primary path)**
You're in any Claude Code session → idea emerges → brainstorm inline → stories → `/pipeline` or Claude offers → fire-and-forget → continue your current work

## Why This Approach

The cockpit P→Z flow forces a context switch: leave your creative space → enter dashboard → start pipeline → return to creative space. Real features don't start from blank prompts — they start from a conversation where you notice something needs building.

By making any session pipeline-capable, we eliminate the context switch entirely. The cockpit still exists for monitoring, status, and decision-making — which is what dashboards are for.

## Key Decisions

### 1. Trigger: Intent detection + explicit confirmation

Claude detects intent ("let's build this", "we should add OAuth") and offers: "Want me to spin up a pipeline?" User confirms with "yes" or types `/pipeline` explicitly. Belt and suspenders — magical but no misfires.

### 2. Handoff: Conductor owns creation via `hog pipeline create` CLI

A new CLI command: `hog pipeline create --title "..." --stories tests/stories/slug.md --brainstorm-done`

- Creates the 6-bead DAG with brainstorm already closed
- Stories agent starts immediately on next conductor tick
- Single source of truth — same `Conductor.startPipeline()` path as cockpit
- Validation, atomicity, existing tick loop just works

Why not Beads directly? Conductor needs to discover/adopt orphan DAGs (new code path), race conditions during multi-bead creation, no validation for malformed DAGs.

### 3. Convergence: Claude offers, `/pipeline` as backup

After writing stories, Claude says: "We've got N stories with acceptance criteria. Want me to kick off the pipeline?" User says "yes" → Claude runs `hog pipeline create`.

Alternative: user types `/pipeline` at any time for explicit control.

### 4. Three-layer architecture for reliability

| Layer | Purpose | When |
|-------|---------|------|
| **CLAUDE.md** | Intent — tells cockpit-launched sessions about pipeline creation | Brainstorm sessions only |
| **Skill (`/pipeline`)** | Capability — teaches any session how to create a pipeline | On-demand, any session |
| **Hook** | Safety net — detects orphaned stories without a pipeline | After story files written |

### 5. Fire-and-forget from organic sessions

When `/pipeline` runs from an organic session (not cockpit-initiated):
- Stories file is in your current working directory
- `hog pipeline create` picks it up, creates DAG with brainstorm pre-closed
- Stories agent starts in its own worktree — your branch is untouched
- Cockpit shows the new pipeline on next poll
- You continue your current work uninterrupted

### 6. Minimal brainstorm CLAUDE.md

The cockpit-launched brainstorm CLAUDE.md stays small:
- You're brainstorming with the human
- Write stories to `tests/stories/`
- When done, offer to run `hog pipeline create` or user types `/pipeline`
- No `bd close` — the CLI handles bead lifecycle

The `/pipeline` skill carries the heavy instructions (story format, pipeline flags, error handling). CLAUDE.md just sets the scene.

## Components

### `hog pipeline create` CLI command
- New subcommand in `src/cli.ts`
- Flags: `--title`, `--description`, `--stories <path>`, `--brainstorm-done`, `--repo`
- Calls `Conductor.startPipeline()` internally
- If `--brainstorm-done`: creates DAG then immediately closes the brainstorm bead
- Outputs pipeline ID and status for the calling session to confirm

### `/pipeline` Claude Code skill
- Loaded on-demand when user types `/pipeline` or Claude detects pipeline intent
- Walks through: confirm title → review/write stories → run `hog pipeline create`
- Works from any session — cockpit-launched or organic
- Handles errors (beads not installed, no repo config, etc.)

### Stories hook (safety net)
- Claude Code hook on file write to `tests/stories/**`
- If stories exist but no pipeline references them → nudge: "Stories written. Run `/pipeline` to start autonomous work."
- Prevents orphaned stories that never become pipelines

### Updated brainstorm CLAUDE.md
- Remove `bd close` instructions
- Add: "When stories are ready, offer to run `/pipeline` or let the user invoke it"
- Keep under 30 lines — scene-setting only, skill carries the details

## Resolved Questions

1. **Story format contract** — The `/pipeline` skill includes the exact story format spec (STORY-001 IDs, acceptance criteria checklist, edge cases). Brainstorms write correct format. Stories agent normalizes as safety net if format drifts.

2. **Existing `hog work` overlap** — `hog work` gets replaced by `hog pipeline create`. Clean break, one command, one way to create pipelines.

## Open Questions

1. **Multi-repo** — If you're in repo A and want to create a pipeline for repo B, how does `hog pipeline create` know which repo? Flag? Auto-detect from cwd?

2. **Cockpit notification** — When a pipeline is created from an organic session, should the cockpit toast immediately or wait for the next poll? (Current poll is 3s — probably fine.)

## What This Enables (Future)

- **Pipeline from GitHub issue**: Select issue in cockpit → `/pipeline` → brainstorm from issue context → autonomous work
- **Pipeline from Slack**: Paste thread → extract feature → `/pipeline`
- **Pipeline chains**: One pipeline's output seeds another pipeline's brainstorm
- **Team pipelines**: Multiple humans brainstorm the same pipeline from different sessions
