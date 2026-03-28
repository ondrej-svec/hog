---
title: "feat: Heart of Gold v2.1 — the most amazing agentic dev tool"
type: plan
date: 2026-03-28
status: in_progress
brainstorm: docs/audits/2026-03-28-hog-grand-audit.md
confidence: high
---

# Heart of Gold v2.1 — Master Plan

> "The Heart of Gold didn't navigate — it made arrival improbable to avoid.
> hog doesn't write code — it makes bad code improbable to produce."

**One-line summary:** Wire the fuel lines, close the gates, give it a soul.

## Problem Statement

hog has the most architecturally distinctive agent pipeline in existence — DAG-based orchestration,
structural role separation, RED verification, adversarial red team. No other tool has this combination.

But a combined audit (Claude + Codex gpt-5.3) revealed the engine is built but the fuel lines aren't
connected. Three requirements are **BROKEN** because `hogd.ts` never instantiates `WorktreeManager`
or `Refinery`. Budget enforcement is ghost code. The H2G2 identity — hog's strongest differentiator —
is a name with zero thematic execution.

**What shipped (plans DONE):**
- hogd daemon with Unix socket RPC, event streaming, demo mode, model router, replay
- Pipeline v2 with architecture doc flow, parallel agents, story-splitter
- Pipeline interaction model with brainstorm phase + tmux sessions

**What's pending:**
- Pipeline completeness gates (approved, NOT STARTED)
- Cockpit redesign polish (humanizer shipped, polish tasks P.1-P.7 pending)
- Drop GitHub board (tombstoned, board config schema still in codebase)
- Beads server lifecycle (core engine methods done, CLI surface pending)

**What's broken (Codex findings):**
- WorktreeManager + Refinery never instantiated → no isolation, no merge queue, no role-audit in production
- Budget schema exists, enforcement absent → users think they have cost protection but don't
- Event log is shared file, not per-pipeline → replay is brittle
- Session/worktree maps in-memory only → lost on daemon restart

## Proposed Solution

Five phases, dependency-ordered. Each phase has a clear exit criterion. The plan folds in
remaining work from partially-done plans and fills gaps from the audit.

```
Phase 1: Wire the Fuel Lines     ─── P0, enables everything else          (2-3 days)
Phase 2: Close the Gates         ─── P0/P1, completeness gates + fixes    (3-4 days)
Phase 3: Give It a Soul          ─── P1, H2G2 theming + cockpit polish    (2-3 days)
Phase 4: Clean the Ship          ─── P2, dead config, resilience          (1-2 days)
Phase 5: Chart the Course        ─── P2, policy-as-code + worker adapter  (3-5 days)
```

---

## Phase 1: Wire the Fuel Lines (P0 — 2-3 days)

**Goal:** Make the safety layers that exist as code actually run in production.

The Codex audit found that `WorktreeManager` and `Refinery` are **never instantiated anywhere**.
They exist as classes with tests, referenced in conductor.ts, but hogd.ts doesn't create them.
This single wiring gap is the root cause of 3 BROKEN ratings (FR-2, FR-7, FR-9) and 2 PARTIAL
ratings (FR-13, NFR-7).

### Tasks

- [x] 1.1 **Instantiate WorktreeManager in hogd.ts** — Create `WorktreeManager` instance in
  `HogDaemon` constructor. Pass it to both Conductor and Refinery.
  Files: `src/daemon/hogd.ts` (lines 44-53)

- [x] 1.2 **Instantiate and start Refinery in hogd.ts** — Create `Refinery` with EventBus +
  WorktreeManager. Call `refinery.start()` in constructor, `refinery.stop()` in `stop()`.
  The test command should come from pipeline context at submission time, not config.
  Files: `src/daemon/hogd.ts` (lines 44-53, 119-120)

- [x] 1.3 **Wire Conductor to submit to Refinery on phase completion** — When merge phase agent
  completes, submit the branch to Refinery queue instead of direct merge. Conductor already
  has the optional `refinery` parameter in its options — it just never receives one.
  Files: `src/engine/conductor.ts` (lines 1218-1234)

- [x] 1.4 **Wire Conductor to use WorktreeManager for agent spawning** — When spawning agents,
  create worktree if WorktreeManager is available. Conductor already checks `this.worktrees`
  at line 1026-1048 — it just never has one.
  Files: `src/engine/conductor.ts` (lines 1026-1048)

