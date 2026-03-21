---
title: "feat: Transform hog into an opinionated agent development platform"
type: plan
date: 2026-03-21
status: in_progress
brainstorm: docs/brainstorms/2026-03-21-hog-agent-development-platform-brainstorm.md
confidence: medium
---

# Transform Hog into an Opinionated Agent Development Platform

**One-line summary:** Extract an orchestration engine from hog's TUI, integrate Beads as the agent task layer, and build a pipeline that structurally enforces TDD, security, and quality through role-separated agents.

## Problem Statement

Agent-assisted development today requires deep expertise (TDD, security, architecture) AND complex multi-tool orchestration (Beads, GitHub, Claude Code, worktrees). Most developers can't set this up. Hog should collapse both into a single opinionated experience — the "Rails of agent dev."

## Proposed Solution

Six-phase transformation, each shippable independently:

1. **Extract the engine** from the TUI — make orchestration work without Ink
2. **Integrate Beads** as the always-on agent task/memory layer
3. **Build the conductor** — an agent that manages the DAG and spawns role-separated workers
4. **Enforce TDD structurally** — test writer ≠ implementer, mutation testing, spec traceability
5. **Add continuous quality gates** — security, linting, abuse analysis woven into every step
6. **Build the Refinery** — worktree isolation + merge gatekeeper

The TUI evolves into one view of the engine (not the engine itself).

---

## Phase 1: Engine Extraction

**Goal:** All orchestration logic works without React/Ink. The TUI becomes a thin consumer.

**Why first:** Everything else depends on having a standalone engine. Can't add Beads, conductor, or quality gates to React hooks.

**Exit criteria:** `hog engine start` runs a background daemon that fetches data, manages agent sessions, and exposes an event stream. TUI connects to it instead of owning the logic.

### Tasks

- [x] **1.1 Create `src/engine/` directory structure**
  Establish the engine module boundary. All new engine code lives here.
  ```
  src/engine/
    index.ts          — public API
    event-bus.ts      — typed EventEmitter replacing toast/action-log callbacks
    state.ts          — in-memory state container (replaces React component state)
    agent-manager.ts  — extracted from use-agent-sessions.ts
    workflow.ts       — extracted from use-workflow-state.ts
    actions.ts        — extracted from use-actions.ts (GitHub mutations)
    orchestrator.ts   — extracted from use-launch-orchestration.ts
    fetch-loop.ts     — polling loop replacing use-data.ts setInterval
    daemon.ts         — background process lifecycle (start/stop/status)
  ```

- [x] **1.2 Extract `EventBus` — typed event system**
  Replace toast callbacks, action log, and `mutateData` with a typed EventEmitter.
  Events: `agent:spawned`, `agent:progress`, `agent:completed`, `agent:failed`, `data:refreshed`, `mutation:started`, `mutation:completed`, `mutation:failed`, `workflow:phase-changed`.
  This is the contract between engine and any UI (TUI, web, headless).

- [x] **1.3 Extract `AgentManager` from `use-agent-sessions.ts`**
  Pure TypeScript class. Holds tracked agents map, enrichment ref.
  Methods: `launchAgent(opts)`, `reconcileResults()`, `pollLiveness()`, `getActiveSessions()`.
  PID polling becomes a `setInterval` in the class, not a `useEffect`.
  `maxConcurrentAgents` enforcement moves here.
  Emits events via EventBus instead of calling toast.

- [x] **1.4 Extract `WorkflowEngine` from `use-workflow-state.ts`**
  Pure functions already exist: `resolvePhases`, `derivePhaseStatus`.
  Add: `getIssueWorkflow(issueNumber)`, `recordSession(session)`, `markSessionExited(id, exitCode)`.
  State stored in enrichment.ts (already TUI-independent).

- [x] **1.5 Extract `ActionExecutor` from `use-actions.ts`**
  All 9 mutation handlers become methods on a class.
  Remove: `mutateData` (optimistic UI), `toast` (→ EventBus), `pushEntry` (→ EventBus).
  Keep: the actual GitHub API calls (already in `src/github.ts`).
  Each method returns a `Result<T, Error>` instead of calling toast.

