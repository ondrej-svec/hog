# The Grand Audit of hog: Head of Gold

> "The Heart of Gold didn't navigate — it made arrival improbable to avoid.
> hog doesn't write code — it makes bad code improbable to produce."

**Date:** 2026-03-28
**Status:** Research complete, ready for Codex analysis

---

## Part 1: Codex Analysis Prompt

The following prompt should be given to OpenAI Codex (or any deep codebase analysis tool) to audit the hog codebase against the requirements established in this document.

---

### PROMPT FOR CODEX

```
You are performing a comprehensive audit of "hog" (Head of Gold) — a Node.js CLI tool
that orchestrates AI agents through TDD-enforced development pipelines. The name comes
from the Heart of Gold spaceship in The Hitchhiker's Guide to the Galaxy.

hog is attempting to be THE most opinionated, structurally-enforced agentic development
tool. Its core thesis: "Structure enables autonomy. The pipeline IS the question."

## Your Audit Task

Analyze the entire codebase against the requirements below. For each requirement, report:
1. **Status**: IMPLEMENTED | PARTIAL | MISSING | BROKEN
2. **Evidence**: Specific files, functions, and line numbers
3. **Gaps**: What's missing or incomplete
4. **Recommendations**: Concrete improvements

## Architecture Context

- ESM TypeScript, Node 22+, Biome (not ESLint), tsup bundler, Vitest tests
- 6-phase pipeline: brainstorm → stories → tests → impl → redteam → merge
- Beads (external): DAG-based task management backed by Dolt (git-backed SQL)
- hogd daemon: Unix socket RPC, real-time event streaming
- Cockpit TUI: Ink (React for terminals)
- Agents: Claude Code processes spawned with stream-json output

## Functional Requirements to Audit

### FR-1: DAG-Based Pipeline Orchestration
- Phases emerge from dependency satisfaction (bd ready polling), not hardcoded transitions
- Phase IDs are content-addressable
- DAG is auditable and persisted durably
- Restarts don't lose in-progress work
- Sub-DAGs should be possible for complex features

### FR-2: Structural Role Separation ("No Agent Marks Its Own Homework")
- Test writers and implementers are structurally separate (different processes, contexts, prompts)
- Role matrix enforced:
  | Role | Can See | Can Modify |
  |------|---------|------------|
  | brainstorm | Everything + user | Stories + architecture docs |
  | stories | Spec | docs/stories/*.md only |
  | test | Stories + arch doc | Test files only |
  | impl | Failing tests + stories + arch doc | Source files only (NOT test files) |
  | redteam | Tests + impl + arch doc | Test files only (adversarial) |
  | merge | Everything | Cannot fix — reports only |
- Role-audit gate mechanically verifies file scope via git diff
- Double enforcement: role prompts (roles.ts) AND role-specific CLAUDE.md (role-context.ts)

### FR-3: TDD Enforcement — RED/GREEN Verification
- RED: Before impl, tests MUST be failing. If tests pass → reopen test phase
- GREEN: After impl, tests MUST pass. If tests fail → reopen impl phase
- Baseline capture: pre-existing failures are excluded from GREEN checks
- Scoped test commands (only new test files, not full suite)
- Test-to-RED feedback loop should be seconds, not minutes

### FR-4: Story Traceability
- Every test references a STORY-XXX ID
- Every story has at least one test
- Orphan tests (nonexistent story IDs) are flagged
- Uncovered stories block proceeding (>25% threshold)

### FR-5: Mutation Testing
- Auto-detection: Stryker (JS/TS), mutmut (Python), cargo-mutants (Rust)
- 70% threshold (advisory, not blocking)
- Verifies tests catch behavioral regressions, not just structural assertions

### FR-6: Adversarial Red Team Phase
- Dedicated adversarial agent that attempts to BREAK the implementation
- Uses DIFFERENT model than implementer (prevents mode collapse)
- Cannot modify implementation — only writes failing tests
- 10 attack categories: security, edge cases, scaffolding detection, error handling
- If red team tests fail → reopens impl with red team failures as context
- Cap at 2 impl retries, then escalate to human

### FR-7: Serial Merge Queue (Refinery)
- FIFO queue serializing all merges to main
- Per entry: rebase → test → quality gates → fast-forward merge
- Parallel agents submit; Refinery processes one at a time
- Conflict detection and re-queuing
- Pause/resume/retry/skip controls

### FR-8: Human-in-the-Loop — Two-Tier Model
- Tier 1 (Creative): tmux brainstorm sessions for spec co-creation
- Tier 2 (Operational): Number-key quick picks in cockpit for retry/skip/escalate
- Question queue accumulates while human is in deep work
- Integration stories surface BEFORE implementation begins
- Summary sentiment gate: "exit 0 ≠ success" — parse agent output for stuck signals

### FR-9: Parallel Agent Execution with Worktree Isolation
- Multiple agents work simultaneously in isolated git worktrees
- Story-chunk splitting for parallel impl/test phases
- Smart grouping: stories mentioning same files go to same agent
- maxConcurrentAgents configurable (default 3)

### FR-10: Structured Context Flow Between Phases
- Architecture doc produced in brainstorm, available to ALL subsequent agents
- Pipeline context (testCommand, testDir, testFiles) flows between phases
- Prevents "scaffold failure mode" where impl agent produces stubs

### FR-11: Single Daemon Architecture (hogd)
- Long-lived daemon at ~/.config/hog/hogd.sock
- JSON-RPC over Unix socket with push event stream
- CLI/TUI are thin clients
- PipelineStore persists to disk for crash recovery
- Auto-start on first command
- PID-based liveness polling

### FR-12: Completeness Gates — Feedback Loops
- Failed gates return work to responsible agent with specific feedback
- Contextual retry: inject "## Retry Context" with what failed + attempt number
- Cap retries at 2 before human escalation
- Summary sentiment gate: detect "CANNOT PROCEED" in agent output

### FR-13: Permission Model and Safety
- Per-agent permission mode (auto, acceptEdits, bypassPermissions)
- Defense in depth: permissions → role scope → worktree isolation → quality gates → human oversight
- Role-audit gate rejects out-of-scope modifications
- Abuse pattern detection (eval, exec, innerHTML, hardcoded secrets, path traversal)

### FR-14: Quality Gate Registry
- Pluggable gates with severities (error blocks, warning reports)
- Current: linting, security (semgrep), abuse patterns, mutation testing, role audit
- Missing: dependency vulnerability scan, license compliance, type coverage, bundle size, SBOM

### FR-15: Model Router and Budget Controller
- Per-role model configuration
- Per-phase and per-pipeline budget caps
- Budget enforcement: block agent spawn when budget exceeded
- Cost tracking from Claude's output

## Non-Functional Requirements to Audit

### NFR-1: Real-Time Agent Telemetry
- Cockpit shows current tool, file, elapsed time per agent (<500ms latency)
- Event streaming from daemon, not file polling

### NFR-2: Reproducibility — Run Replay
- Append-only JSONL event log per pipeline
- hog pipeline replay <id> — replay at configurable speed
- hog pipeline compare <id1> <id2> — side-by-side analysis

### NFR-3: First-Run Experience
- Zero to pipeline in under 5 minutes
- hog demo: in-memory Beads, mock agents, zero external deps
- Under 2 minutes for demo

### NFR-4: Resilience — Crash Recovery
- Daemon crash → pipelines survive in durable storage
- On restart: resume running pipelines
- Agent processes continue independently (tmux sessions)

### NFR-5: Extensibility
- Custom quality gates addable
- Custom pipeline roles
- MCP server exposing pipeline.status, decision.list, etc.
- Worker adapter layer for non-Claude agents (future)

### NFR-6: Performance Targets
- Cockpit update latency: <500ms
- Full pipeline (simple feature): <45 minutes
- hog demo: <2 minutes
- Daemon startup: <500ms

### NFR-7: Safety Guardrails — Layered Defense
- 6 layers: permission → role scope → worktree isolation → quality gates → human oversight → audit log
- No single point of failure in safety

### NFR-8: Developer Experience
- Keyboard-first cockpit TUI
- Agent humanization (names, tool descriptions)
- Toast notifications, decision panels
- Zen mode (tmux split with agent session)

## H2G2 Metaphor Integration Audit

The tool is named "hog" (Head of Gold) after the Heart of Gold from Hitchhiker's Guide.
Audit the depth of thematic integration:

### Expected Character Mappings (are these reflected in the code?)
- Heart of Gold → hog itself
- Zaphod Beeblebrox → brainstorm phase (reckless visionary)
- Ford Prefect → stories phase (field researcher → structured documentation)
- Arthur Dent → test + impl phases (constrained craftsman)
- Marvin the Paranoid Android → redteam (adversarial, pessimistic, correct)
- Trillian → conductor (calm, competent orchestrator)
- Vogons → quality gates / merge (bureaucracy that IS correctness)
- Deep Thought → the underlying LLM
- Eddie the Computer → the anti-pattern (don't be relentlessly cheerful)

### Expected Concept Mappings (are these reflected?)
- Infinite Improbability Drive → the 6-phase pipeline (improbability reduction)
- "Don't Panic" → error handling philosophy
- 42 → tests passing by construction (correct answer, wrong question)
- The Guide → architecture doc / README
- Towel → config file (know where your towel is)
- Total Perspective Vortex → redteam review
- Babel Fish → --json structured output
- Bistromathics → Beads DAG
- Pan Galactic Gargle Blaster → pipeline completion

### Themed UX Elements to Check
- CLI messages / personality strings
- Error messages in Douglas Adams voice
- Agent names mapped to H2G2 characters
- Progress indicators / phase labels
- --help output tone
- ASCII art / branding

## Known Issues to Verify

1. pipeline.phases config field is dead — does nothing, has wrong default values
2. board section is vestigial (v1 dashboard removed, config kept)
3. Double role-enforcement (roles.ts + role-context.ts CLAUDE.md) can drift
4. Budget tracking schema exists but enforcement code is absent
5. GREEN verification exists but may not be wired into conductor post-impl
6. Stub detection runs but results aren't acted upon (not a blocking gate)
7. pipeline.watch command is hidden/undiscoverable
8. QuestionQueue sources "clarity-analyst" and "stuck-agent" are aspirational (never used)
9. RepoConfig requires GitHub fields even for GitHub-free setups
10. tmux dependency for brainstorm/log features is undocumented
11. No retry action available from cockpit for failed phases
12. Orchestrator class may be vestigial (conductor does its job)
13. Daemon RPC protocol has no version negotiation
14. sessionToPipeline/sessionWorktrees maps are in-memory only (lost on daemon restart)

## Output Format

For each requirement (FR-1 through FR-15, NFR-1 through NFR-8, H2G2):
1. Status: IMPLEMENTED | PARTIAL | MISSING | BROKEN
2. Files involved (with line numbers)
3. What works
4. What's missing or broken
5. Priority recommendation (P0/P1/P2/P3)

End with:
- A prioritized list of the top 10 improvements
- An architectural diagram of the current system
- A gap analysis showing the delta between current state and "best agentic dev tool"
```

