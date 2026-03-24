---
title: "feat: Conversational pipeline launch — pipelines emerge from any session"
type: plan
date: 2026-03-24
status: complete
brainstorm: docs/brainstorms/2026-03-24-conversational-pipeline-launch-brainstorm.md
confidence: high
---

# Conversational Pipeline Launch

**One-line summary:** Replace `hog work` with `hog pipeline create`, add a `/pipeline` Claude Code skill, update the brainstorm CLAUDE.md to use the new command instead of `bd close`, and add a stories safety-net hook.

## Problem Statement

The cockpit P→Z flow forces a context switch: leave your creative space → enter dashboard → start pipeline → return to creative space. Real features start from conversations where you notice something needs building. Pipelines should emerge from wherever you already are.

## Proposed Solution

Four components that work together:

1. **`hog pipeline create`** — CLI command that creates a pipeline with brainstorm pre-closed
2. **`/pipeline` skill** — teaches any Claude Code session how to create pipelines
3. **Updated brainstorm CLAUDE.md** — replaces `bd close` with `hog pipeline create`
4. **Stories hook** — safety net that nudges when stories exist without a pipeline

---

## Implementation Tasks

### Phase 1: `hog pipeline create` CLI command

- [x] **1.1 Create `pipeline` subcommand group in `src/cli.ts`**
  Add `const pipelineCommand = program.command("pipeline").description("Pipeline management")`.
  Move status/pause/resume from `hog work` to `hog pipeline list`, `hog pipeline pause`, `hog pipeline resume`.

- [x] **1.2 Implement `hog pipeline create` subcommand**
  ```
  hog pipeline create <title> [--description <text>] [--stories <path>] [--brainstorm-done] [--repo <name>]
  ```
  - Uses `loadFullConfig()` + `resolveProfile()` (same pattern as `hog work`)
  - Resolves repo via `findRepo(config, opts.repo)` or falls back to `config.repos[0]`
  - Calls `Conductor.startPipeline(repo, repoConfig, title, description)`
  - If `--brainstorm-done`: after DAG creation, immediately close the brainstorm bead via `beads.close(localPath, pipeline.beadIds.brainstorm, "Brainstorm completed in session")`
  - Output: pipeline ID + status as JSON for the calling session to parse
  - **Fire-and-forget**: unlike `hog work`, exits after creation (no `await new Promise`)
  - Start conductor + agents, create pipeline, stop and exit

- [x] **1.3 Add `--brainstorm-done` flag to `Conductor.startPipeline`**
  Option A: Add a `skipBrainstorm` option to `startPipeline` that closes the brainstorm bead before the first tick.
  Option B: Keep `startPipeline` unchanged, close the bead from the CLI after creation.
  **Choose Option B** — simpler, keeps conductor unchanged. The CLI calls `beads.close()` directly after `startPipeline()` returns.

- [x] **1.4 Remove `hog work` command**
  Delete the `work` command block at `cli.ts:274-399`.
  Add a deprecation alias: `program.command("work").hidden()` that prints "Use `hog pipeline create` instead" and exits.

- [x] **1.5 Tests for `hog pipeline create`**
  - Creates pipeline with all 6 bead IDs
  - `--brainstorm-done` closes brainstorm bead
  - `--repo` resolves correct repo
  - Missing repo returns error
  - Fire-and-forget: process exits after creation

### Phase 2: `/pipeline` Claude Code skill

- [x] **2.1 Create skill directory and SKILL.md**
  Path: `.claude/skills/pipeline/SKILL.md`
  Project-local skill (not global) — lives in the hog repo.

  Frontmatter:
  ```yaml
  ---
  name: pipeline
  description: Create an autonomous development pipeline from the current conversation. Use when the user wants to turn a brainstormed feature into autonomous work.
  ---
  ```

- [x] **2.2 Write skill instructions**
  The skill walks through:
  1. Confirm the feature title (from conversation context or user input)
  2. Check if stories exist in `tests/stories/{slug}.md`
  3. If no stories: write them in the canonical format (STORY-001 IDs, acceptance criteria, edge cases)
  4. Review stories with the user: "We've got N stories. Ready to start the pipeline?"
  5. On confirmation: run `hog pipeline create "{title}" --stories tests/stories/{slug}.md --brainstorm-done`
  6. Report result: "Pipeline started: {featureId}. Check cockpit for progress."

  Include the exact story format spec:
  ```markdown
  ## STORY-001: Title
  Description of the story.
  ### Acceptance Criteria
  - [ ] Criterion 1
  - [ ] Criterion 2
  ### Edge Cases
  - Edge case to consider
  ```

- [x] **2.3 Add error handling guidance to skill**
  - "Beads not installed" → tell user to run `brew install beads`
  - "No localPath configured" → tell user to set it in `~/.config/hog/config.json`
  - Pipeline creation failed → show error, suggest retry

### Phase 3: Update brainstorm CLAUDE.md and prompt