- [x] **1.6 Extract `Orchestrator` from `use-launch-orchestration.ts`**
  Dispatches between interactive (terminal) and background (spawn) launches.
  `resolvePhaseConfig` is already a pure exported helper — move to engine.
  Depends on AgentManager and WorkflowEngine.

- [x] **1.7 Build `FetchLoop` — polling data pipeline**
  Wraps `src/board/fetch.ts`'s `fetchDashboard()` in a polling loop.
  Emits `data:refreshed` events via EventBus.
  Configurable interval from `config.board.refreshInterval`.

- [x] **1.8 Build `Engine` class — component wiring + lifecycle**
  `hog engine start` — starts the engine as a background process.
  `hog engine stop` — graceful shutdown.
  `hog engine status` — running/stopped + active agents.
  Communicates via Unix socket or IPC (same pattern as Beads daemon).
  Writes PID file to `~/.config/hog/engine.pid`.

- [x] **1.9 Rewire TUI to consume engine**
  Replace hook internals with engine client calls.
  `use-agent-sessions.ts` → thin wrapper around `AgentManager` client.
  `use-workflow-state.ts` → thin wrapper around `WorkflowEngine` client.
  `use-actions.ts` → thin wrapper around `ActionExecutor` client.
  `use-data.ts` → subscribes to `data:refreshed` events from engine.
  Toast and action log subscribe to EventBus events.

- [x] **1.10 Add `--headless` mode to existing commands**
  `hog board --headless` outputs JSON events to stdout (no TUI).
  `hog launch --headless <issueRef>` spawns agent without terminal UI.
  Proves the engine works independently.

### Risks
- **State synchronization**: Engine daemon and TUI must agree on state. Mitigate: engine is authoritative, TUI is read-only + sends commands.
- **Backward compatibility**: Existing TUI users shouldn't notice a difference. Mitigate: TUI rewiring is internal; external behavior unchanged.

---

## Phase 2: Beads Integration

**Goal:** Beads is the agent-facing task/memory layer. GitHub remains the human collaboration layer. Hog bridges them.

**Why second:** The engine from Phase 1 provides the foundation. Beads gives agents the DAG they need for the pipeline.

**Exit criteria:** `hog init` sets up both GitHub and Beads. Agent sessions create/update beads. `bd ready` returns actionable work. GitHub issues sync bidirectionally with beads.

### Tasks

- [x] **2.1 Add Beads CLI client layer**
  Use the TypeScript SDK for daemon-connected access (DaemonTransport).
  Fallback: CLI wrapping via `execFile("bd", [...])` (mirrors `gh` pattern in `src/github.ts`).
  Add `bd` binary check to `hog init` (install guidance if missing).

- [x] **2.2 Build `src/engine/beads.ts` — Beads client layer**
  Wraps BeadsClient with hog-specific operations:
  - `createFeatureDAG(spec)` — creates the bead dependency graph for a feature
  - `getReady()` — wraps `bd ready`
  - `updateBead(id, status)` — wraps `bd update`
  - `closeBead(id, reason)` — wraps `bd close`
  - `addDependency(child, parent, type)` — wraps `bd dep add`
  - `getDAG(id)` — wraps `bd dep tree`
  Typed with Zod schemas matching the JSONL format.

- [x] **2.3 Build GitHub ↔ Beads sync**
  Bidirectional sync between GitHub Issues and Beads:
  - GitHub issue created → bead created (with GitHub issue URL in metadata)
  - Bead status changes → GitHub Project status updated
  - GitHub issue closed → bead closed
  - Sync runs on engine fetch loop (not real-time — poll-based)
  Uses `enrichment.json` to store GitHub↔Beads ID mapping (like the old TickTick sync-state).

- [ ] **2.4 Update `hog init` for Beads setup**
  Add Beads initialization to the setup wizard:
  - Check if `bd` is installed
  - Run `bd init` in each configured repo's `localPath`
  - Configure Beads actor name from GitHub username
  - Import existing GitHub issues into Beads via JSONL generation

- [ ] **2.5 Add Beads data to dashboard**
  Engine fetch loop includes Beads data alongside GitHub data.
  `DashboardData` gains `beads: BeadsData` field.
  TUI shows bead status, dependency graph, and `bd ready` count.