---

## Part 2: Current State Audit (Claude Analysis)

### What hog Does Today — Complete Feature Inventory

#### Commands
| Command | Status | Description |
|---------|--------|-------------|
| `hog init` | Working | Interactive setup wizard, GitHub auth, repo config |
| `hog cockpit` | Working | Pipeline monitoring TUI (Ink-based) |
| `hog demo` | Working | Simulated pipeline with in-memory Beads |
| `hog pipeline create` | Working | Main entry point — creates 6-phase DAG |
| `hog pipeline list` | Working | Lists active pipelines |
| `hog pipeline status` | Working | Per-phase icons, log tail, cost tracking |
| `hog pipeline pause/resume/cancel` | Working | Lifecycle control via daemon RPC |
| `hog pipeline done` | Working | Closes active bead (brainstorm → autonomous) |
| `hog pipeline review` | Working | Structured summary with elapsed/phases/decisions |
| `hog pipeline watch` | Hidden | Streams daemon events to stdout |
| `hog pipeline replay` | Working | Replays events from append-only log |
| `hog pipeline compare` | Partial | Duration comparison only, no quality metrics |
| `hog pipeline init` | Working | Injects pipeline section into project CLAUDE.md |
| `hog decisions` | Working | Lists/resolves pending human questions |
| `hog launch` | Legacy | Launches Claude for a GitHub issue |
| `hog beads status/start/stop` | Working | Dolt server lifecycle management |
| `hog config show/set/repos` | Working | Configuration management |
| `hog issue *` | Working | GitHub issue CRUD via gh CLI |

