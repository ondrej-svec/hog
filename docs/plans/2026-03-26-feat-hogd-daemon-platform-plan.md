---
title: "feat: hogd daemon + platform foundations — the 2026 play"
type: plan
date: 2026-03-26
status: in_progress
brainstorm: docs/brainstorms/2026-03-26-strategic-platform-review.md
confidence: medium
---

# hogd Daemon + Platform Foundations

**One-line summary:** Replace the multi-process watcher model with a single `hogd` daemon that owns all pipeline state, agent processes, and Beads servers — then build the 5 strategic platform features on top.

## Problem Statement

The cockpit shows "0 agents" and stale progress because the watcher and cockpit are separate processes sharing state via file polling. The watcher owns the Claude processes and real-time telemetry. The cockpit can only see what's written to `pipelines.json` every few seconds. Agent tool-use, PID tracking, and EventBus events never cross the process boundary.

This isn't a bug — it's an architectural ceiling. Every platform feature (replay, policy, team ops) needs a single authoritative runtime. File polling can't carry real-time agent telemetry, event streams, or multi-client subscriptions.

## Proposed Solution

Three phases over ~6 weeks:
1. **hogd daemon** — single process, Unix socket IPC, replaces watchers
2. **Runtime truthfulness** — cockpit shows real-time agent activity
3. **Platform foundations** — demo mode, model router, replay groundwork

---

## Phase 1: hogd Daemon (weeks 1-2)

**Goal:** A single long-lived process that owns all Conductor, AgentManager, and Beads lifecycle. CLI and cockpit become thin clients over Unix socket.

### Architecture

```
hogd (daemon process)
├── Conductor (all pipelines)
├── AgentManager (all Claude processes)
├── PipelineStore (authoritative state)
├── EventBus (streams to all clients)
├── BeadsClient (Dolt server lifecycle)
└── Unix socket: ~/.config/hog/hogd.sock

hog cockpit ──────┐
hog pipeline * ───┤── Unix socket clients
hog decisions ────┘
```

### Tasks

- [ ] **1.1 Create `src/daemon/hogd.ts` — daemon entry point**
  Starts a `net.createServer()` Unix domain socket at `~/.config/hog/hogd.sock`.
  Instantiates: Engine, Conductor, AgentManager, PipelineStore, BeadsClient.
  Calls `conductor.start()` — the daemon IS the conductor.
  Writes PID file to `~/.config/hog/hogd.pid`.
  Handles SIGINT/SIGTERM for graceful shutdown (stop agents, stop Dolt, remove socket).

- [ ] **1.2 Define IPC protocol — JSON-RPC over Unix socket**
  Simple protocol: newline-delimited JSON messages.
  Request: `{ "id": 1, "method": "pipeline.list", "params": {} }`
  Response: `{ "id": 1, "result": [...] }`
  Event: `{ "event": "agent:progress", "data": { ... } }` (no id — push only)

  Methods:
  - `pipeline.list` → `Pipeline[]`
  - `pipeline.create` → `Pipeline | { error }`
  - `pipeline.pause/resume/cancel` → `{ ok: boolean }`
  - `pipeline.review` → structured summary
  - `decision.list` → `Question[]`
  - `decision.resolve` → `{ ok: boolean }`
  - `agent.list` → `TrackedAgent[]` (with live telemetry)
  - `daemon.status` → `{ pid, uptime, pipelines, agents }`
  - `subscribe` → start receiving push events

- [ ] **1.3 Create `src/daemon/client.ts` — IPC client**
  `connect(socketPath)` → returns a typed client with methods matching the protocol.
  `subscribe(callback)` → receives push events.
  Auto-reconnect on disconnect.
  Timeout after 5s if daemon not running.