- [x] 1.5 **Expose Refinery state via daemon RPC** — Add `mergeQueue:list`, `mergeQueue:retry`,
  `mergeQueue:skip` RPC methods so cockpit can display and control the merge queue.
  Files: `src/daemon/hogd.ts`, `src/daemon/protocol.ts`

- [x] 1.6 **Wire cockpit to display merge queue** — Connect `usePipelineData` to the new RPC
  methods. The merge queue section in pipeline-view already exists but shows empty.
  Files: `src/board/hooks/use-pipeline-data.ts`, `src/board/components/pipeline-view.tsx`

- [x] 1.7 **Per-pipeline event log** — Change `EventLog` to write per-pipeline files at
  `~/.config/hog/pipelines/<featureId>.events.jsonl` with explicit `featureId` on every event.
  Update replay/compare to read from per-pipeline files.
  Files: `src/daemon/event-log.ts`, `src/cli.ts` (replay/compare commands)

- [x] 1.8 **Persist session/worktree maps** — Write `sessionToPipeline` and `sessionWorktrees`
  to PipelineStore alongside pipeline state. Recover on daemon restart.
  Files: `src/engine/conductor.ts` (lines 121), `src/engine/pipeline-store.ts`

- [ ] 1.9 **Tests for wiring** — Integration tests verifying: agent gets worktree, completed
  branch enters Refinery queue, role-audit gate runs, merge queue state appears in RPC.
  Files: new test file `src/daemon/hogd-wiring.test.ts`

### Exit Criteria

- [ ] `hog pipeline create` spawns agents in isolated worktrees
- [ ] Completed branches enter the Refinery merge queue (visible in cockpit)
- [ ] Role-audit gate runs on every merge and rejects out-of-scope file changes
- [ ] Quality gates (lint, security, abuse) run before merge
- [ ] Replay works from per-pipeline event files
- [ ] Daemon restart recovers session/worktree mappings

---

## Phase 2: Close the Gates (P0/P1 — 3-4 days)

**Goal:** Execute the completeness gates plan + add budget enforcement + make stubs blocking.

This phase is primarily the existing `pipeline-completeness-gates-plan.md` (Phases A through G),
plus three gaps the audit found that aren't in that plan.

### Tasks — From Completeness Gates Plan

Execute the 7 sub-phases in the completeness gates plan exactly as specified:

- [ ] 2.1 **Phase A: Foundation** — Add `retryFeedback`, `skippedStories` to PipelineContext +
  Zod schema. Add `questionType` to question queue. Create `summary-parser.ts`. Write parser tests.
  (Tasks A1-A5 from completeness-gates plan)

- [ ] 2.2 **Phase B: Integration Story Escalation** — Scan stories for `[INTEGRATION]` tags,
  enqueue informational questions, update tickPipeline, change blocking logic. Write tests.
  (Tasks B1-B5)

- [ ] 2.3 **Phase C: Refactor onAgentCompleted** — Extract `runPreCloseGates()`, new flow:
  gates → close → hooks. Move GREEN verification to post-close. Write tests.
  (Tasks C1-C4)

- [ ] 2.4 **Phase D: Story Coverage Gate** — Fix `checkTraceability` testGlob wiring + storiesPath
  resolution. Add blocking gate with 25% threshold minus skippedStories. Write tests.
  (Tasks D1-D5)

- [ ] 2.5 **Phase E: Summary Sentiment Gate** — Check summary against FAILURE_PATTERNS with
  phase-aware exclusions. Enqueue blocking question on match. Write tests.
  (Tasks E1-E3)

- [ ] 2.6 **Phase F: Contextual Retry** — Read retryFeedback in spawnForRole, append retry
  section. Unify retry caps. Remove redundant counters. Write tests.
  (Tasks F1-F5)

- [ ] 2.7 **Phase G: Redteam Completeness** — Add storiesPath to REDTEAM_PROMPT with
  completeness check + `[INTEGRATION]` awareness. Write test.
  (Tasks G1-G3)

### Tasks — Audit Gaps (not in completeness gates plan)

- [ ] 2.8 **Make stub detection a blocking gate** — Promote `detectStubs()` result from logged
  to enforced. If stub ratio >5% of impl files → reopen impl bead with specific stub
  locations as retry context. Add to `runPreCloseGates` for `phase === "impl"`.
  Files: `src/engine/conductor.ts`, `src/engine/tdd-enforcement.ts`