#### Pipeline Orchestration (Conductor)
- **State machine**: Polls `bd ready` every 10s, deterministic phase transitions
- **Self-healing**: Reconciles completed beads, fixes activePhase drift, unsticks orphaned beads
- **Parallel agents**: Story-chunk splitting for test/impl phases
- **Question queue blocking**: Pipeline pauses when human questions are pending
- **Decision log**: Append-only log of all state transitions

#### TDD Enforcement
- **RED verification**: ✅ Runs tests before impl, reopens test phase if tests pass
- **GREEN verification**: ⚠️ Code exists but NOT wired into conductor post-impl
- **Baseline capture**: ✅ Pre-impl baseline for diff-based GREEN checks
- **Traceability**: ✅ STORY-XXX cross-referencing (advisory)
- **Mutation testing**: ⚠️ Infrastructure present, rarely activates (needs Stryker config)
- **Stub detection**: ⚠️ Runs but results not acted upon

#### Quality Gates
| Gate | Severity | Status |
|------|----------|--------|
| Linting | warning | ✅ Auto-detects Biome/ESLint/Ruff |
| Security (semgrep) | error | ✅ Blocks on findings (requires semgrep) |
| Abuse patterns | error | ✅ eval, exec, innerHTML, secrets, traversal |
| Mutation testing | warning | ⚠️ Rarely activates |
| Role audit | error | ✅ Verifies file scope per role |