- [x] **2.6 Update agent spawn to create/claim beads**
  When an agent is spawned for work:
  - Find or create the corresponding bead
  - `bd update <id> --claim` (atomically sets assignee + in_progress)
  - On agent completion: `bd close <id> --reason "completed by agent"`
  - On agent failure: `bd update <id> --status blocked`
  Agent prompts include bead context (`bd show <id>` output).

### Decision Rationale
- **SDK over CLI**: Lower latency (<20ms via daemon socket vs ~200ms for process spawn). Change watching built-in. But CLI fallback ensures resilience.
- **Bidirectional sync over one-way**: Humans work in GitHub, agents work in Beads. Both need to see each other's updates. The sync-state pattern is proven (hog already did this with TickTick).

### Risks
- **Beads version compatibility**: SDK may lag behind `bd` CLI releases. Mitigate: CLI fallback for any missing SDK operations.
- **Sync conflicts**: Same issue updated in both GitHub and Beads simultaneously. Mitigate: GitHub is authoritative for human-facing fields (title, body, labels); Beads is authoritative for agent-facing fields (DAG, agent status, working memory).

---

## Phase 3: Conductor Agent

**Goal:** An intelligent agent that manages the development pipeline — creates bead DAGs from specs, spawns role-separated workers, handles stuck situations.

**Why third:** Requires both the engine (Phase 1) and Beads (Phase 2) to be in place.

**Exit criteria:** `hog work "Add user authentication"` creates a full bead DAG, spawns agents in dependency order, and manages the pipeline to completion (or flags blockers for human decision).

### Tasks

- [ ] **3.1 Build `src/engine/conductor.ts` — conductor core**
  The conductor is a long-running agent that:
  - Analyzes specs for clarity (the Clarity Analyst role)
  - Breaks features into bead DAGs with typed dependencies
  - Polls `bd ready` and spawns appropriate agents for unblocked beads
  - Monitors agent health via AgentManager
  - Handles stuck situations (retry, escalate to human, or reassign)
  - Maintains a decision log (every spawn, every escalation, every completion)

- [ ] **3.2 Build the Clarity Analyst**
  A specialized prompt/agent that evaluates spec completeness:
  - Checks for: acceptance criteria, scope boundary, edge cases identified, testability
  - Returns: `clear` (proceed autonomously), `unclear` (needs human input), `ambiguous` (specific questions)
  - Questions are queued for batched human interaction (not interrupts)
  - Uses the best available model (configurable in config)

- [ ] **3.3 Build `createFeatureDAG()` — spec → bead structure**
  Given a clear spec, creates the standard bead dependency graph:
  ```
  stories-bead → test-bead → impl-bead → redteam-bead → merge-bead
  ```
  Each bead has:
  - `type`: `task` with labels indicating role (`hog:stories`, `hog:test`, `hog:impl`, `hog:redteam`, `hog:merge`)
  - `blocks`/`blocked-by` dependencies enforcing order
  - Description containing role-specific instructions
  - Metadata: `{ hogRole, hogFeatureId, hogModel }`
  For larger features, the conductor breaks stories into sub-features, each with their own DAG.

- [ ] **3.4 Implement role-separated agent spawning**
  Each bead role maps to a different agent configuration:
  | Role | System prompt | What it sees | Model preference |
  |------|--------------|-------------|-----------------|
  | stories | "Write user stories with acceptance criteria" | Spec + project context | Best reasoning |
  | test | "Write failing tests from these stories" | User stories only | Strong reasoning |
  | impl | "Write code to pass these tests" | Tests only (NOT spec) | Strong coding |
  | redteam | "Find edge cases and security issues" | Tests + implementation | Different model than impl |
  | merge | "Rebase, run full suite, merge" | All code | Can be lighter model |

  The conductor enforces: test agent session ID ≠ impl agent session ID. Different `HOG_ROLE` env var per spawn.