- [ ] 2.9 **Budget enforcement** — Parse Claude's cost output from stream-json events
  (look for `result.cost_usd` or similar). Populate `pipeline.costByPhase` and `totalCost`.
  Before spawning any agent, check `totalCost < budget.perPipeline` and
  `costByPhase[role] < budget.perPhase[role]`. If exceeded → enqueue blocking question
  "Budget exceeded ($X/$Y). Continue, increase, or stop?"
  Files: `src/engine/conductor.ts`, `src/board/spawn-agent.ts` (cost parsing),
  `src/engine/pipeline-store.ts`

- [ ] 2.10 **Enforce redteam model divergence** — In conductor's `spawnForRole`, when role is
  `redteam`, verify that `config.pipeline.models.redteam !== config.pipeline.models.impl`.
  If same → log warning and use a different model (fallback to sonnet if impl is opus,
  opus if impl is sonnet). This prevents mode collapse.
  Files: `src/engine/conductor.ts`

### Exit Criteria

- [ ] Test phase with <75% story coverage gets reopened with missing story IDs in prompt
- [ ] Merge agent saying "CANNOT PROCEED" triggers human question, not success
- [ ] Retried agents receive structured retry context with what failed
- [ ] Impl phase with >5% stubs gets reopened with stub locations
- [ ] Budget cap prevents agent spawn when exceeded
- [ ] Redteam always uses a different model than impl
- [ ] All existing tests still pass

---

## Phase 3: Give It a Soul (P1 — 2-3 days)

**Goal:** Transform hog from a clinical tool into the Heart of Gold. Plus cockpit polish.

The H2G2 metaphor is hog's strongest brand differentiator and it's completely unused.
This phase adds personality without compromising rigor.

### Tasks — H2G2 Theming

- [ ] 3.1 **Character-mapped role labels** — In `humanize.ts`, map pipeline roles to H2G2
  characters for display. `brainstorm` → "Zaphod", `stories` → "Ford", `test` → "Arthur",
  `impl` → "Arthur", `redteam` → "Marvin", `merge` → "Vogons". Keep the generic agent
  names (Ada, Bea, Cal) for multi-agent disambiguation within a phase — characters are
  role labels, not agent names.
  Files: `src/board/humanize.ts`

- [ ] 3.2 **Themed conductor decision log entries** — Replace clinical log messages with
  Douglas Adams register. Not jokes — calm, precise, dry wit:
  - Pipeline created → `Heart of Gold launched. Course: "{title}"`
  - Brainstorm done → `Zaphod has set a course. The ship is flying itself.`
  - Stories complete → `Ford has filed his research. The Guide entry is ready.`
  - RED verified → `Tests failing. The question is good. Proceeding.`
  - RED not verified → `42. But what was the question? Reopening test phase.`
  - Impl complete → `Arthur has built it. Tests green.`
  - Redteam start → `Marvin is reviewing. He is not optimistic.`
  - Redteam finding → `Marvin: {issue} in {file}. I knew it.`
  - Redteam clean → `Marvin: Nothing found. I find this deeply suspicious.`
  - Quality gate fail → `The Vogons have {N} objections. Forms must be completed.`
  - Pipeline complete → `Pan Galactic Gargle Blaster served. Feature ready to merge.`
  Files: `src/engine/conductor.ts` (decision log calls)

- [ ] 3.3 **"Don't Panic" error philosophy** — Audit all user-facing error messages
  (console.error, toast.error, CLI error handlers). Rewrite to pattern:
  state fact calmly → give specific reference → end with next action.
  Add `Don't Panic.` prefix to the `--help` output description.
  Files: `src/cli.ts`, `src/board/components/cockpit.tsx`, `src/daemon/ensure-daemon.ts`

- [ ] 3.4 **Config missing message** — When config file not found:
  `You don't know where your towel is. Run: hog init`
  Files: `src/config.ts`

- [ ] 3.5 **Cockpit phase display with characters** — Update the phase bar to show
  character names alongside phase names:
  `Zaphod ✓ → Ford ✓ → Arthur ✓ → Arthur ● → Marvin ○ → Vogons ○`
  Files: `src/board/components/pipeline-view.tsx`

### Tasks — Cockpit Polish (from cockpit-redesign-polish plan)

- [ ] 3.6 **Filter internal events from history** — Only show phase transitions,
  completions, failures, decisions. Filter out "preparing to spawn", "bead count
  corrected", session IDs, RED/baseline internals (show only if RED FAILS).
  (Task P.3 from cockpit-redesign-polish plan)

