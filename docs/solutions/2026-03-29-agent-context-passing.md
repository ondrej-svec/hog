---
date: 2026-03-29
category: integration
tags: [agent-orchestration, claude-code, skills, env-vars, prompt-engineering, parallelism]
symptoms: "Agents ignore env vars, search filesystem instead of using provided paths, parallel agents bail or do duplicate work"
---

# Agent Context Passing: Prompt Text, Not Env Vars or Hints

## Symptoms

- Test-writer agent set `$STORIES_PATH=/path/to/quellis.md` but searched `docs/stories/`, found multiple files, asked "which one?" in headless mode, and exited in 52 seconds having written zero tests
- Parallel agents given `$STORY_SCOPE=STORY-001,STORY-002` ignored it — one did all the work, two exited immediately
- Impl agent given `$ARCH_PATH` started reading a plan file from a different feature
- Scaffold agent displayed as "Test Writer phase" (stale agent from previous pipeline)

## Root Cause

Three fundamental design mistakes, compounding:

### 1. Env vars are invisible to LLM agents

SKILL.md says "If `$STORIES_PATH` is set, read it." The agent interprets this as prose, not as an executable instruction. It would need to run `echo $STORIES_PATH` in Bash to see the value — but it doesn't think to do that. It just searches the filesystem, which is the skill's standalone fallback behavior.

**Rule: env vars are for programs, not for LLM agents. Put context in the prompt.**

### 2. Prompt suffixes after skill slash commands get buried

When the prompt is `/marvin:test-writer\n\nIMPORTANT: only handle STORY-001...`, Claude loads the skill, and the SKILL.md's instructions take over. The appended text may or may not be visible — it depends on how the skill processes its arguments. In practice, agents ignored it ~80% of the time.

**Rule: don't append instructions after a slash command. Put structured context BEFORE or use the skill's own input mechanism.**

### 3. Orchestrator-managed parallelism fights the agent model

Four iterations of parallel test-writing all failed:
1. Prompt suffix hints ("only handle these stories") — agents ignored them
2. `$STORY_SCOPE` env var — agents didn't check it
3. Filtered stories files (per-agent `.hog/parallel/test-0-stories.md`) — wrong paths, search confusion
4. All disabled — single agent works correctly

Each iteration added complexity (filtered file writing, bead claiming races, pendingParallelAgents tracking, healPipeline guards) that created new bugs.

**Rule: if agents need parallelism, let them use their own Agent tool to spawn sub-agents. The orchestrator's job is to prepare inputs for ONE agent per phase.**

## Solution

### What works: context in prompt text

```typescript
// GOOD: paths directly in the prompt
basePrompt = [
  resolvedPrompt,           // "/marvin:test-writer"
  "",
  `Stories file: ${resolvedStoriesPath}`,
  `Architecture doc: ${archPath}`,
  `Feature: ${pipeline.title}`,
].filter(Boolean).join("\n");
```

The agent sees the paths as part of its initial prompt. No need to check env vars, no searching, no ambiguity.

### What doesn't work

```typescript
// BAD: env vars — agent never checks them
env: { STORIES_PATH: "/path/to/stories.md" }

// BAD: prompt suffix after slash command — gets buried
prompt = "/marvin:test-writer\n\nIMPORTANT: only handle STORY-001"

// BAD: orchestrator splits work across multiple agents
const chunks = splitIntoChunks(storyIds, 3);
for (const chunk of chunks) {
  spawnForRole(pipeline, bead, role, chunk.scopeInstruction);
}
```

### Architecture principle

```
Orchestrator (hog)          Skill (SKILL.md)
─────────────────           ────────────────
Prepares inputs             Does the work
- Resolves file paths       - Reads files
- Puts paths in prompt      - Writes tests/code
- One agent per phase       - Can spawn sub-agents
- Manages retry gates       - Doesn't know about pipeline
- Tracks bead state         - Works identically standalone
```

The skill should work identically whether invoked by:
- A human: `/marvin:test-writer`
- hog: `/marvin:test-writer\n\nStories file: /path/to/stories.md`

No `$STORY_SCOPE`, no `$MERGE_CHECK` awareness, no parallel coordination logic in SKILL.md.

## Prevention

- [ ] Never add orchestrator-specific env var handling to SKILL.md files
- [ ] Always put file paths and context in the prompt text, not env vars
- [ ] Don't manage agent parallelism from the orchestrator — let agents use the Agent tool
- [ ] Test skill invocation with `claude -p "/skill:name\n\ncontext"` before trusting the pipeline
- [ ] Verify plugins are registered in `~/.claude/settings.json` — filesystem presence ≠ loaded

## Related

- [v2 plan](../plans/2026-03-29-feat-skills-first-pipeline-v2-plan.md) — the original plan that assumed env vars would work
- [Parallel agent plan](../plans/2026-03-29-fix-parallel-agent-input-preparation-plan.md) — the filtered-files attempt before removal
- Plugin registration: `enabledPlugins` in `~/.claude/settings.json` must list each plugin
