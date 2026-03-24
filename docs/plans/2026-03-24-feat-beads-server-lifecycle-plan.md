---
title: "feat: Beads server lifecycle — start, stop, status, auto-cleanup"
type: plan
date: 2026-03-24
status: in_progress
confidence: high
---

# Beads Server Lifecycle

**One-line summary:** Give hog full control over Dolt servers — `hog beads status/start/stop`, auto-stop on pipeline completion, port conflict resolution, and per-project port isolation.

## Problem Statement

Beads starts a Dolt SQL server per project. These servers:
- Never stop — they accumulate across projects and survive reboots
- Use a hardcoded port (23307) — multi-project conflicts are guaranteed
- Have no visibility — users don't know servers are running until a port conflict crashes pipeline creation
- Have no cleanup — orphan servers waste memory and block ports indefinitely

Users shouldn't need to know Dolt exists, but SHOULD be able to manage it when things go sideways.

## Proposed Solution

Three layers: CLI commands for explicit control, automatic lifecycle in the pipeline watcher, and per-project port isolation to prevent conflicts.

---

## Implementation Tasks

### Phase 1: BeadsClient server management methods

- [ ] **1.1 Add `stopDolt(cwd)` to BeadsClient**
  Run `bd dolt stop` in the given project directory. If `bd dolt stop` doesn't exist as a command, fall back to finding the Dolt PID from `.beads/` and sending SIGTERM.
  Add try/catch — stopping a non-running server is a no-op, not an error.

- [ ] **1.2 Add `doltStatus(cwd)` to BeadsClient**
  Run `bd dolt status` and parse the output into a structured result:
  ```ts
  interface DoltStatus {
    running: boolean;
    port?: number;
    pid?: number;
  }
  ```
  Currently `ensureDoltRunning` checks for `"not running"` string — extract this into a reusable method.

- [ ] **1.3 Add `findRunningDoltServers()` static method**
  Find all running Dolt processes system-wide via `pgrep -f "dolt sql-server"` or `ps aux | grep dolt`.
  Return: `Array<{ pid: number; port: number; cwd: string }>` parsed from process args.
  This enables the `status --all` and `stop --all` commands.

- [ ] **1.4 Use dynamic port per project**
  Replace hardcoded `23307` in `pinDoltPort()` with a deterministic port derived from the project path:
  ```ts
  function projectPort(cwd: string): number {
    // Hash the absolute path to a port in the range 23000-23999
    let hash = 0;
    for (const ch of cwd) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return 23000 + (Math.abs(hash) % 1000);
  }
  ```
  Each project gets its own port. No more conflicts between projects.

### Phase 2: CLI commands

- [ ] **2.1 Add `hog beads` subcommand group**
  ```
  hog beads status          # Show Dolt server for current project
  hog beads status --all    # Show ALL running Dolt servers
  hog beads start           # Start server for current project
  hog beads stop            # Stop server for current project
  hog beads stop --all      # Stop ALL Dolt servers
  ```

- [ ] **2.2 `hog beads status` output**
  ```
  Beads server for /Users/ondrej/projects/bobo:
    Status:  running
    Port:    23142
    PID:     15439
    Uptime:  3d 2h
  ```
  With `--all`:
  ```
  Running Dolt servers:
    PID 15439  port 23142  /Users/ondrej/projects/bobo       (3d 2h)
    PID 20112  port 23587  /Users/ondrej/projects/hog        (12m)
  ```

- [ ] **2.3 `hog beads stop` implementation**
  Calls `beads.stopDolt(cwd)` for the current project.
  With `--all`: iterates `findRunningDoltServers()` and kills each.

### Phase 3: Automatic lifecycle

- [ ] **3.1 Auto-stop in pipeline watcher on completion**
  When the watcher detects pipeline completed/failed, call `beads.stopDolt(localPath)` before exiting. The server started for this pipeline is no longer needed.

- [ ] **3.2 Port conflict auto-resolution in `ensureDoltRunning`**
  When `bd dolt start` fails with a port conflict:
  1. Find the PID using the port (`lsof -ti :PORT`)
  2. Check if it belongs to a different project
  3. If different project: log a warning, use the dynamic port (which should be different)
  4. If same project but stale: kill it, retry start

- [ ] **3.3 Graceful error message on port conflict**
  Instead of showing the raw Dolt error, show:
  ```
  Port 23142 is in use by another project's Dolt server (PID 15439).
  Run `hog beads stop --all` to clean up, or `hog beads status --all` to see what's running.
  ```

### Phase 4: Tests

- [ ] **4.1 Test: `doltStatus` parses bd output correctly**
- [ ] **4.2 Test: `projectPort` returns consistent port for same path**
- [ ] **4.3 Test: `projectPort` returns different ports for different paths**
- [ ] **4.4 Test: port conflict error message is user-friendly**

---

## Acceptance Criteria

1. `hog beads status` shows the current project's Dolt server state
2. `hog beads stop` cleanly stops the server
3. `hog beads stop --all` kills all Dolt servers
4. Different projects get different ports (no more conflicts)
5. Pipeline completion auto-stops the Dolt server
6. Port conflicts show a helpful message with fix instructions
7. Users never need to know Dolt exists in the happy path

## Decision Rationale

### Why per-project ports instead of a shared server?

Dolt databases are project-local (`.beads/` directory). A shared server would need to serve multiple databases, which Dolt supports but Beads doesn't. Per-project ports with deterministic assignment (hash of path) gives isolation with zero configuration.

### Why auto-stop on pipeline completion?

The server is only needed while beads are being created/modified. Once the pipeline finishes, the server is idle but still consuming memory and a port. Auto-stop keeps the system clean. If the user starts a new pipeline, `ensureDoltRunning` restarts it.

## Risk Analysis

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| `bd dolt stop` doesn't exist | Can't stop server via bd CLI | Medium | Fall back to PID-based SIGTERM |
| Port hash collision | Two projects get same port | Very low | 1000-port range, collision = restart resolves |
| Auto-stop kills server mid-work | Active pipeline loses connection | Low | Only stop after terminal state (completed/failed) |
| `pgrep` not available on all platforms | Can't find running servers | Low | Fall back to `ps aux` parsing |

## References

- [beads.ts:138-177](../../src/engine/beads.ts) — `ensureDoltRunning` and `pinDoltPort`
- [beads.ts:104-116](../../src/engine/beads.ts) — `isInstalled` and `isInitialized`
- [conductor.ts:317-366](../../src/engine/conductor.ts) — server lifecycle in `startPipeline`
