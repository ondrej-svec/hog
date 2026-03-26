---
title: "Strategic Platform Review — hog v2.0.0"
type: brainstorm
date: 2026-03-26
participants: [ondrejsvec, claude, codex-gpt-5.3]
---

# Strategic Platform Review — hog v2.0.0

*Combined review by Codex (gpt-5.3-codex, xhigh reasoning) acting as: YC CTO, Karpathy, Yegge, DHH, Vercel product, security researcher.*

## 1. Verdict: Is This a Platform?

**Short answer:** Yes, but not yet. It is a strong **platform seed**, not a finished platform business.

**What is genuinely novel:**
- Deterministic orchestration with explicit role separation and TDD checkpoints is real differentiation, not just "agent wrapper" UX
- The Beads DAG phase topology is explicit and auditable

**What is derivative:**
- Execution is still "spawn Claude CLI process + poll files," so it's easy for larger players to copy surface behavior

**Current moat:** Weak-to-moderate. Prompts and phase names are copyable.

**Potential moat:** Strong, if you become the **reliability/governance control plane** for any coding agent (Claude/Cursor/Devin/etc), with replayability, policy, and compliance-grade audit trails.

## 2. The #1 Problem to Solve

The root issue is **architectural split-brain**, not just UI polling frequency.

**What's happening now:**
- Cockpit intentionally does not run conductor ticks
- Cockpit polls `pipelines.json` but gets agents from its own in-process `AgentManager`, so agent count is often zero
- `pipelines.json` does not store runtime agent telemetry (pid/tool use/session status)
- Multiple detached watchers can exist, creating racey last-write-wins state persistence

**Architectural fix:**
1. Build a single long-lived `hogd` daemon as sole owner of `Conductor + AgentManager + Beads`
2. Make cockpit and CLI thin clients over IPC (Unix socket): `request/response + event stream`
3. Split state into:
   - Durable pipeline checkpoint store
   - Live runtime snapshot (`agents`, `tool_use`, `current phase attempt`, `watchdog health`)
   - Append-only event log for replay
4. Add `featureId` to tracked agents/events so cockpit can map agents to pipelines directly
5. Remove per-pipeline watcher spawning after daemon rollout

## 3. Agent Architecture Critique

**6-phase DAG:**
- Good default. Keep it as canonical "Rails path"
- Make it **template-configurable**, not arbitrary DAG-by-default. Code is hard-wired to six phases while config defaults still reference legacy four-phase flow

**Should conductor be an LLM?**
- No. Keep conductor deterministic. LLM can advise, never own state transitions.

**Multi-model strategy:**
- Missing today. Role configs have no model policy and spawn path has no per-role model routing
- Add per-role model tiers and budget caps: `stories/test/redteam` cheap, `impl/merge` expensive when needed

**Prompt quality:**
- `brainstorm`: ambitious and useful, but tool assumptions are brittle for generic runtime environments
- `stories/test/impl`: clear intent, enforcement mostly behavioral unless refinery/role-audit is active
- `redteam`: strongest prompt in set; has concrete adversarial goals
- `merge`: good in theory, but production wiring currently underuses refinery path

## 4. Developer Experience Gap Analysis

**First 5 minutes today:**
- Setup still carries legacy board/workflow semantics
- User can start pipeline, but cockpit cannot show truthful runtime activity
- `--stories` flag appears in UX but is not wired end-to-end

**What makes developers tell friends:**
- "I can see every agent in real time, with exact tool calls, and trust it"
- "I can replay a run and compare two runs"
- "I can enforce team policy in one file"

**Hello world equivalent:**
- `hog demo` on a bundled sample repo with deterministic tiny task, runs end-to-end in <2 minutes, no GitHub setup

**Demo/playground without Beads:**
- Add `beadDriver: "beads" | "memory"` and ship memory driver for onboarding/demo mode

## 5. Platform Play: The 5 Things to Build Next

| # | Feature | Why it matters | Effort |
|---|---------|---------------|--------|
| 1 | **Run Replay + Eval Harness** | Record/replay pipeline runs; compare pass rate, cost, lead time. Creates defensible data moat and buyer trust. | 6-8 weeks |
| 2 | **Policy-as-Code Engine** | Declarative policies for role boundaries, approval gates, security constraints. Enterprise wedge; turns orchestration into governance product. | 8-10 weeks |
| 3 | **Model Router + Budget Controller** | Per-phase model routing, fallback chains, budget/SLA targets. Cost-performance advantage at scale. | 4-6 weeks |
| 4 | **Worker Adapter Layer** | First-class adapters for Claude Code, Cursor agents, Devin-style executors. Survive vendor moves by being vendor-neutral control plane. | 6-9 weeks |
| 5 | **Team Decision Ops** | Batched approvals, reviewer assignment, escalation workflows, audit logs. Converts solo CLI into team platform. | 6-8 weeks |

## 6. Ecosystem & Business Model

**MCP server / plugins / marketplace:** Yes to all three.
- Start with MCP endpoints: `pipeline.status`, `pipeline.start`, `decision.list/resolve`, `run.replay`
- Plugin API should target phases, gates, and model routing policies

**Team + enterprise:**
- Must-have: SSO, RBAC, immutable audit log, policy bundles, self-hosted daemon mode

**Open source sustainability — open-core split:**
- OSS: local runner, basic cockpit, core DAG engine
- Paid: hosted control plane, analytics, policy packs, enterprise controls

## 7. Competitive Positioning

**How to survive platform encroachment:**
- Do not compete as "yet another coding agent"
- Position as the **orchestration/governance layer above all agents**
- Your wedge is deterministic process control, replayability, and policy compliance, not raw model quality

**Hard truth:**
- Some marketed guarantees are stronger than current production wiring (worktree/refinery paths are optional and not default in CLI construction)
- Fixing runtime truthfulness first is the prerequisite to everything else
