---
title: "fix: hog prepares inputs, skills stay standalone"
type: plan
date: 2026-03-29
status: approved
confidence: high
---

# Hog Prepares Inputs, Skills Stay Standalone

> The orchestrator's job is to prepare the right inputs. The skill's job is to do the work.

**One-line summary:** Replace prompt-based scope hints with filtered input files —
each parallel agent gets its own stories file containing only its assigned stories.

## Problem Statement

When hog splits 17 stories across 3 parallel test-writer agents, it currently:
1. Passes the FULL stories file to all 3 agents via `$STORIES_PATH`
2. Appends a prompt suffix: "only handle STORY-001, STORY-002..."
3. Sets `$STORY_SCOPE` env var as a backup signal

This fails because:
- The agent may ignore prompt suffixes (skill loads, suffix gets buried)
- The agent may search for stories files and find multiple matches
- The agent has to understand parallelism — a concept it shouldn't know about
- We've been patching the SKILL.md with hog-specific `$STORY_SCOPE` handling

**The principle:** skills are standalone methodology. They should work identically
whether invoked by a human (`/marvin:test-writer`) or by hog. Hog's job is to
prepare inputs so the skill sees exactly what it needs — no more, no less.

## Proposed Solution

### For parallel agents: write filtered stories files

Instead of passing the full file + a hint, hog writes a filtered stories file per chunk:

```
.hog/parallel/test-0-stories.md   ← contains only STORY-001 through STORY-006
.hog/parallel/test-1-stories.md   ← contains only STORY-007 through STORY-012
.hog/parallel/test-2-stories.md   ← contains only STORY-013 through STORY-017
```

Each agent's `$STORIES_PATH` points to its filtered file. The skill reads it and
writes tests for everything in it. No `$STORY_SCOPE`, no prompt suffixes, no
skill modifications needed.

### For all agents: stop relying on prompt suffixes for context

Current: `prompt = "/marvin:test-writer" + contextSection + retrySection + scopeSuffix`

Problem: when using skills, everything after the slash command is unreliable.

Fix: all pipeline context goes through env vars and prepared files:
- `$STORIES_PATH` → the exact stories file (filtered if parallel)
- `$ARCH_PATH` → the exact architecture doc
- `$FEATURE_ID` → the pipeline feature ID
- Remove `scopeSuffix` parameter from `spawnForRole` entirely

## Tasks

### 1. Add `writeFilteredStories()` to story-splitter

- [ ] 1.1 New function that reads the full stories file, extracts sections
  matching the given story IDs, and writes them to a temp file:
  ```ts
  function writeFilteredStories(
    fullStoriesPath: string,
    storyIds: string[],
    outputPath: string,
  ): void
  ```
  Uses markdown section parsing: each `## STORY-NNN` section is kept or dropped.

- [ ] 1.2 `StoryChunk` gets a `filteredStoriesPath` field instead of `scopeInstruction`

### 2. Update conductor parallel spawn

- [ ] 2.1 Before spawning parallel agents, write filtered stories files:
  ```
  const dir = join(pipeline.localPath, ".hog", "parallel");
  mkdirSync(dir, { recursive: true });
  ```
  Each chunk gets `{dir}/test-{index}-stories.md`

- [ ] 2.2 Pass `filteredStoriesPath` as the agent's `$STORIES_PATH` override
  (overrides the pipeline-level stories path for this specific agent)

- [ ] 2.3 Remove `scopeSuffix` parameter from `spawnForRole` — no more prompt hints

- [ ] 2.4 Remove `$STORY_SCOPE` env var — no longer needed

- [ ] 2.5 Clean up `.hog/parallel/` after test phase completes

### 3. Revert skill modifications

- [ ] 3.1 Remove `$STORY_SCOPE` handling from `test-writer/SKILL.md`
- [ ] 3.2 Remove the over-specific "Do NOT search" language — the skill should
  just follow `$STORIES_PATH` when set, search when not. That's all.
- [ ] 3.3 Sync to installed plugins

### 4. Add `.hog/` to `.gitignore`

- [ ] 4.1 Ensure `.hog/parallel/` temp files don't get committed

## Acceptance Criteria

- [ ] Each parallel test-writer agent writes tests ONLY for its assigned stories
- [ ] No `$STORY_SCOPE` env var or prompt suffix used
- [ ] test-writer SKILL.md has zero hog-specific logic
- [ ] Filtered stories files are cleaned up after the phase
- [ ] Non-parallel pipelines work identically (no regression)

## Decision Rationale

### Why filtered files instead of env vars?

Skills read files. That's their natural interface. Passing structured data via env
vars or prompt suffixes is fighting the skill's design. A filtered stories file IS
the stories — the skill doesn't need to know it's a subset.

### Why not worktrees?

Worktrees are the ideal solution (each agent gets a full isolated copy with filtered
inputs), but they're not enabled in the current config. Filtered files work without
worktrees — they're written to the project directory and cleaned up after.

### Why remove scopeSuffix entirely?

Prompt suffixes after slash commands are unreliable. If the skill needs context,
it should come through files or env vars — not appended text that may or may not
be visible after skill loading. This is the "orchestrator prepares inputs" principle.