- [ ] **1.4 Add `hog daemon start/stop/status` CLI commands**
  - `hog daemon start` — starts hogd in background (detached), or foreground with `--foreground`
  - `hog daemon stop` — sends SIGTERM via PID file
  - `hog daemon status` — connects to socket, calls `daemon.status`
  - Auto-start: if any `hog pipeline *` command runs and daemon isn't up, start it automatically

- [ ] **1.5 Bridge EventBus to connected clients**
  Daemon-side: listen on all EventBus events, serialize payload, write to all connected sockets that called `subscribe`.
  Key events to bridge: `agent:spawned`, `agent:progress`, `agent:completed`, `agent:failed`, `workflow:phase-changed`.
  `agent:progress` is high-frequency (every Claude stream line) — throttle to max 2 events/second per client.

- [ ] **1.6 Migrate `pipeline create` to use daemon**
  Instead of spawning a watcher process at `cli.ts:411`, send `pipeline.create` RPC to daemon.
  Daemon creates the pipeline, starts ticking it — no watcher needed.
  Fallback: if daemon not running, auto-start it.

- [ ] **1.7 Migrate `pipeline watch` command to daemon-only**
  The watch command becomes a thin wrapper: connect to daemon, call `subscribe`, print events until pipeline completes.
  Used for backward compat and for log streaming.

### Decision Rationale
- **Unix socket over HTTP**: simpler, faster, no port conflicts. Socket file auto-cleans on crash (mostly). Same pattern as Docker, containerd, Beads Dolt.
- **JSON-RPC over custom protocol**: familiar, debuggable (`echo '{"method":"daemon.status"}' | socat - UNIX:~/.config/hog/hogd.sock`), trivially extensible.
- **Single daemon over one-watcher-per-pipeline**: eliminates race conditions on `pipelines.json`, centralizes agent tracking, enables multi-client subscriptions.

### Risks
- Daemon crashes → all pipelines stall. Mitigate: PipelineStore persists to disk, daemon auto-recovers state on restart via `PipelineStore.load()`.
- Socket permissions on multi-user systems. Mitigate: `0600` permissions on socket file.
- Auto-start adds latency to first command. Mitigate: daemon startup is <500ms (no heavy I/O).

---

## Phase 2: Runtime Truthfulness (week 3)

**Goal:** Cockpit shows real-time agent activity — what tool Claude is using RIGHT NOW, live progress updates, accurate agent count.

### Tasks

- [ ] **2.1 Rewrite `use-pipeline-data.ts` as daemon client**
  Replace file polling with socket connection:
  - On mount: connect to daemon, call `pipeline.list` + `agent.list` + `decision.list`
  - Call `subscribe` to receive push events
  - On `agent:progress` event: update agent telemetry in React state
  - On `pipeline:phase-changed` event: update pipeline in React state
  - Mutations: `startPipeline` → `pipeline.create` RPC, etc.
  Remove: `conductorRef`, `agentManagerRef`, `BeadsClient` instantiation from the hook.

- [ ] **2.2 Show live agent telemetry in pipeline-view.tsx**
  With daemon streaming `agent:progress` events, show:
  ```
  ── Agents ──
  ◐ stories  using Read (src/auth.ts)  3m
  ```
  Update `lastToolUse` in real-time from events.

- [ ] **2.3 Show pipeline log streaming**
  Instead of reading last 20 lines from log file on selection change, subscribe to daemon's event stream filtered by `featureId`. Show events as they happen.

- [ ] **2.4 Auto-start daemon from cockpit**
  If `hog cockpit` runs and daemon isn't up, start it in background before connecting.
  Show "Starting daemon..." briefly.

### Acceptance Criteria
- `hog cockpit` shows live agent tool use (updates within 500ms)
- Agent count matches actual running Claude processes
- Pipeline progress updates in real-time (not 3s poll lag)
- Log entries appear as they happen

---

## Phase 3: Platform Foundations (weeks 4-6)

**Goal:** Build the first 3 of the 5 strategic bets on the daemon foundation.