#### Agent Management
- Spawns Claude Code as child processes with stream-json output
- PID-based liveness polling (5s interval)
- Result reconciliation on daemon restart
- Role-specific CLAUDE.md written to worktrees
- Agent humanization: names (Ada/Bea/Cal...), tool descriptions

#### Cockpit TUI
- Multi-pipeline view with mini progress bars
- Phase bar with ✓/●/○ icons
- Decision panel with numbered options
- Active agent spotlight with tool activity
- Activity feed (last 20 entries)
- Keyboard shortcuts: P/j/k/x/d/Z/l/1-9/D/?/q

---

### H2G2 Metaphor Integration: SHALLOW

**Present:**
- The name `hog` = Head of Gold ✅
- One example comment mentioning "heart-of-gold-toolkit"
- Plan docs reference `blog/heart-of-gold/` as example path

**Absent (everything else):**
- ❌ No themed error messages or personality strings
- ❌ No "Don't Panic" anywhere in source
- ❌ No character names (Marvin, Zaphod, Ford, Arthur, Trillian, Vogon)
- ❌ No themed loading messages or witty copy
- ❌ No H2G2 concepts mapped to components
- ❌ Agent names (Ada, Bea, Cal...) are generic, not H2G2 characters
- ❌ Command names use aviation/industrial metaphors, not H2G2
- ❌ --help output is standard Commander.js, no personality

