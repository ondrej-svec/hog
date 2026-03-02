---
status: pending
priority: p1
issue_id: "046"
tags: [code-review, performance]
dependencies: []
---

# spawnSync in sendOsNotification blocks the Ink TUI event loop

## Problem Statement

`sendOsNotification` in `src/notify.ts` uses `spawnSync` to invoke `osascript`, which blocks the Node.js event loop for the full duration of the call. On macOS, `osascript` takes 100-500ms to display a notification. During that window the Ink TUI is completely frozen — no input is processed, no re-renders occur. Multiple agents finishing near-simultaneously cause cumulative freezes of up to 1.5s.

## Findings

- **File:** `src/notify.ts` lines 16-26
- **Evidence:**
  ```typescript
  spawnSync("osascript", ["-e", `display notification ...`]); // BLOCKS event loop
  ```
- **Impact:** Hard UI freeze per agent completion event. With concurrent agents, freezes accumulate. Users see the board lock up when workflow phases complete, degrading the interactive experience of the live TUI and potentially causing missed keystrokes.

## Proposed Solutions

### Option A: Switch to async spawn with detached + unref (Recommended)

Replace `spawnSync` with `spawn` using `detached: true` so the child process runs independently, and call `unref()` so Node.js does not wait for it. The notification is fire-and-forget; no return value from `osascript` is needed.

```typescript
import { spawn } from "node:child_process";

const child = spawn("osascript", [...args], { stdio: "ignore", detached: true });
child.unref();
```

- **Effort:** Small
- **Risk:** Low

Note: This change can be combined with finding 044 (AppleScript injection fix) in a single commit, as both touch the same lines in `src/notify.ts`.

### Option B: Use setImmediate / queue notifications

Defer notification delivery by enqueuing calls through `setImmediate` or a microtask. This keeps `spawnSync` but defers the block to an idle moment. Less clean than Option A and still ultimately blocks.

- **Effort:** Small
- **Risk:** Medium

## Acceptance Criteria

- [ ] `spawnSync` is replaced with `spawn` using `detached: true` and `child.unref()`
- [ ] The Ink TUI remains fully responsive (input, re-renders) during notification delivery
- [ ] Notifications still appear on macOS and produce no errors on Linux
- [ ] No observable regression in notification timing for normal single-agent completions

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