- [ ] **3.5 Build the batched question queue**
  Questions from the Clarity Analyst (and later from stuck agents) accumulate in a queue.
  `hog decisions` shows pending questions.
  `hog decisions resolve` opens an interactive session to answer them.
  Alternatively, questions surface in the TUI board as a notification badge.
  Resolved answers unblock the corresponding beads.

- [ ] **3.6 Add `hog work` command**
  `hog work "description"` — starts the conductor for a feature.
  `hog work <issueRef>` — starts from an existing GitHub issue.
  `hog work --status` — shows all active conductor pipelines.
  `hog work --pause <featureId>` — pauses a pipeline.
  `hog work --resume <featureId>` — resumes a paused pipeline.

- [ ] **3.7 Conductor self-recovery**
  If the conductor agent's context fills up or it crashes:
  - State is persisted in Beads (bead statuses + enrichment.json)
  - New conductor instance reconstructs state from `bd list --json` + enrichment
  - In-progress agents continue (they're separate processes)
  - The conductor picks up where it left off

### Decision Rationale
- **Conductor as hog engine code, not an LLM agent**: The conductor's core loop (poll ready, spawn, monitor) is deterministic code. Only the Clarity Analyst and DAG creation use LLM calls. This keeps the conductor fast and predictable.
- **Batched questions over real-time**: Cal Newport's insight — protect deep work. Questions queue up, human resolves in batches.

### Risks
- **Clarity Analyst accuracy**: May be too conservative (blocks everything) or too permissive (lets garbage through). Mitigate: configurable threshold, log decisions for tuning.
- **DAG complexity**: Large features may produce deep dependency trees that serialize too much. Mitigate: conductor can parallelize independent sub-features.

---

## Phase 4: Structural TDD Enforcement

**Goal:** It is structurally impossible to produce untested code. Tests come first, from a different agent, and are verified for quality.

**Why fourth:** Requires the conductor (Phase 3) to enforce role separation.

**Exit criteria:** Every feature that goes through the pipeline has: (1) user stories traced to tests, (2) tests that were RED before implementation, (3) mutation testing score above threshold, (4) no orphan tests or uncovered stories.

### Tasks

- [ ] **4.1 Build test-first enforcement in conductor**
  The conductor's DAG creation already orders test-bead before impl-bead.
  Add verification: before marking test-bead as ready for impl:
  - Run the test suite → tests MUST fail (RED state)
  - If tests pass without implementation → they're trivial/wrong → reject, re-create test bead
  - Record the RED state as a bead comment (audit trail)

- [ ] **4.2 Build spec traceability system**
  Each user story gets a unique ID (e.g., `STORY-001`).
  Tests must reference their story ID (via comment, test name, or metadata).
  The conductor checks:
  - Every story has at least one test → no uncovered stories
  - Every test traces to a story → no orphan tests
  - Report stored as a bead comment on the merge-bead

- [ ] **4.3 Integrate mutation testing**
  After GREEN state (tests pass with implementation):
  - Run mutation testing framework (language-specific):
    - JS/TS: Stryker
    - Python: mutmut
    - Go: gremlins
    - Rust: cargo-mutants
  - Score must exceed configurable threshold (default: 70%)
  - If below threshold: create a new test-improvement bead blocking the merge-bead
  - Conductor spawns a test-improvement agent to strengthen weak tests

- [ ] **4.4 Build the implementer's blind spot**
  The implementation agent prompt explicitly excludes the original spec:
  ```
  You are implementing code to pass the following tests.
  You do NOT have access to the original feature specification.
  Your ONLY goal is to make these tests pass with clean, minimal code.
  ```
  The conductor strips spec content from the impl agent's context.
  Only the test file paths and test output are provided.

- [ ] **4.5 Add TDD metrics to dashboard**
  TUI shows per-feature:
  - Story coverage: X/Y stories have tests
  - RED→GREEN status: confirmed test-first
  - Mutation score: X% (with threshold indicator)
  - Spec traceability: complete/incomplete

### Decision Rationale
- **RED verification before GREEN**: The most important enforcement. Without it, agents write tests after code (rubber-stamp testing). Verifying RED state proves tests are genuine.
- **Mutation testing as automated quality check**: Removes the need for a human to evaluate "are these tests actually good?" The mutations answer it empirically.

### Risks
- **Mutation testing is slow**: Stryker on a large codebase can take minutes. Mitigate: only run on changed files, use incremental mode.
- **False RED rejections**: Tests may legitimately pass if the feature partially exists. Mitigate: conductor scopes tests to NEW functionality only, not regression tests.

---

## Phase 5: Continuous Quality Gates

**Goal:** Security, linting, and abuse analysis are woven into every agent's work, not post-hoc review.

**Why fifth:** Builds on the agent infrastructure from Phases 1-4.

**Exit criteria:** Every agent-written file is automatically scanned for security issues, linting violations, and common abuse patterns. Issues are flagged immediately (not at review time).

### Tasks

- [ ] **5.1 Build `src/engine/quality-gates.ts` — continuous analysis framework**
  A pluggable quality gate system that runs checks on every agent output:
  ```typescript
  interface QualityGate {
    name: string
    check(files: string[], context: QualityContext): Promise<QualityResult>
    severity: "error" | "warning" | "info"
  }
  ```
  Gates run in parallel after every agent commit/file change.
  Results are attached to the relevant bead as comments.

- [ ] **5.2 Security gate — static analysis**
  Integrate language-appropriate security scanners:
  - JS/TS: `semgrep` rules for injection, XSS, insecure crypto
  - Python: `bandit`
  - General: `trivy` for dependency vulnerabilities
  Run on every file the agent touches (incremental, not full repo).
  Security errors block the pipeline (create a fix-bead).
  Security warnings are logged but don't block.

- [ ] **5.3 Linting gate — code style enforcement**
  Use the project's existing linter (detect from config files):
  - `biome.json` → biome
  - `.eslintrc` → eslint
  - `ruff.toml` → ruff
  - `rubocop.yml` → rubocop
  Run on agent-modified files. Auto-fix where possible.
  Unfixable violations create a fix-bead.

- [ ] **5.4 Abuse/injection gate**
  Specialized checks for agent-common mistakes:
  - SQL injection in dynamic queries
  - Command injection in shell calls
  - Path traversal in file operations
  - Hardcoded secrets/credentials
  - Unsafe deserialization
  Uses semgrep rules + custom heuristics.
  Always blocks — these are never warnings.

- [ ] **5.5 Red Team agent enhancement**
  The Red Team agent (from the conductor pipeline) now has quality gate results as additional context:
  - "Security scanner found no issues, but verify these patterns: [list]"
  - "Mutation testing showed weakness in error handling — probe harder there"
  - Red Team writes additional tests targeting discovered weak spots
  Red Team results that surface new issues → new fix-beads in the DAG.

- [ ] **5.6 Gate configuration in `hog init`**
  `hog init` detects available tools and configures gates:
  - Auto-detect: project language, existing linter configs, available scanners
  - Install missing tools with user consent
  - Store gate config in `.hog/quality.json` (per-repo, committed to git)
  - Opinionated defaults: all gates enabled, security errors always block

### Decision Rationale
- **Incremental scanning over full-repo**: Agents change few files per task. Scanning only changed files keeps gates fast (seconds, not minutes).
- **Pluggable gates**: Different languages need different tools. The framework is universal; the scanners are pluggable.

### Risks
- **Scanner noise**: Security scanners produce false positives. Mitigate: curated rule sets, suppressions per-project in `.hog/quality.json`.
- **Tool installation burden**: Users need scanners installed. Mitigate: `hog init` handles it; quality gates degrade gracefully if a scanner is missing (warning, not error).

---

## Phase 6: The Refinery

**Goal:** Every agent works in an isolated worktree. A single merge gatekeeper serializes integration to main with full test + quality runs.

**Why last:** Requires the full pipeline (engine + Beads + conductor + quality gates) to be meaningful.

**Exit criteria:** Parallel agents work on isolated worktrees. The Refinery merges completed work via rebase, runs the full suite + all quality gates, and only merges to main if everything passes.

### Tasks

- [ ] **6.1 Build worktree manager**
  `src/engine/worktree.ts`:
  - `createWorktree(repo, branchName)` — `git worktree add`
  - `removeWorktree(path)` — `git worktree remove`
  - `listWorktrees(repo)` — `git worktree list --porcelain`
  Each agent spawn in the conductor gets its own worktree.
  Worktree cleanup happens after merge or on agent failure.

- [ ] **6.2 Update agent spawning for worktree isolation**
  Conductor's `spawnAgent` now:
  1. Creates a worktree for the agent's work
  2. Sets the agent's working directory to the worktree
  3. Agent commits to a feature branch in the worktree
  4. On completion: agent's branch is submitted to the merge queue

- [ ] **6.3 Build the merge queue**
  `src/engine/refinery.ts`:
  - A FIFO queue of completed agent branches
  - Processes one merge at a time (serialized)
  - For each entry:
    1. Rebase branch onto current main
    2. Run full test suite
    3. Run all quality gates (security, linting, abuse)
    4. If all pass → fast-forward main
    5. If rebase conflicts → attempt auto-resolve, else create fix-bead
    6. If tests fail → create fix-bead, notify conductor
  - Merge results logged to enrichment + bead comments

- [ ] **6.4 Build merge conflict resolution**
  When rebase produces conflicts:
  - Simple conflicts (whitespace, import order): auto-resolve
  - Complex conflicts: spawn a merge-resolution agent with both branches' context
  - Unresolvable: create a bead for human intervention, pause the pipeline

- [ ] **6.5 Add Refinery status to dashboard**
  TUI shows:
  - Merge queue depth
  - Current merge in progress (branch, tests running, etc.)
  - Recent merges (pass/fail, time taken)
  - Blocked merges awaiting human intervention

- [ ] **6.6 Add `hog refinery` command**
  `hog refinery status` — queue depth, current processing, recent merges
  `hog refinery pause` — stop processing (queue accumulates)
  `hog refinery resume` — resume processing
  `hog refinery retry <id>` — retry a failed merge
  `hog refinery skip <id>` — skip an entry (with reason)

### Decision Rationale
- **Rebase over merge commits**: Linear history is easier to audit, bisect, and understand. Agent commits are already atomic (one logical change per branch).
- **Serial processing**: Parallel merges would require speculative rebasing and increase conflict rates. One-at-a-time is simpler and sufficient at the scale hog targets (solo/small team, not 30 parallel agents like Gastown).

### Risks
- **Worktree disk usage**: Many parallel agents = many worktrees = disk space. Mitigate: aggressive cleanup after merge, configurable `maxWorktrees`.
- **Rebase divergence**: If main moves fast (many agents merging), later agents' branches diverge significantly. Mitigate: Refinery processes in order, agents can be notified to rebase proactively.

---

## Cross-Cutting Concerns

### Configuration Evolution (Config v5)

The config schema needs significant expansion. New additions:

```typescript
// New top-level sections
beads: {
  enabled: boolean          // default: true
  actorName: string         // default: GitHub username
  autoInit: boolean         // auto-init .beads/ in new repos
  compactInterval: string   // cron expression for bd compact
}

engine: {
  daemonMode: "auto" | "manual"   // auto-start on hog commands
  socketPath: string               // Unix socket location
  logLevel: "debug" | "info" | "warn" | "error"
}

conductor: {
  clarityModel: string            // model for Clarity Analyst
  testModel: string               // model for Test Writer
  implModel: string               // model for Implementer
  redteamModel: string            // model for Red Team
  refineryModel: string           // model for merge resolution
  clarityThreshold: "strict" | "moderate" | "permissive"
  maxConcurrentFeatures: number   // default: 3
  questionBatchInterval: number   // minutes between human decision prompts
}

quality: {
  tdd: {
    enforceRedFirst: boolean           // default: true
    mutationThreshold: number          // default: 70
    specTraceability: boolean          // default: true
  }
  security: {
    enabled: boolean                   // default: true
    blockOnError: boolean              // default: true
    scanners: string[]                 // auto-detected or explicit
  }
  linting: {
    enabled: boolean                   // default: true
    autoFix: boolean                   // default: true
  }
}

refinery: {
  enabled: boolean                     // default: true
  maxWorktrees: number                 // default: 10
  autoMerge: boolean                   // default: true (vs manual approval)
  requireAllGatesPass: boolean         // default: true
}
```

### Issue Tracker Abstraction

Prepare for pluggable issue trackers by introducing an interface:

```typescript
interface IssueTracker {
  fetchIssues(repo: string): Promise<Issue[]>
  createIssue(repo: string, opts: CreateIssueOpts): Promise<Issue>
  updateIssue(repo: string, id: string, opts: UpdateIssueOpts): Promise<void>
  closeIssue(repo: string, id: string): Promise<void>
  fetchProjectStatus(repo: string): Promise<StatusOption[]>
  updateStatus(repo: string, issueId: string, statusId: string): Promise<void>
}
```

Phase 1 implementation: `GitHubTracker` (wraps existing `src/github.ts`). Future: `LinearTracker`, `JiraTracker`, etc.

### Audit Trail

Every pipeline decision is logged:
- Bead creation/updates
- Agent spawn events (role, model, context hash)
- Quality gate results
- Merge events
- Human decisions (with timestamp)

Stored in Beads (as bead comments) + enrichment.json (for local history).

---

## Acceptance Criteria

1. `hog init` in a new repo sets up GitHub + Beads in under 5 minutes
2. `hog work "Add user authentication"` creates a bead DAG and starts the pipeline autonomously (if spec is clear)
3. Tests are always written before implementation, by a different agent
4. RED state is verified before implementation begins
5. Mutation testing runs automatically; weak tests are flagged and improved
6. Security/linting issues are caught during implementation, not at review
7. Every agent works in an isolated worktree
8. The Refinery merges to main only when all gates pass
9. Humans are only needed for creative decisions and batched question resolution
10. The TUI shows full pipeline visibility (DAG, agents, quality, merge queue)
11. `hog engine start` works without the TUI

## Risk Analysis

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Beads SDK breaks or project direction diverges | High | Low | CLI fallback always available; consider vendoring |
| Pipeline too slow (5+ agents per feature) | Medium | Medium | Parallelize independent sub-features; lighter models for non-critical roles |
| Mutation testing too slow for CI-like loops | Medium | High | Incremental mode; only mutate changed lines; configurable skip |
| Clarity Analyst too conservative | Medium | Medium | Configurable threshold; log decisions for tuning over time |
| Users reject opinionated approach | High | Medium | Allow `hog work --no-tdd` escape hatch (with warning), but never default |
| Worktree disk usage at scale | Low | Low | Aggressive cleanup; configurable max; warn at threshold |
| Engine daemon complexity (PID management, crashes) | Medium | Medium | Watchdog process; graceful restart from Beads state |

## Phased Delivery Timeline

| Phase | Depends On | Shippable As |
|-------|-----------|-------------|
| 1. Engine Extraction | Nothing | `hog@2.0.0-alpha` — engine daemon, headless mode |
| 2. Beads Integration | Phase 1 | `hog@2.0.0-beta` — Beads sync, agent-facing DAG |
| 3. Conductor | Phase 1 + 2 | `hog@2.0.0-rc` — `hog work` command, role separation |
| 4. TDD Enforcement | Phase 3 | `hog@2.0.0` — structural TDD, mutation testing |
| 5. Quality Gates | Phase 3 | Can ship with or after Phase 4 |
| 6. Refinery | Phase 1 | Can start after Phase 1; full value with Phase 3+ |

Phases 4, 5, and 6 can be developed in parallel once Phase 3 is stable.

## References

- [Brainstorm: Hog as the Rails of Agent-Assisted Development](../brainstorms/2026-03-21-hog-agent-development-platform-brainstorm.md)
- [Prior plan: Workflow Conductor](2026-03-01-feat-workflow-conductor-plan.md) — Phase 1 partially overlaps
- [Prior plan: Zen Mode + Agent Orchestration](2026-03-07-feat-zen-mode-agent-orchestration-plan.md) — TUI features integrate with engine
- [Beads SDK](https://github.com/HerbCaudill/beads-sdk) — TypeScript integration
- [Beads CLI](https://github.com/steveyegge/beads) — Agent memory system
- [Gastown](https://github.com/steveyegge/gastown) — Refinery pattern inspiration