- [ ] 3.7 **Error/decision prominence** — Blocked state gets full-width treatment with
  error message, context, and action keys `[R]etry [S]kip [C]ancel`.
  (Task P.6)

- [ ] 3.8 **Add retry action** — `r` key in cockpit to retry a failed phase. Dispatches
  to conductor to reopen the failed bead.
  (Not in cockpit plan — audit gap)

- [ ] 3.9 **Clean up spacing and formatting** — Fix timestamp spacing, remove double
  colons, consistent alignment, remove session/bead IDs from display.
  (Task P.7)

### Exit Criteria

- [ ] Cockpit shows character names next to phases
- [ ] Decision log entries use H2G2 themed messages
- [ ] Error messages follow "Don't Panic" pattern
- [ ] Config missing shows "towel" message
- [ ] Cockpit history shows only meaningful events
- [ ] Blocked state is impossible to miss
- [ ] `r` key retries failed phase

---

## Phase 4: Clean the Ship (P2 — 1-2 days)

**Goal:** Remove dead weight, consolidate duplicates, harden resilience.

### Tasks

- [ ] 4.1 **Remove dead `pipeline.phases` config** — Delete `phases` from
  `PIPELINE_CONFIG_SCHEMA`. It accepts values but the conductor ignores them, and the
  defaults (`plan`, `implement`) don't match actual phase names.
  Files: `src/config.ts`

- [ ] 4.2 **Remove vestigial `board` config** — Delete `BOARD_CONFIG_SCHEMA` and all
  references. The v1 dashboard was removed in v2.0 but the schema, migration path, and
  `config show` output still include it.
  (Remaining work from drop-github-board plan)
  Files: `src/config.ts`

- [ ] 4.3 **Make GitHub fields optional in RepoConfig** — `projectNumber` and `statusFieldId`
  should be optional for GitHub-free setups. Currently schema validation fails without them.
  (Remaining work from drop-github-board plan)
  Files: `src/config.ts`

- [ ] 4.4 **Consolidate role enforcement** — Generate role-specific `CLAUDE.md` content
  FROM role definitions in `roles.ts`, not maintain them separately in `role-context.ts`.
  Single source of truth prevents drift.
  Files: `src/engine/role-context.ts`, `src/engine/roles.ts`

- [ ] 4.5 **Unhide `pipeline watch`** — Remove `{ hidden: true }` from the watch command.
  It's the primary way for non-TUI users to observe a pipeline.
  Files: `src/cli.ts`

- [ ] 4.6 **Add daemon RPC version** — Add `protocolVersion` field to the initial handshake.
  If CLI and daemon versions mismatch, warn the user to restart the daemon.
  Files: `src/daemon/protocol.ts`, `src/daemon/hogd.ts`, `src/daemon/client.ts`

- [ ] 4.7 **Remove Orchestrator if vestigial** — Verify `engine/orchestrator.ts` is not used
  in any active code path. If confirmed vestigial, delete it.
  Files: `src/engine/orchestrator.ts`, `src/engine/engine.ts`

- [ ] 4.8 **Complete `hog beads` CLI surface** — Add `hog beads status`, `hog beads start`,
  `hog beads stop [--all]` commands using the engine methods that already exist.
  (Remaining work from beads-server-lifecycle plan)
  Files: `src/cli.ts`

- [ ] 4.9 **Enrich `pipeline compare`** — Add quality gate results, cost, test counts,
  phase durations to comparison output. Currently shows only duration.
  Files: `src/cli.ts`

### Exit Criteria

- [ ] `hog config show` no longer shows `board` or `pipeline.phases`
- [ ] `hog init --no-github` produces a valid config without GitHub fields
- [ ] Role CLAUDE.md is generated from roles.ts definitions
- [ ] `hog pipeline watch` is visible in `--help`
- [ ] CLI warns on protocol version mismatch with daemon
- [ ] `hog beads status/start/stop` work
- [ ] `hog pipeline compare` shows meaningful metrics

---

## Phase 5: Chart the Course (P2 — 3-5 days)

**Goal:** Platform differentiation. Policy-as-Code is hog's moat — the thing that makes
it irreplaceable for teams. The worker adapter makes it vendor-neutral.

### Tasks — Policy-as-Code Engine

The core insight: hog's quality gates are currently hardcoded in TypeScript. Teams can't
customize them without forking. Policy-as-Code turns quality standards into declarative
config that teams own and version-control.