**Verdict:** The H2G2 angle is a naming decision that was never executed in UX.

---

### Critical Gaps (Priority Order)

#### P0: Trust-Breaking Issues
1. **Budget tracking is ghost code** — Schema exists, no enforcement. Users think they have cost protection but don't.
2. **GREEN verification not wired** — RED is enforced but GREEN is not. Impl can complete with failing tests.
3. **Stub detection not acted upon** — The "Bobo" failure mode (294 stubs) can still happen.

#### P1: Structural Inconsistencies
4. **`pipeline.phases` config is dead** — Accepts values but ignores them. Default values don't match actual phase names.
5. **Double role enforcement can drift** — `roles.ts` prompts and `role-context.ts` CLAUDE.md say similar things but are maintained separately.
6. **RepoConfig requires GitHub fields for GitHub-free setups** — Schema validation fails without projectNumber/statusFieldId.
7. **Daemon RPC unversioned** — CLI/daemon version mismatch causes silent failures.

#### P2: Missing Features for Best-in-Class
8. **No dependency vulnerability gate** (npm audit, pip audit)
9. **No license compliance gate**
10. **No type coverage gate**
11. **`pipeline.compare` shows only duration** — No quality metrics, costs, gate results
12. **No cockpit retry action** — Failed phases can't be retried from TUI
13. **QuestionQueue sources are aspirational** — "clarity-analyst" and "stuck-agent" never used
14. **`pipeline.watch` is hidden** — Should be discoverable for non-TUI users

#### P3: UX and Polish
15. **H2G2 theme is invisible** — The strongest differentiator is unused
16. **Board config is vestigial** — Dead weight in schema and output
17. **tmux dependency undocumented**
18. **Orchestrator class may be vestigial**

---

## Part 3: Best-in-Class Requirements (Research Synthesis)

### The 10 Non-Negotiable Principles

1. **The test writer and implementer are always different agents.** No exceptions.
2. **Tests must be RED before implementation begins.** Verified by running them, not assumed.
3. **No agent marks its own homework.** Roles are structurally separate, not just instructed.
4. **Quality is structural, not aspirational.** Gates that cannot be bypassed > guidelines.
5. **The conductor is deterministic.** No LLM decides when to advance the pipeline.
6. **Agents work in isolation, merge serially.** Worktrees prevent contention; Refinery prevents chaos.
7. **Human time is for creative decisions, not operational ones.** Queue questions; never interrupt.
8. **The tool must be observable in real time.** Opacity destroys trust.
9. **Convention over configuration.** One right way that can be overridden with intent.
10. **Feedback loops, not walls.** Gates that fail return work with specific context — they don't just block.

### Competitive Position

| Capability | hog | Claude Code | Cursor | Devin | Codex CLI |
|-----------|-----|-------------|--------|-------|-----------|
| DAG-based pipeline | ✅ | ❌ | ❌ | ❌ | ❌ |
| RED verification | ✅ | ❌ | ❌ | ❌ | ❌ |
| Role separation | ✅ | ❌ | ❌ | ❌ | ❌ |
| Adversarial red team | ✅ | ❌ | ❌ | ❌ | ❌ |
| Story traceability | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mutation testing | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| Serial merge queue | ✅ | ❌ | ❌ | ❌ | ❌ |
| Worktree isolation | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| Parallel agents | ✅ | ❌ | ❌ | ❌ | ❌ |
| Real-time telemetry | ✅ | ✅ | ✅ | ✅ | ❌ |
| Terminal-first TUI | ✅ | ✅ | ❌ | ❌ | ✅ |
| Model routing/phase | ✅ | ❌ | ❌ | ❌ | ❌ |
| Run replay | ✅ | ❌ | ❌ | ❌ | ❌ |
| Demo mode | ✅ | ✅ | ✅ | ✅ | ❌ |

**hog is already the most architecturally distinctive agentic dev tool.** The combination of DAG-emergent phase ordering + structural role separation + RED verification + adversarial red team exists nowhere else.