### 3A: Demo Mode (week 4)

- [ ] **3A.1 Add in-memory Beads driver**
  `beadDriver: "beads" | "memory"` in config. Memory driver simulates `bd ready`, `bd close` etc. with in-memory state. No Dolt dependency.

- [ ] **3A.2 Add `hog demo` command**
  Starts daemon with memory driver, creates a sample pipeline on a bundled tiny project, runs it with mock agents (simulated tool use at 2x speed), shows cockpit.
  Total time: <2 minutes. Zero external dependencies.

- [ ] **3A.3 Bundled sample project**
  Tiny TypeScript project with 3 files, 2 existing tests. The demo pipeline adds a "greeting" feature. Stories agent writes 2 stories. Test agent writes 3 tests. Impl agent writes ~20 lines. Redteam writes 1 edge case test. Merge rebases and passes.

### 3B: Model Router (week 5)

- [ ] **3B.1 Add `pipeline.models` config**
  ```
  pipeline:
    models:
      brainstorm: claude-sonnet-4-5
      stories: claude-haiku-4-5
      test: claude-sonnet-4-5
      impl: claude-opus-4-5
      redteam: claude-sonnet-4-5
      merge: claude-haiku-4-5
  ```

- [ ] **3B.2 Wire model selection into spawn-agent.ts**
  Resolve model from pipeline config → role → pass to Claude CLI via `--model` flag.
  Default: use whatever `claude` CLI defaults to.

- [ ] **3B.3 Add budget tracking**
  Track estimated token cost per phase. Store in pipeline state.
  Add `pipeline.budget` config with per-pipeline and per-phase limits.
  When budget exceeded → block pipeline + queue decision for human.

### 3C: Run Replay Foundation (week 6)

- [ ] **3C.1 Append-only event log per pipeline**
  Daemon writes every EventBus event to `~/.config/hog/pipelines/<featureId>.events.jsonl`.
  Schema: `{ timestamp, event, data }` per line.

- [ ] **3C.2 `hog pipeline replay <featureId>` command**
  Reads the event log. Replays in the cockpit at 10x speed (configurable).
  Shows: which agent ran when, what tools were used, how long each phase took.

- [ ] **3C.3 `hog pipeline compare <id1> <id2>` command**
  Side-by-side comparison: phase durations, agent count, cost, test count, quality gate results.

---

## Acceptance Criteria

### Phase 1 (daemon)
- `hog daemon start` launches a persistent process
- `hog daemon status` shows PID, uptime, pipeline count, agent count
- `hog pipeline create` creates pipeline via daemon (no watcher spawned)
- `hog cockpit` connects to daemon over socket
- Multiple cockpit instances can connect simultaneously

### Phase 2 (truthfulness)
- Cockpit shows live agent tool use (< 500ms latency)
- Agent count matches reality
- Pipeline progress updates in real-time
- Pressing `l` shows streaming log, not static file read

### Phase 3 (foundations)
- `hog demo` runs a complete pipeline in <2 minutes with zero external deps
- Per-role model selection works (`--model` passed to Claude)
- `hog pipeline replay` shows a recorded run in the cockpit
- `hog pipeline compare` outputs a comparison table

---

## Risk Summary

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Daemon crash kills all pipelines | Medium | High | PipelineStore persists; daemon auto-recovers on restart |
| Unix socket cross-platform issues (Windows) | Low | Medium | Use TCP localhost as fallback; document Unix-only for v2 |
| Agent telemetry too noisy for cockpit | Medium | Low | Throttle `agent:progress` to 2/s per client |
| Demo mode agents don't feel real | Medium | Medium | Record a real pipeline run, replay it in demo mode |
| Model router increases cost unpredictably | Low | Medium | Budget caps per phase with human escalation |
| Migration breaks existing watcher-based pipelines | Medium | Medium | Keep `pipeline watch` as thin client; auto-start daemon on first use |
