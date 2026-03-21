---
title: "Hog as the Rails of Agent-Assisted Development"
type: brainstorm
date: 2026-03-21
participants: [ondrejsvec, claude]
related:
  - docs/brainstorms/2026-03-01-workflow-conductor-brainstorm.md
  - docs/brainstorms/2026-03-07-zen-mode-agent-orchestration-brainstorm.md
  - docs/brainstorms/2026-02-24-launch-claude-code-from-issue-brainstorm.md
---

# Hog as the Rails of Agent-Assisted Development

## Problem Statement

Good agent-assisted development requires two things most people don't have:

1. **Deep software engineering discipline** — TDD, security analysis, architectural thinking, proper user stories. Even senior devs struggle to enforce this consistently; juniors and non-devs have no chance.
2. **Complex multi-tool orchestration** — Beads for agent memory, GitHub/Linear for collaboration, Claude Code for execution, worktrees for isolation, quality gates for safety. Stitching this together is a week of yak-shaving.

Today, agents write code fast but produce undisciplined output — no tests, no security review, no design. The tools to fix this exist in pieces (Beads, Gastown, Claude Code) but nobody has built the **opinionated, zero-config layer** that makes disciplined agent development the path of least resistance.

Hog's opportunity: be the Rails of agent dev. One right way. Convention over configuration. `hog init` and go.

## Context

### What Hog Is Today

A personal GitHub Projects TUI with workflow orchestration. Commands: board, pick, launch, issue CRUD. Spawns Claude Code agents per phase (brainstorm/plan/implement/review). Tracks agent sessions locally. GitHub as source of truth, local enrichment for agent state. Already has: streaming agent monitoring, tmux integration, configurable phases, auto-status updates.

### Beads (Steve Yegge)

Local-first, git-backed issue tracker for agents. 18.7k stars. Key primitives:
- **Dependency DAG** with `bd ready` — "what can I work on now?"
- **Hash-based IDs** for merge-safe concurrent work
- **Semantic compaction** (`bd compact`) — memory decay for context windows
- **Token-efficient** — 1-2k tokens per interaction vs 10-50k for API approaches
- **MCP integration** — agents call `bd create/ready/update/close` directly

Beads is agent working memory. Not a replacement for GitHub/Linear (human collaboration) — complementary.

### Gastown (Steve Yegge)

Multi-agent orchestrator. Key ideas worth taking:
- **Isolated worktrees** — each agent gets its own git worktree, no file contention
- **Refinery** — single merge gatekeeper that serializes integration, runs quality checks
- **Persistent identity** — agent work history survives context resets

What to skip: the complexity (Polecats, Mayor, Deacon, Dogs), the $100/hr cost model, the "Stage 7-8 developers only" audience, the fragile early-stage implementation.

### Expert Panel Insights (Applied)

| Expert | Key Insight | How It Shapes the Design |
|--------|------------|--------------------------|
| Steve Yegge | Pipeline should emerge from Beads DAG, not hardcoded state machine | Dependencies define workflow; phases are emergent, not prescribed |
| Cal Newport | Batch human decisions; protect deep work from notification firehose | "Office hours" model — queue questions, human does decision sessions |
| Andrew Ng | Test quality is the hardest unsolved problem; same model in adversarial roles = mode collapse | Clarity Analyst must be smartest agent; different models for different roles |
| Gene Kim | Tracer bullet = first thing through the full pipeline; fast feedback loops | User stories ARE the tracer bullets; Red→Green loop must be seconds, not minutes |
| Dario Amodei | No agent should mark its own homework; audit trails for every decision | Structural separation of test writer and implementer; full provenance logging |
| Adam Grant | Constructive conflict > consensus; need outcome accountability, not just process | Adversarial pairs framed as "thorough review"; track which configurations produce best code |
| Matous Havlena | First experience must be < 5 minutes; opinionated pipeline IS the moat | `hog init` → describe feature → walk away → tested + secure code. Zero config. |

## Chosen Approach

### Architecture: Engine First, Board Second

Hog becomes primarily an **orchestration engine** with the TUI as one view into it. The engine:
- Runs as daemon/background process
- Exposes capabilities via MCP server (agents can call hog)
- Can be driven headless (CI, scripts, other tools)
- TUI is the premium human experience but not required

### Three-Layer Stack