---

## Part 4: H2G2 Metaphor Blueprint

### Character → Role Mapping

| Character | Role | Why It Works |
|-----------|------|-------------|
| **Zaphod** | brainstorm | Reckless visionary, two heads (human + AI), steals the ship |
| **Ford** | stories | Field researcher → structured documentation for the Guide |
| **Arthur** | test + impl | Constrained craftsman, never has full picture, just wants it to work |
| **Marvin** | redteam | "Brain the size of a planet." Sees every flaw. Correct and miserable. |
| **Trillian** | conductor | Calm, competent, keeps everyone alive. Invisible when things work. |
| **Vogons** | quality gates / merge | Bureaucracy IS correctness. The forms must be filed. |
| **Deep Thought** | underlying LLM | Computes the answer. Needs the right question. |
| **Eddie** | anti-pattern | Relentlessly cheerful. hog must NOT be Eddie. |

### Concept → Feature Mapping

| Concept | Feature | One-Liner |
|---------|---------|-----------|
| Infinite Improbability Drive | 6-phase pipeline | Makes bad code improbable, not impossible |
| "Don't Panic" | Error handling | Calm, specific, actionable errors |
| 42 | RED verification | Correct answer, wrong question → reopen test phase |
| The Guide | Architecture doc / README | Dense, precise, navigable |
| Towel | Config file | "You know where your towel is." |
| Total Perspective Vortex | Redteam review | Shows code its true insignificance |
| Babel Fish | --json output | Universal translation layer |
| Bistromathics | Beads DAG | Numbers depend on relationships, not absolutes |
| Pan Galactic Gargle Blaster | Pipeline completion | The best drink in existence |
| Magrathea | Git worktrees | Worlds built in isolation |

### Themed CLI Messages (Examples)

| Event | Message |
|-------|---------|
| Pipeline created | `Heart of Gold launched. Course: "Add OAuth login"` |
| Brainstorm done | `Zaphod has set a course. The Heart of Gold is now flying itself.` |
| Stories complete | `Ford has filed his research. The Guide entry is ready.` |
| RED verified | `Tests failing. The question is good. Proceeding.` |
| RED not verified | `42. But what was the question? Reopening test phase.` |
| Impl complete | `Arthur has built it. Tests green. He'd like tea.` |
| Redteam start | `Marvin is reviewing. He is not optimistic.` |
| Redteam finding | `Marvin: auth bypass in login.ts:42. I knew it.` |
| Redteam clean | `Marvin: Nothing found. I find this deeply suspicious.` |
| Quality gate fail | `The Vogons have 3 objections. Forms must be completed.` |
| Pipeline complete | `Pan Galactic Gargle Blaster served. Feature ready to merge.` |
| Config missing | `You don't know where your towel is. Run: hog init` |
| Error (any) | `Don't panic. [specific error]. Next: [specific action]` |

### Cockpit Phase Display

```
Heart of Gold · Add OAuth login
──────────────────────────────────────────
Zaphod    ✓  brainstorm   Course set.
Ford      ✓  stories      Guide entry filed.
Arthur    ✓  tests        Tests failing. Good.
Arthur    ●  impl         Making it work.
Marvin    ○  redteam      Waiting. Dreading.
Vogons    ○  merge        Paperwork pending.
──────────────────────────────────────────
42% · 1 agent · Don't Panic
```

---

## Part 5: The Plan — Making hog the Most Amazing Tool

### Existing Plans (already approved/in-progress)

These plans are already written and should be executed. The grand audit validates them and fills the gaps between them.

