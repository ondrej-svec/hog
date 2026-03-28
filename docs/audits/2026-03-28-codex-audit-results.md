---
title: "Codex Audit Results — hog Grand Audit"
type: audit
date: 2026-03-28
model: gpt-5.3-codex (high reasoning)
status: complete
---

# Codex Audit Results

> Audit performed by OpenAI Codex (gpt-5.3-codex, high reasoning, read-only sandbox)
> against the requirements established in the Grand Audit document.

## Functional Requirements

| Req | Status | Priority | Key Finding |
|-----|--------|----------|-------------|
| FR-1: DAG Orchestration | PARTIAL | P1 | Pipeline IDs are random, not content-addressable; no sub-DAG API |
| FR-2: Role Separation | BROKEN | P0 | Role-audit depends on Refinery which isn't wired in daemon; prompt/CLAUDE.md drift |
| FR-3: TDD RED/GREEN | PARTIAL | P1 | Both exist but scoped files not passed; poll-driven (10s) not event-driven |
| FR-4: Story Traceability | PARTIAL | P1 | Advisory only; >25% blocking threshold not enforced |
| FR-5: Mutation Testing | PARTIAL | P2 | Detection logic misaligned between tdd-enforcement and quality-gates |
| FR-6: Red Team | PARTIAL | P1 | Model divergence not enforced; attack categories not structured |
| FR-7: Refinery | BROKEN | P0 | Not wired into daemon/conductor; cockpit merge queue always empty |
| FR-8: Human-in-Loop | PARTIAL | P1 | No integration story pre-impl gate; no sentiment parser |
| FR-9: Parallel + Worktrees | BROKEN | P0 | Daemon doesn't pass worktrees; impl parallelization disabled; naive chunking |
| FR-10: Context Flow | PARTIAL | P1 | Scaffold detection non-blocking |
| FR-11: Daemon (hogd) | PARTIAL | P1 | No protocol versioning; CLI fallback paths bypass daemon |
| FR-12: Completeness Gates | PARTIAL | P1 | No retry context injection; no sentiment gate; inconsistent retry caps |
| FR-13: Permissions/Safety | PARTIAL | P0 | Key layers inactive in daemon path |
| FR-14: Quality Gate Registry | PARTIAL | P1 | Missing enterprise gates; execution depends on inactive Refinery |
| FR-15: Budget Controller | PARTIAL | P0 | Schema exists, zero enforcement, cost fields never populated |

## Non-Functional Requirements

| Req | Status | Priority | Key Finding |
|-----|--------|----------|-------------|
| NFR-1: Real-Time Telemetry | PARTIAL | P1 | Push events exist but cockpit still polls 3s for pipeline/decisions |
| NFR-2: Replay | BROKEN | P0 | Shared events.jsonl, brittle featureId filtering |
| NFR-3: First-Run | PARTIAL | P2 | Demo exists, no SLA enforcement |
| NFR-4: Crash Recovery | PARTIAL | P0 | Session/worktree maps lost on restart |
| NFR-5: Extensibility | PARTIAL | P2 | No plugin manifests, no MCP server, no worker adapter |
| NFR-6: Performance | MISSING | P2 | No enforced targets anywhere |
| NFR-7: Safety Layers | BROKEN | P0 | Key layers not active in production path |
| NFR-8: DX | PARTIAL | P2 | No retry action, no zen mode in current cockpit |

## H2G2 Metaphor

| Status | Priority | Finding |
|--------|----------|---------|
| MISSING | P2 | Zero runtime integration. Name only. No characters, concepts, or themed UX. |

## Known Issues Verification

| # | Issue | Codex Verdict |
|---|-------|---------------|
| 1 | pipeline.phases dead config | **Confirmed** |
| 2 | board section vestigial | **Confirmed** |
| 3 | Role prompt/CLAUDE.md drift | **Confirmed** |
| 4 | Budget schema without enforcement | **Confirmed** |
| 5 | GREEN verification not wired | **Not confirmed** — Codex found it IS wired at conductor.ts:1285 |
| 6 | Stub detection non-blocking | **Confirmed** |
| 7 | pipeline.watch hidden | **Confirmed** |
| 8 | clarity-analyst/stuck-agent aspirational | **Confirmed** |
| 9 | RepoConfig requires GitHub fields | **Confirmed** |
| 10 | tmux undocumented | **Partially outdated** — documented as optional in README |
| 11 | No cockpit retry action | **Confirmed** |
| 12 | Orchestrator vestigial | **Likely confirmed** |
| 13 | RPC version negotiation absent | **Confirmed** |
| 14 | Session maps in-memory only | **Confirmed** |

## Codex Top 10 Improvements (Prioritized)

1. **P0** Wire `WorktreeManager` + `Refinery` into daemon/conductor runtime
2. **P0** Make role-audit and quality gates execute in primary pipeline path, fail-closed
3. **P0** Implement budget enforcement + cost accounting from agent/model outputs
4. **P0** Fix replay logging: per-pipeline JSONL with explicit `featureId`
5. **P0** Persist and recover session/worktree mappings across daemon restarts
6. **P1** Enforce redteam model divergence from impl model
7. **P1** Convert traceability from advisory to threshold-based blocking gate
8. **P1** Add structured retry context injection + sentiment gate parsing
9. **P1** Make scoped RED/GREEN verification use new test files by default
10. **P2** Replace dead config (`pipeline.phases`, vestigial `board`) and clean CLI/help UX

## Architecture Diagram (Current)

```
CLI / Cockpit
   |
   | ensureDaemonRunning()
   v
hogd (Unix socket JSON-RPC, NDJSON events)
   - ~/.config/hog/hogd.sock
   - ~/.config/hog/hogd.pid
   |
   +--> Engine
   |     +--> EventBus
   |     +--> AgentManager --> spawnBackgroundAgent("claude --output-format stream-json")
   |     +--> BeadsClient (bd + Dolt DAG backend)
   |     +--> WorkflowEngine / Orchestrator (legacy+support)
   |
   +--> Conductor (polls bd ready, phase orchestration, TDD checks, question queue)
   |     +--> PipelineStore (~/.config/hog/pipelines.json)
   |     +--> QuestionQueue (~/.config/hog/question-queue.json)
   |
   +--> EventLog (~/.config/hog/pipelines/events.jsonl)  [shared file]
   |
   +--> Subscribers (cockpit/client push events)

⚠️  Defined but NOT wired in daemon runtime:
   - WorktreeManager (isolation)
   - Refinery (serial merge queue + quality gates + role audit)
```

## Gap Analysis: Current vs Best Agentic Dev Tool

| Dimension | Current | Target | Gap |
|-----------|---------|--------|-----|
| Execution safety | Layers exist but key ones inactive | All layers always-on, fail-closed | HIGH |
| Determinism/replay | Heuristic shared-log | Pipeline-scoped immutable event streams | HIGH |
| Governance/compliance | Gate framework exists | Enforced registry with supply-chain/legal depth | MEDIUM |
| Autonomy economics | Model routing exists | Strict budget policy + real-time cost telemetry | HIGH |
| Human control plane | Decisions work | Richer ops controls, stuck/sentiment detection | MEDIUM |
| Scalability | Test-only parallelism | Robust chunking + worktree isolation + merge serialization | HIGH |
| Product identity | H2G2 name only | Optional themed semantics throughout UX | LOW |