- [ ] 5.1 **Define policy schema** — YAML-based policy files at `.hog/policies/*.yaml`.
  Each policy declares: gate name, severity (error/warning), tool/command to run,
  file patterns to check, threshold, and human-readable failure message.
  ```yaml
  # .hog/policies/security.yaml
  name: dependency-audit
  severity: error
  command: npm audit --audit-level high --json
  on: [merge]
  message: "Dependency vulnerabilities found. Run: npm audit fix"
  ```
  Files: new `src/engine/policy.ts` (schema + loader)

- [ ] 5.2 **Policy loader** — On pipeline start, scan `.hog/policies/` for YAML files,
  validate against schema, merge with built-in gates. User policies override built-in
  gates of the same name. Invalid policies warn but don't block.
  Files: `src/engine/policy.ts`, `src/engine/quality-gates.ts`

- [ ] 5.3 **Policy-driven gate execution** — Convert `ALL_GATES` from hardcoded array to
  a registry that loads from both built-in definitions and policy files. Gate interface
  stays the same — policies are just a declarative way to define gates.
  Files: `src/engine/quality-gates.ts`

- [ ] 5.4 **Built-in policy presets** — Ship default policies for common stacks:
  - `typescript` — biome lint, tsc --noEmit, npm audit
  - `python` — ruff, mypy, pip audit
  - `rust` — clippy, cargo audit, cargo-mutants
  `hog init` asks which preset to install. Presets are just YAML files copied to
  `.hog/policies/`.
  Files: new `src/engine/policy-presets/`, `src/init.ts`

- [ ] 5.5 **`hog policy list/add/remove`** — CLI commands to manage policies.
  `hog policy list` shows active policies with severity. `hog policy add <preset>`
  copies preset YAML. `hog policy remove <name>` deletes the file.
  Files: `src/cli.ts`

- [ ] 5.6 **Policy validation in CI** — `hog policy check` runs all active policies
  against the current working directory without a pipeline. Useful as a standalone
  CI step or pre-commit hook.
  Files: `src/cli.ts`, `src/engine/quality-gates.ts`

### Tasks — Worker Adapter Layer

- [ ] 5.7 **Define worker adapter interface** — Abstract the agent spawning contract:
  `spawn(prompt, options) → AgentHandle`, `AgentHandle.onProgress(callback)`,
  `AgentHandle.onComplete(callback)`, `AgentHandle.kill()`. The current Claude-specific
  spawning in `spawn-agent.ts` becomes the first adapter implementation.
  Files: new `src/engine/worker-adapter.ts`, refactor `src/board/spawn-agent.ts`

- [ ] 5.8 **Claude adapter** — Extract current Claude Code spawning into a `ClaudeAdapter`
  that implements the worker interface. Stream-json parsing, permission mode handling,
  model selection — all encapsulated.
  Files: `src/engine/adapters/claude-adapter.ts`

- [ ] 5.9 **Configurable worker in config** — Add `pipeline.worker: "claude" | "codex" | "custom"`
  to config schema. Conductor reads this and instantiates the right adapter. Default: `"claude"`.
  Files: `src/config.ts`, `src/engine/conductor.ts`

### Tasks — Polish & Instrumentation

- [ ] 5.10 **Dependency vulnerability gate** — `npm audit` / `pip audit` / `cargo audit`
  as a built-in warning-severity gate AND as a default policy in the typescript/python/rust
  presets.
  Files: `src/engine/quality-gates.ts`

- [ ] 5.11 **`hog demo` polish** — Under 2 minutes, themed with H2G2 narration.
  Impressive first contact with the Heart of Gold.
  Files: `src/demo/demo.ts`

- [ ] 5.12 **Performance instrumentation** — CI benchmarks for cockpit latency (<500ms),
  daemon startup (<500ms), demo time (<2 min).
  Files: new benchmark test files

### Exit Criteria

- [ ] `.hog/policies/security.yaml` is loaded and executed as a quality gate
- [ ] `hog init` offers stack presets that install default policies
- [ ] `hog policy list` shows all active policies
- [ ] `hog policy check` runs policies standalone (CI-friendly)
- [ ] User policies override built-in gates of the same name
- [ ] Claude spawning is behind the worker adapter interface
- [ ] `pipeline.worker` config field exists (even if only claude adapter ships)
- [ ] npm audit runs as a default gate for TypeScript projects

---

## Decision Rationale