| Plan | Status | What It Covers |
|------|--------|---------------|
| [`pipeline-completeness-gates`](../plans/2026-03-28-feat-pipeline-completeness-gates-plan.md) | approved | Story coverage gate, summary sentiment gate, contextual retry, redteam completeness, integration story escalation, `onAgentCompleted` refactor |
| [`cockpit-redesign-polish`](../plans/2026-03-28-feat-cockpit-redesign-polish-plan.md) | in_progress | Agent spotlight, history vs log, tool humanizer, error prominence, phase descriptions |
| [`hogd-daemon-platform`](../plans/2026-03-26-feat-hogd-daemon-platform-plan.md) | approved | Unix socket RPC, real-time telemetry, PipelineStore, auto-start, event streaming |
| [`pipeline-v2-real-code-parallel`](../plans/2026-03-27-feat-pipeline-v2-real-code-parallel-plan.md) | approved | Architecture doc flow, parallel agents, context flow between phases |
| [`pipeline-interaction-model`](../plans/2026-03-24-feat-pipeline-interaction-model-plan.md) | approved | Two-tier human interaction, creative vs operational decisions |
| [`beads-server-lifecycle`](../plans/2026-03-24-feat-beads-server-lifecycle-plan.md) | approved | Dolt port pinning, auto-start, conflict resolution |
| [`drop-github-board`](../plans/2026-03-26-refactor-drop-github-board-pipeline-first-plan.md) | approved | Remove vestigial board config, GitHub-free pipeline path |

### Gaps NOT Covered by Existing Plans

The following items emerged from this audit and are NOT addressed by any existing plan:

#### Phase 1: Fix the Foundation (P0 — Week 1-2)

1. **Wire GREEN verification into conductor** — `verifyGreenState()` exists in `tdd-enforcement.ts` but is NOT called after impl completes. The completeness-gates plan restructures `onAgentCompleted` (Phase C) but doesn't add the GREEN call. **Add to Phase C of completeness-gates plan.**

2. **Make stub detection a blocking gate** — `detectStubs()` runs but results are only logged. The completeness-gates plan adds story coverage and sentiment gates but doesn't make stubs blocking. **New gate: if >5% stub ratio → reopen impl with specific stub locations.**

3. **Budget enforcement** — Schema exists (`pipeline.budget.perPipeline`, `pipeline.budget.perPhase`), code is absent. No existing plan covers this. **New work: parse Claude cost output, populate `costByPhase`, enforce caps, block agent spawn when exceeded.**