```
┌─────────────────────────────────────────────┐
│  Human Layer                                │
│  Issue trackers (GitHub, Linear, etc.)      │
│  Pluggable. Human collaboration + planning. │
└──────────────────┬──────────────────────────┘
                   │ sync
┌──────────────────▼──────────────────────────┐
│  Hog Engine                                 │
│  Orchestration + Quality Enforcement        │
│  The opinionated layer. Conductor agent.    │
│  Spawns/monitors agents. Enforces TDD.      │
│  Security/linting continuous. Refinery.     │
└──────────────────┬──────────────────────────┘
                   │ reads/writes
┌──────────────────▼──────────────────────────┐
│  Beads Layer                                │
│  Agent memory + task DAG                    │
│  Always present. Fast. Local-first.         │
│  Agents interact here via bd CLI/MCP.       │
└─────────────────────────────────────────────┘
```

Beads is always the agent-facing layer (fast, local, DAG-based). Issue trackers are pluggable on top for human collaboration. Hog Engine sits between them, enforcing the methodology.

### The Development Pipeline (DAG-Emergent + Conductor)

The pipeline is NOT a hardcoded state machine. It's a **Beads dependency DAG** managed by a **conductor agent**.

For a feature "Add user authentication", the conductor creates this bead structure:

```
bd-a1: "User stories: authentication"          [type: stories]
  ├── bd-a2: "Acceptance tests: auth"           [type: test, blocks: bd-a3]
  │     └── MUST be RED before bd-a3 starts
  ├── bd-a3: "Implement: auth"                  [type: impl, blocked-by: bd-a2]
  │     └── Different agent than bd-a2. Sees only tests.
  ├── bd-a4: "Red team: auth"                   [type: redteam, blocked-by: bd-a3]
  │     └── Adversarial. Writes attack tests.
  │           If new tests go RED → creates new impl bead blocked-by those tests
  └── bd-a5: "Refinery merge: auth"             [type: merge, blocked-by: bd-a4]
        └── Rebase, full suite, linting, security scan. Final gate.
```

Agents call `bd ready` and work on whatever's unblocked. The conductor:
- Creates the bead structure from specs/user stories
- Spawns agents for ready beads
- Monitors progress and handles stuck situations
- Enforces role separation (test agent ≠ impl agent)
- Manages the Refinery merge queue

### Non-Negotiable Quality Rules

**1. TDD is structural, not aspirational**
- Test Writer agent creates tests from user stories. Tests MUST be RED.
- Implementation agent is a DIFFERENT agent. It sees ONLY the tests, not the original spec.
- If tests aren't RED, the bead is rejected. No implementation begins.
- The test is the contract. The spec is context for the Test Writer, not the Implementer.

**2. User stories ARE tracer bullets**
- Every feature starts as user stories with acceptance criteria.
- User stories become executable acceptance tests (the tracer bullet).
- The tracer bullet must pass through the full pipeline (test → impl → review → merge) before any other work begins.
- Spec traceability: every test traces to a story, every story has tests. Orphans are flagged.

**3. Test quality is verified, not assumed**
- **Mutation testing**: after tests pass, automatically mutate code and verify tests catch mutations. Weak tests are flagged.
- **Spec traceability**: coverage of requirements is structural (story ↔ test mapping), not just line coverage.
- Both run automatically. No human action needed.

**4. Security/linting/abuse are continuous**
- Security analysis runs on every code change, not just at review.
- Linting is enforced during implementation, not post-hoc.
- Abuse/injection analysis happens as code is written.
- These are not gates — they're ambient. Like a spell checker, not a copy editor.

**5. No agent marks its own homework**
- Test Writer and Implementer are always different agents (different sessions, different context).
- Red Team agent is adversarial to the Implementer — tries to break the code.
- Different models for different roles to prevent mode collapse (same blind spots).
- Full provenance: every decision, test, merge is logged and attributable.

### Clarity-First Autonomy

Hog decides whether specs are clear enough for autonomous work:

- **Clear spec** → agents proceed without human. Full autonomy through the pipeline.
- **Unclear spec** → queued for human decision session (Cal Newport's "office hours" model).
- **Ambiguous** → conductor asks targeted clarifying questions, batched with other questions.

The Clarity Analyst is the **smartest agent in the pipeline** (best model, most context). Garbage specs = garbage output regardless of how good the TDD enforcement is.

### Batched Human Interaction

Humans interact in two modes:

1. **Creative sessions** (brainstorming, design decisions) — deep work, board disappears, full collaboration with AI partner.
2. **Decision sessions** (office hours) — system presents batched questions accumulated since last session. Human makes decisions, agents unblock.

Between sessions, agents work autonomously on everything that's clear. The system never interrupts deep work with individual notifications — it queues them.

### Isolated Execution (Gastown's Best Idea)

Every implementation agent works in its own **git worktree**:
- No file contention between concurrent agents
- Each agent has its own branch
- The Refinery is the single serialization point for merging to main
- Rebase-based merging keeps history linear
- Full test suite + security scan runs at merge time

### Agent Role Architecture

| Role | Responsibility | Model Strategy | What It Sees |
|------|---------------|----------------|-------------|
| **Clarity Analyst** | Evaluate spec completeness, break into stories | Best available model | Full spec, project context, past decisions |
| **Test Writer** | Convert stories → failing tests (RED) | Strong reasoning model | User stories + acceptance criteria only |
| **Implementer** | Write code to pass tests (GREEN) | Strong coding model | Tests only. NOT the spec. |
| **Red Team** | Break the implementation, find edge cases | Different model than Implementer | Tests + implementation + security context |
| **Refinery** | Merge, full suite, linting, security | Can be lighter model | All code, all tests, merge context |
| **Conductor** | Orchestrate the DAG, spawn agents, handle stuck | Strong reasoning model | Everything — the "air traffic controller" |

Different models for adversarial roles prevent mode collapse.

## Why This Approach

### What it optimizes for
- **Accessibility**: `hog init` → describe feature → walk away → quality code. A junior dev or non-dev gets the same discipline as a senior.
- **Quality floor**: structurally impossible to produce untested, unreviewed code. The pipeline prevents it, not willpower.
- **Autonomy**: clear specs run end-to-end without human intervention. The opinionated structure enables freedom.
- **Speed**: parallel agents on isolated worktrees, serialized only at merge. Fast feedback loops (seconds, not minutes).

### What it costs
- **Compute**: multiple agents per feature (Clarity + Test Writer + Implementer + Red Team + Refinery). More expensive than single-agent.
- **Rigidity**: Rails-level opinions mean some workflows don't fit. Escape hatches exist but aren't encouraged.
- **Beads dependency**: Beads becomes a core dependency. If Beads' direction diverges, it's a problem.
- **Complexity**: the conductor + DAG + role separation is significantly more complex than "just spawn an agent."

### What was rejected
- **Hardcoded state machine**: too rigid, doesn't use Beads natively, can't adapt to different project shapes.
- **Gastown's full complexity**: Polecats/Mayor/Deacon/Dogs — too many concepts, too niche, too expensive.
- **Human-in-the-loop at every step**: destroys deep work, doesn't scale, defeats the purpose of automation.
- **Quality gates only at review**: too late. Security issues and bad tests should be caught as they're created, not after.
- **Single agent does everything**: no separation of concerns, agent marks its own homework, no adversarial pressure.

## Key Design Decisions

### Q1: Issue tracker integration — RESOLVED
**Decision:** Beads is the always-on agent memory/task layer. Issue trackers (GitHub, Linear) are pluggable on top for human collaboration. Beads is always present.
**Rationale:** Beads is purpose-built for agents (fast, local, DAG-based, token-efficient). Human trackers are purpose-built for humans. They complement each other. Hog bridges them.
**Alternatives considered:** Replace GitHub entirely with Beads (loses collaboration); integrate with Beads optionally (loses the DAG-as-pipeline architecture); build our own tracking (reinventing the wheel).

### Q2: Pipeline architecture — RESOLVED
**Decision:** Beads dependency DAG defines the workflow. A conductor agent manages the overall flow, spawns agents, handles stuck situations. Pipeline is emergent from dependencies, not prescribed.
**Rationale:** DAG-as-pipeline is more flexible than a state machine, uses Beads natively, and can adapt to different project shapes. The conductor adds active management without hardcoding phases.
**Alternatives considered:** Hardcoded phase state machine (too rigid); pure DAG without conductor (no stuck-handling, no active orchestration).

### Q3: Quality enforcement level — RESOLVED
**Decision:** Rails-level opinionated. TDD is non-negotiable and structurally enforced. Security/linting are continuous. No escape without explicit override.
**Rationale:** The opinionated pipeline IS the moat. Anyone can orchestrate agents. Nobody else structurally prevents bad code. Making good practices the default is the entire value proposition.
**Alternatives considered:** Configurable guardrails (too easy to turn off); progressive disclosure (delays the value).

### Q4: Test writer ≠ implementer — RESOLVED
**Decision:** Structural separation. Different agents, different context, different models. Test Writer sees specs, Implementer sees only tests.
**Rationale:** Prevents the most common agent failure: writing tests that just validate existing implementation. The Implementer being blind to the spec forces it to satisfy the tests genuinely. Different models prevent shared blind spots.
**Alternatives considered:** Same agent for both (marks own homework); same model different session (mode collapse risk).

### Q5: Human's role — RESOLVED
**Decision:** Creative decisions only. Human decides WHAT to build and WHY. Everything else (how, testing, security, integration) is automated. Human reviews final output.
**Rationale:** Maximizes human leverage. The human's creativity and judgment are the scarce resource; implementation discipline should be automated.
**Alternatives considered:** Human in every loop (doesn't scale); human only at final review (misses creative input).

### Q6: Product shape — RESOLVED
**Decision:** Engine first, board second. Hog is primarily an orchestration engine. TUI is one view. Can also be MCP server, headless, web UI.
**Rationale:** The engine is the value — it enforces the methodology. The board is a great experience but shouldn't be required. Engine-first enables CI integration, headless operation, and other UIs.
**Alternatives considered:** Board-centric (limits integration); two separate products (fragmentation).

### Q7: Human interaction model — RESOLVED
**Decision:** Batched "office hours" model. Creative sessions for deep work. Decision sessions for queued questions. Never interrupt with individual notifications.
**Rationale:** Cal Newport's insight — protecting deep work from notification firehose. The system is patient; humans are the bottleneck, not the agents.
**Alternatives considered:** Real-time notifications (destroys focus); fully autonomous (loses human creativity).

### Q8: Test quality verification — RESOLVED
**Decision:** Both mutation testing AND spec traceability.
**Rationale:** Traceability ensures coverage of requirements (structural completeness). Mutation testing ensures tests actually verify behavior (behavioral completeness). Belt and suspenders.
**Alternatives considered:** Only line coverage (measures quantity not quality); only mutation testing (doesn't ensure requirement coverage); only traceability (doesn't ensure test strength).

## Open Questions

1. **Beads integration depth** — Do we vendor Beads, depend on it as a binary, or build a compatible layer? Beads is Go, hog is TypeScript. What's the interface boundary?

2. **Model routing strategy** — How does hog decide which model to use for which role? Static config? Dynamic based on task complexity? Cost-aware routing?

3. **Conductor agent implementation** — Is the conductor a persistent daemon, a spawned agent per feature, or part of the hog engine itself (not an LLM agent)?

4. **Mutation testing tooling** — Which mutation testing framework? Language-specific (Stryker for JS/TS, mutmut for Python) or a universal approach?

5. **Spec completeness heuristics** — What makes a spec "clear enough"? This is the Clarity Analyst's job, but what are the concrete criteria? Acceptance criteria present? Edge cases identified? Scope bounded?

6. **Multi-language support** — The quality pipeline (TDD, linting, security) is language-specific. How does hog handle polyglot repos? Per-language tool configs?

7. **Cost model** — Multiple agents per feature is expensive. How do we make this accessible? Tiered plans? Model quality vs cost tradeoffs? Local model support?

8. **Migration path from current hog** — How do existing hog users transition? Can the board experience remain while the engine grows underneath?

## Out of Scope

- **Team collaboration features** — Hog is a personal tool. GitHub/Linear handle team coordination.
- **Custom LLM training** — We use available models, not fine-tuned ones.
- **IDE integration** — Engine-first means IDEs can integrate via MCP, but building IDE plugins is out of scope.
- **Deployment/CI orchestration** — Hog builds and tests code. Deploying it is another tool's job.

## Next Steps

- `/plan` to create an implementation plan from these decisions
- Consider `/compound` for the "DAG-as-pipeline" pattern — novel approach worth documenting
- Research Beads integration options (binary dependency vs compatible TypeScript implementation)
- Prototype the conductor agent + role separation with a simple feature