### Why this ordering?

Phase 1 (wiring) must come first because Phases 2-4 depend on components being active:
- Completeness gates (Phase 2) run inside `onAgentCompleted` which needs worktrees for isolation
- Role-audit gate (Phase 2) runs in the Refinery which Phase 1 activates
- Cockpit merge queue display (Phase 3) needs the Refinery RPC from Phase 1

Phase 3 (soul) is parallel-safe with Phase 2 — theming doesn't depend on gates. But
sequencing it after gates means we can theme the new gate messages too.

### Why fold existing plans instead of creating new ones?

Seven separate plans with overlapping scope creates coordination overhead. The completeness
gates plan is executed verbatim (it's excellent and specific). The others are referenced for
their remaining tasks. One plan to rule them all.

### Why theme before cleanup (Phase 3 before Phase 4)?

Theming is user-visible and differentiating. Dead config removal is invisible hygiene.
Ship the personality first — it's what makes people remember hog.

### Why not start with H2G2 theming?

Tempting, but theming a broken tool is lipstick on a pig (or a hog). The wiring fixes in
Phase 1 are the prerequisite for everything. You can't theme the merge queue display if
the merge queue doesn't run.

### Why is Phase 5 last but not deferred?

Policy-as-Code is hog's moat — it's what makes teams adopt and stay. But it requires the
gate infrastructure from Phases 1-2 to be solid first. The worker adapter is insurance
against vendor lock-in. Both are scheduled, not aspirational. MCP server was considered
but dropped — hog is the orchestrator, not a tool to be orchestrated.

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| WorktreeManager + Refinery constructors are compatible with hogd instantiation | Verified | Codebase analysis: WorktreeManager() takes no args, Refinery needs EventBus + WorktreeManager + options |
| Conductor already handles optional worktrees/refinery | Verified | conductor.ts checks `this.worktrees` and `this.refinery` existence before use |
| Claude stream-json output includes cost data | Unverified | Need to check Claude Code's `--output-format stream-json` for cost fields. If absent, budget enforcement needs a different data source. |
| Completeness gates plan tasks A-G are still accurate | Verified | Plan approved today, codebase unchanged since |
| `pipeline.phases` config is truly unused | Verified | Codex confirmed at config.ts:124, workflow.ts:28, conductor.ts:786 — conductor ignores it |
| Orchestrator class is vestigial | Likely verified | Engine creates it but hogd doesn't use it; conductor does its job. Need final grep before deleting. |
| H2G2 theming won't conflict with accessibility (screen readers, CI output) | Unverified | Themed messages must still be parseable. Keep structured data separate from display strings. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Worktree creation fails on some git configurations (submodules, sparse checkout) | Medium | High | Graceful fallback: if worktree fails, log warning and run in main repo (current behavior) |
| Refinery merge queue creates bottleneck for fast pipelines | Low | Medium | Refinery already has skip/retry; add timeout-based auto-skip for stuck entries |
| Budget enforcement blocks pipelines unexpectedly (cost data parsing wrong) | Medium | Medium | Start as warning-only (Phase 2.9), promote to blocking after validation on real runs |
| H2G2 theming alienates users who don't know the reference | Low | Low | Messages are functional first, themed second. "Tests failing. The question is good." works without knowing H2G2. Character names are labels, not requirements. |
| Completing all 4 phases takes longer than estimated | Medium | Medium | Each phase has independent exit criteria. Phase 3 and 4 can ship independently. |
| Removing board config breaks existing user configs | Medium | High | Config migration function must handle missing board section gracefully. Test with real config files. |

---

## References

- [Grand Audit](../audits/2026-03-28-hog-grand-audit.md) — Full requirements analysis + H2G2 blueprint
- [Codex Audit Results](../audits/2026-03-28-codex-audit-results.md) — Line-level verification of 23 requirements
- [Pipeline Completeness Gates Plan](2026-03-28-feat-pipeline-completeness-gates-plan.md) — Executed verbatim as Phase 2.1-2.7
- [Cockpit Redesign Polish Plan](2026-03-28-feat-cockpit-redesign-polish-plan.md) — Remaining tasks folded into Phase 3
- [Drop GitHub Board Plan](2026-03-26-refactor-drop-github-board-pipeline-first-plan.md) — Remaining tasks folded into Phase 4
- [Beads Server Lifecycle Plan](2026-03-24-feat-beads-server-lifecycle-plan.md) — CLI surface folded into Phase 4