4. **Remove dead config fields** — `pipeline.phases` accepts values but is ignored (defaults don't even match actual phase names). The `drop-github-board` plan removes board config but doesn't touch this. **Add `pipeline.phases` removal to drop-github-board plan.**

5. **Fix RepoConfig schema for GitHub-free** — `projectNumber` and `statusFieldId` are required even with `--no-github`. The `drop-github-board` plan should address this but verify it does.

#### Phase 2: Embody the H2G2 Metaphor (P1 — Week 2-3)

**No existing plan covers the thematic integration.** This is entirely new work:

6. **Character-mapped agent names** — Replace Ada/Bea/Cal with Zaphod/Ford/Arthur/Marvin/Trillian per role in `humanize.ts`.
7. **Themed CLI messages** — Implement the message table from Part 4. Calm, precise, Douglas Adams register. Touch points: `conductor.ts` (decision log entries), `cli.ts` (command descriptions), error handlers.
8. **"Don't Panic" error philosophy** — Every error: state fact → give reference → end with next action. Audit all `console.error` and `toast.error` calls.
9. **--help output rewrite** — The Guide entry for hog. Rewrite Commander.js descriptions.
10. **42 for RED verification** — When tests pass by construction: "42. But what was the question? Reopening test phase." Touch: `conductor.ts` RED verification log.

#### Phase 3: Additional Gates (P1 — Week 3-4)

The completeness-gates plan covers 5 gates. These are additional:

11. **Dependency vulnerability gate** — `npm audit --audit-level high` / `pip audit` / `cargo audit` as warning-severity gate in `quality-gates.ts`. Not in any existing plan.
12. **Unhide `pipeline watch`** — Remove `{ hidden: true }` from the watch command. Trivial but impactful for non-TUI users. Not in any plan.
13. **Cockpit retry action** — `r` key to retry failed phase from TUI. The cockpit-redesign plan lists keyboard shortcuts but doesn't include retry. **Add to cockpit-redesign plan.**

#### Phase 4: Strengthen Resilience (P2 — Week 4-5)

14. **Daemon RPC versioning** — No version negotiation on Unix socket connection. Not in hogd plan. **Add version field to RPC handshake.**
15. **Persist session maps** — `sessionToPipeline` and `sessionWorktrees` are in-memory only. Lost on daemon restart. Not in hogd plan's crash recovery section. **Write to PipelineStore.**
16. **Consolidate role enforcement** — `roles.ts` prompts and `role-context.ts` CLAUDE.md say similar things but are maintained separately. No plan covers this. **Single source of truth: generate CLAUDE.md from role definitions.**
17. **`pipeline.compare` with quality metrics** — Currently shows only duration. Add gate results, cost, test counts. Not in any plan.

#### Phase 5: Platform Differentiation (P3 — Week 5-8)

18. **Policy-as-Code engine** — Declarative YAML policies for quality standards, compliance. Referenced in strategic reviews but no plan exists.
19. **Worker adapter layer** — Abstract agent spawning to support non-Claude backends. Referenced in strategic reviews but no plan exists.
20. **MCP server** — Expose `pipeline.status`, `decision.list`, `run.replay` to external tools. Referenced in hogd plan Phase 3 but not detailed.
21. **`hog demo` polish** — Demo mode exists but isn't themed or polished. Under 2 minutes, impressive, first contact with the Heart of Gold.
22. **SBOM generation gate** — Software Bill of Materials for enterprise compliance.

### Execution Order

```
Week 1-2: Completeness Gates Plan (already approved, ready to execute)
          + GREEN verification fix (add to Phase C)
          + Stub detection as blocking gate (new gate)

Week 2-3: H2G2 Metaphor Integration (new work, parallel-safe)
          + Cockpit Redesign Polish (already in-progress)
          + Add retry action to cockpit

Week 3-4: Budget enforcement (new work)
          + Additional quality gates (vuln scan)
          + Dead config cleanup (extend drop-github-board)

Week 4-5: Resilience hardening (RPC versioning, session persistence)
          + Role enforcement consolidation
          + pipeline.compare enhancements

Week 5-8: Platform differentiation (policy engine, worker adapter, MCP)
```

### Cross-Plan Dependencies

```
completeness-gates ──→ cockpit-redesign (retry action needs gate failure state)
completeness-gates ──→ hogd-daemon (gates run in daemon, events stream to cockpit)
cockpit-redesign ──→ H2G2 metaphor (character names, themed messages display in cockpit)
drop-github-board ──→ budget enforcement (clean config before adding new fields)
pipeline-v2 ──→ completeness-gates (context flow enables contextual retry)
```

---

## Part 6: The Pitch

### For Developers

> hog is the Heart of Gold of development tools. You describe what you want to build.
> Six AI agents — each with a distinct role, none able to mark their own homework —
> navigate through brainstorming, story writing, test creation, implementation,
> adversarial review, and merge. Tests must fail before implementation begins.
> Quality gates cannot be bypassed. The answer isn't 42 — it's tested, reviewed,
> merged code.
>
> Don't Panic. hog makes bad code improbable.

### For Teams/Enterprise

> hog enforces the development practices your team aspires to but doesn't consistently follow.
> TDD isn't a suggestion — it's structurally verified. Code review isn't optional — an adversarial
> AI agent attacks every implementation. Security scanning, linting, and abuse detection happen at
> every merge. All of this is auditable, replayable, and configurable.
>
> The pipeline IS the policy.

---

*"The ships hung in the sky in much the same way that bricks don't." — Douglas Adams*

*hog hangs in the development pipeline in much the same way that untested code doesn't.*
