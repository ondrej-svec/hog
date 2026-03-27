---
title: "feat: Pipeline v2 — real code, parallel agents, smarter orchestration"
type: plan
date: 2026-03-27
status: in_progress
brainstorm: null
confidence: medium
---

# Pipeline v2 — Real Code, Parallel Agents, Smarter Orchestration

**One-line summary:** Fix the three structural failures that caused Pipeline v1 to produce scaffolding instead of real code, and add parallel agent support to cut pipeline time from 2+ hours to ~30 minutes.

## Problem Statement

The first real pipeline run ("Agentic Content Pipeline v2") exposed three fundamental problems:

1. **Scaffolding, not code** — The impl agent produced stubs satisfying test assertions rather than real implementations. 294 tests pass against simulated behavior. Root cause: no architecture context flows between agents, impl sees only tests (no intent), and tests optimize for runnability over reality.

2. **Serial bottleneck** — Impl (Opus) spent 100 minutes sequentially implementing 25 files. Stories and tests also run serially. Total wall time: 2+ hours.

3. **Feedback loops are broken** — The redteam→impl loop re-opened beads but didn't block downstream phases. GREEN verification rejected good code because of pre-existing failures. The conductor spammed logs and got stuck in loops.

## Proposed Solution

Three workstreams, each independently shippable:

**A. Structured context flow** — Architecture doc produced by brainstorm, visible to ALL agents. Impl sees stories + architecture, not just tests. Tests enforce real behavior.

**B. Parallel agents** — Split work per-story. Multiple impl agents in worktrees, merged by refinery.

**C. Quality intelligence** — Stub detection gate. Smarter prompts that produce real integrations.

---

## Workstream A: Structured Context Flow

**Goal:** Every agent has the context it needs to produce real code, not just satisfy test assertions.

### Tasks

- [x] **A.1 Add architecture doc to brainstorm output**
  The brainstorm phase already produces stories. Add a second output: `tests/stories/{slug}.architecture.md` containing:
  - External dependencies and which packages to use
  - Integration pattern (dependency injection, constructor params)
  - Which components need real implementations vs. pure logic
  - File structure and module boundaries

  The brainstorm prompt already delegates research to subagents — add "produce an architecture doc" to Phase 3.

- [x] **A.2 Pass architecture doc to ALL subsequent agents**
  In `role-context.ts`, update CLAUDE.md templates for test, impl, redteam, and merge:
  - Add to allowed reads: `tests/stories/{slug}.architecture.md`
  - Modify prompt templates to reference it: "Read the architecture doc for integration patterns and dependency choices"

- [x] **A.3 Relax impl isolation — give it stories + architecture**
  Current prompt: "You can ONLY see the failing tests"
  New prompt: "You have three inputs: (1) failing tests, (2) user stories for intent, (3) architecture doc for how to build it"

  Rationale: In real TDD, the developer who reads tests also wrote them. Here, a different agent wrote them. Without intent, impl reverse-engineers from assertions and produces stubs.

  Keep the core constraint: impl still can't see the original spec/brainstorm. Stories + architecture are the filtered view.

- [x] **A.4 Update test prompt for two-tier testing**
  Current: tests just need to fail
  New: tests must enforce real behavior, not just mock contracts

  Add to test prompt:
  - "If the architecture doc specifies a real library (e.g., rss-parser), write tests that would FAIL if the implementation returns hardcoded data instead of real parsed results"
  - "Use dependency injection: test against interfaces, not mocks. The impl should provide real implementations by default."
  - "Each test file must have at least one test that verifies the code does real work (not just returns a fixture)"

- [x] **A.5 Add stub detection gate after impl**
  New verification step in `conductor.ts` after GREEN passes:
  - Grep impl's changed files for patterns: `return \{`, hardcoded template literals >3 lines, `// stub`, `// mock`, `// TODO`
  - Check that imports match architecture doc (if arch says "use rss-parser", verify `import` exists)
  - If stub ratio >30% of changed files, log warning and re-open impl bead with message: "Implementation appears to be scaffolding. Read the architecture doc and implement real behavior."

  This is advisory for v1 (warning), blocking in v2.