- [x] **3.1 Update `BRAINSTORM_CLAUDE_MD` in `src/engine/role-context.ts`**
  Replace:
  ```
  - When the human confirms the stories are good, close the bead with `bd close`
  ```
  With:
  ```
  - When the human confirms the stories are good, run: `hog pipeline create "{title}" --stories tests/stories/{slug}.md --brainstorm-done`
  - Or the human can type `/pipeline` to trigger the pipeline skill
  ```

- [x] **3.2 Update `BRAINSTORM_PROMPT` in `src/engine/roles.ts`**
  Replace the `bd close {beadId}` instruction with:
  ```
  4. When you and the human are satisfied, create the pipeline:
     hog pipeline create "{title}" --stories tests/stories/{slug}.md --brainstorm-done
  ```
  Remove `{beadId}` from the template — no longer needed in the prompt.

- [x] **3.3 Remove `launchBrainstormSession` bead ID passing**
  In `conductor.ts`, the `launchBrainstormSession` method currently substitutes `{beadId}` in the prompt. Remove this since the CLI handles bead closing now. The brainstorm session doesn't need to know its bead ID.

- [x] **3.4 Update brainstorm role-context tests**
  - CLAUDE.md no longer mentions `bd close`
  - CLAUDE.md mentions `hog pipeline create`
  - Prompt no longer contains `{beadId}`

### Phase 4: Stories safety-net hook

- [x] **4.1 Create hook script**
  Path: `.claude/hooks/stories-nudge.sh`
  A `PostToolUse` hook that:
  - Reads the tool output from stdin JSON
  - Checks if the tool was `Write` and the path matches `tests/stories/**`
  - If so, outputs a nudge: "Stories written. Run `/pipeline` when ready to start autonomous work."

- [x] **4.2 Register hook in project settings**
  Add to `.claude/settings.local.json`:
  ```json
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write",
      "hooks": [{
        "type": "command",
        "command": ".claude/hooks/stories-nudge.sh"
      }]
    }]
  }
  ```

- [x] **4.3 Test hook behavior**
  - Writing to `tests/stories/foo.md` triggers the nudge
  - Writing to other paths does NOT trigger
  - Nudge text includes `/pipeline`

### Phase 5: Integration tests

- [x] **5.1 End-to-end: organic session flow**
  Mock test: write stories → run `hog pipeline create --brainstorm-done` → pipeline created with brainstorm closed → stories agent ready.

- [x] **5.2 End-to-end: cockpit brainstorm flow**
  Existing brainstorm session → `hog pipeline create --brainstorm-done` instead of `bd close` → pipeline advances to stories.

- [x] **5.3 Backwards compatibility**
  `hog work` prints deprecation message.
  Existing cockpit P→Z flow still works (brainstorm bead can still be closed via `bd close` as fallback).

---

## Acceptance Criteria

1. `hog pipeline create "OAuth login" --brainstorm-done` creates a 6-bead DAG with brainstorm already closed
2. `/pipeline` skill walks user through story writing and pipeline creation from any session
3. Brainstorm CLAUDE.md instructs `hog pipeline create` instead of `bd close`
4. Stories hook nudges when `tests/stories/` is written without a pipeline
5. `hog work` shows deprecation message pointing to `hog pipeline create`
6. Cockpit P→Z flow still works as fallback
7. Fire-and-forget: `hog pipeline create` exits after creation, cockpit picks up pipeline on next poll

## Decision Rationale

### Why `hog pipeline create` instead of direct Beads API?

Conductor owns pipeline creation → single source of truth, validation, atomicity. The CLI is a thin client that calls `Conductor.startPipeline()`. No orphan DAG discovery, no race conditions during multi-bead creation.

### Why a Claude Code skill instead of just CLAUDE.md?

CLAUDE.md is for cockpit-launched brainstorm sessions only. The `/pipeline` skill works from ANY session — including organic conversations where you realize something needs building. Skills load on-demand and don't pollute the base context.

### Why fire-and-forget?

When you create a pipeline from an organic session, you don't want to stop what you're doing. The pipeline is independent — your branch stays untouched, agents work in worktrees.

## Risk Analysis

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| `hog pipeline create` fails silently | Pipeline never starts | Low | CLI outputs JSON result, skill checks exit code |
| Stories format drift | Tests agent can't parse stories | Medium | Skill includes exact format spec, stories agent normalizes |
| Hook fires too aggressively | Annoying nudges | Low | Only fires on `tests/stories/**` write, once per file |
| `hog work` users confused by deprecation | Support burden | Low | Clear deprecation message with exact replacement command |

## References

- [Brainstorm: Conversational Pipeline Launch](../brainstorms/2026-03-24-conversational-pipeline-launch-brainstorm.md)
- [Plan: Pipeline Interaction Model](2026-03-24-feat-pipeline-interaction-model-plan.md)
- [cli.ts:274-399](../../src/cli.ts) — current `hog work` command
- [conductor.ts:174-254](../../src/engine/conductor.ts) — `startPipeline()` method
- [role-context.ts:17-39](../../src/engine/role-context.ts) — brainstorm CLAUDE.md template
- [roles.ts:22-41](../../src/engine/roles.ts) — brainstorm prompt template