### Decision Rationale

**Why not full filesystem isolation?** The current approach relies on prompt compliance. Real sandboxing (chroot, separate repos) would prevent agents from reading project context. The tradeoff: trust the model but verify via quality gates.

**Why stories + architecture, not just architecture?** Stories carry user intent ("what" and "why"). Architecture carries technical decisions ("how"). Impl needs both to make good decisions. Tests alone only carry "what to assert."

---

## Workstream B: Parallel Agents

**Goal:** Cut pipeline time from 2+ hours to ~30 minutes by running multiple agents per phase.

### Tasks

- [ ] **B.1 Add story-level work splitting to conductor**
  When a phase bead becomes ready, the conductor:
  1. Reads `tests/stories/{slug}.md` and extracts story IDs (STORY-001, etc.)
  2. Groups stories into chunks based on `maxConcurrentAgents` config (default 3)
  3. Creates sub-tasks: each agent gets a prompt scoped to its story subset

  For test phase: "Write tests for STORY-001 through STORY-008 only"
  For impl phase: "Implement code for tests matching STORY-001 through STORY-008 only"

  Stories agent stays serial (one agent writes all stories — it's fast already).
  Redteam stays serial (needs to see full implementation).
  Merge stays serial (one merge operation).

- [ ] **B.2 Parallel worktree spawning**
  The conductor already creates worktrees per agent. For parallel agents:
  1. Create N worktrees (one per story chunk)
  2. Spawn N agents, each in their own worktree
  3. Each agent works on its subset independently
  4. Track all N sessions in `sessionToPipeline` map

  The `maxConcurrentAgents` config controls parallelism (default 3).

- [ ] **B.3 Parallel completion tracking**
  The phase bead closes only when ALL parallel agents complete:
  1. Track `pendingAgents` count per bead
  2. On each `agent:completed`, decrement counter
  3. When counter reaches 0, close the bead and run GREEN/quality verification
  4. If any agent fails, re-open only its story chunk (not the whole phase)

- [ ] **B.4 Refinery merge queue for parallel results**
  The refinery already handles serial merge. For parallel:
  1. All N worktree branches queue into the refinery
  2. Refinery merges them one-at-a-time (serial is fine — merges are fast)
  3. Each merge: rebase onto previous result → test → fast-forward
  4. If merge conflict: log which stories conflicted, re-open those chunks

- [ ] **B.5 Smart story grouping**
  Naive chunking (first 8, next 8, etc.) may split related stories across agents.
  Better: group by file/module when possible.

  Heuristic: stories mentioning the same source file or module go to the same agent.
  If no clear grouping, fall back to sequential chunking.

### Decision Rationale

**Why per-story splitting, not per-file?** Stories are the unit of work the pipeline understands. Test files are named after stories. Splitting by story naturally splits by test file, which naturally splits by implementation file.

**Why not subagents within Claude?** Claude Code CAN spawn subagents, but it's unreliable — the model decides whether to parallelize. Conductor-level parallelism is deterministic and observable.

**Why keep redteam serial?** Redteam needs to see the full implementation to find cross-cutting security issues. Splitting it would miss interaction bugs between modules.

---

## Workstream C: Quality Intelligence

**Goal:** Pipeline produces real code and catches scaffolding before it ships.

### Tasks

- [x] **C.1 Update impl prompt for real implementations**
  Replace the "minimum code" framing:

  Old: "Write the MINIMUM code needed to make all tests pass"
  New: "Implement REAL, production-quality code that makes all tests pass"

  Add:
  - "Read the architecture doc for which libraries and patterns to use"
  - "Use real HTTP calls, real SDK imports, real file I/O — not stubs or hardcoded data"
  - "If a test mocks an external dependency, implement the real version AND ensure the mock interface matches"
  - "Install npm packages if the architecture doc lists them"

- [x] **C.2 Update redteam prompt to detect scaffolding**
  Add to redteam responsibilities:
  - "Check if the implementation is real or scaffolding"
  - "If you find hardcoded return values, template strings, or functions that just return fixtures — write tests that would expose this (e.g., call with different inputs and verify different outputs)"
  - "If the architecture doc says 'use rss-parser' but the code doesn't import it, flag this"

- [x] **C.3 Use `--permission-mode auto` for agent spawning**
  Claude Code shipped auto mode (March 2026) — a classifier-backed alternative to
  `--dangerously-skip-permissions`. A separate Sonnet 4.6 model reviews each tool call
  and blocks risky actions (rm -rf, credential access) while allowing safe ones
  (file edits, npm install, test runs).

  Update `spawn-agent.ts`:
  - Add `--permission-mode auto` to agent args
  - Fallback: if auto mode fails (no Team plan), use `--permission-mode acceptEdits`
    with `--allowedTools "Read,Write,Edit,Bash(npm:*),Bash(npx:*),Bash(git:*)"`
  - Never use `--dangerously-skip-permissions` in pipeline agents

  The worktree + refinery remain the outer safety net — nothing merges without
  passing quality gates regardless of what the agent does in its worktree.

- [x] **C.4 Improve stories prompt for integration awareness**
  Add to stories prompt:
  - "For each story, note whether it requires external integration (API calls, CLI tools, file I/O) or is pure business logic"
  - "Mark integration stories with [INTEGRATION] tag"
  - "For integration stories, list the specific external dependency (e.g., 'RSS: rss-parser', 'LLM: @anthropic-ai/sdk')"

---

## Acceptance Criteria

### Workstream A (context flow)
- Architecture doc produced by brainstorm and readable by all agents
- Impl agent reads stories + architecture + failing tests (not just tests)
- Stub detection gate warns when >30% of impl files are scaffolding

### Workstream B (parallel)
- Test and impl phases run N agents in parallel (N = maxConcurrentAgents)
- Pipeline completes a 25-story feature in <45 minutes (vs. 2+ hours)
- Merge conflicts between parallel agents are detected and reported

### Workstream C (quality)
- impl prompt explicitly requires real implementations, not stubs
- Redteam detects and flags scaffolding via tests
- Agents can install npm packages without permission prompts

---

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| Claude Code `-p` mode supports `--permission-mode auto` | Verified | Shipped March 24, 2026. Requires Sonnet/Opus 4.6 + Team plan. Aborts after 3 blocked actions in `-p` mode. |
| Worktree parallel merges are conflict-free for independent stories | Likely | Stories touching different files won't conflict; same-file stories need grouping |
| Smart story grouping reduces conflicts | Unverified | Needs testing with real pipelines |
| Architecture doc improves impl quality | High confidence | The Bobo run proved that without context, impl produces stubs |
| Parallel agents stay within API rate limits | Medium | 3 concurrent Sonnet agents + rate limit detection already built |

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Parallel agents produce merge conflicts | Medium | Medium | Smart story grouping (B.5); refinery detects and re-queues conflicting chunks |
| Architecture doc is too vague to guide impl | Medium | High | Brainstorm prompt includes specific examples; redteam catches scaffolding |
| Auto mode classifier blocks legitimate agent actions | Low | Medium | Falls back to `acceptEdits` + explicit allowedTools; 0.4% false-positive rate per Anthropic |
| Rate limits hit with 3+ concurrent agents | Medium | Low | Rate limit auto-pause already built; stagger spawns by 10s |
| Story grouping heuristic fails | Low | Low | Falls back to sequential chunking; refinery handles conflicts |

---

## Implementation Order

**Phase 1 (ship first — highest impact):**
- A.3 (relax impl isolation)
- C.1 (update impl prompt)
- C.3 (skip-permissions flag)
- A.4 (two-tier test prompt)

These are prompt and config changes only. No conductor logic changes. Immediately improves code quality.

**Phase 2 (architecture flow):**
- A.1 (architecture doc in brainstorm)
- A.2 (pass to all agents)
- C.2 (redteam detects scaffolding)
- C.4 (stories integration awareness)
- A.5 (stub detection gate)

**Phase 3 (parallelism):**
- B.1 (story splitting)
- B.2 (parallel worktrees)
- B.3 (completion tracking)
- B.4 (refinery merge)
- B.5 (smart grouping)
