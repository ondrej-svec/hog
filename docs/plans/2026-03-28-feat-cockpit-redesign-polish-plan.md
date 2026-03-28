---
title: "feat: cockpit redesign — from developer dashboard to pilot's cockpit"
type: plan
date: 2026-03-28
status: in_progress
confidence: high
---

# Cockpit Redesign — From Developer Dashboard to Pilot's Cockpit

**One-line summary:** Strip the cockpit to what matters, show it beautifully, hide the machinery.

## Design Philosophy

The cockpit is NOT a debugging tool for hog developers. It's the **pilot's instrument panel** —
a human watching autonomous agents build software. Every pixel should answer one of three questions:

1. **What's happening right now?** (active agent, current tool, elapsed time)
2. **How far are we?** (phase progress, estimated completion)
3. **Does anything need my attention?** (errors, decisions, rate limits)

Everything else is noise. Session IDs, bead IDs, internal conductor actions,
"preparing to spawn" messages — none of this helps the pilot fly.

## Current State (problems)

```
── Agents (4) ──
✓ test       done (14m)
✓ test       done (14m)
✓ test       done (14m)
◐ impl       Bash (uv run --with pyyaml --with feedparser --with pytest python3)  · 11m

── Log (last 10) ──
14m ago  agent: preparing:test: Preparing to spawn Test Writer
14m ago  agent: spawned:test: Spawned Test Writer agent (session: 1774707757084-1fhvt9) for bead Bobo-ct4
12m ago  parallel: agent-done:test: Parallel agent completed (2 remaining)
11m ago  phase: completed:test: Test Writer done (3/6) — The RED state is confirmed structurally...
11m ago  context: test-captured: Test context: command="cd blog/heart-of-gold && npx vitest run"...
11m ago  tdd: red-verified: RED state verified: 1 test(s) failing as expected.
11m ago  tdd: baseline-captured: Test baseline: 1 pre-existing failures in 0 files
11m ago  agent: spawned:impl: Spawned Implementer agent (session: 1774707907128-16oacn) for bead Bobo-b00
```

**Problems:**
- Session IDs (`1774707757084-1fhvt9`) — meaningless to user
- Bead IDs (`Bobo-ct4`, `Bobo-b00`) — meaningless to user
- Internal actions (`preparing`, `context:test-captured`, `baseline-captured`) — noise
- Duplicated agents list (sidebar + detail panel)
- Tool use shows raw command with flags (`uv run --with pyyaml...`) — too verbose
- Spacing inconsistent (`11m agocontext` jammed together)
- Current Phase description shows old "minimum code" prompt text
- "agent: spawned:test:" has double colon formatting
- Progress bar is tiny and hard to read
- No visual hierarchy — everything is the same weight

## Proposed Design

### Pipeline List (left sidebar when multiple pipelines)

```
 ► Content Pipeline v2        ████████░░  50% impl  11m
   Auth Refactor               ██████████  done      2h
```

Clean: name, progress bar, percentage, current phase, elapsed. No bead IDs.

### Pipeline Detail (main panel)

```
  Content Pipeline v2

  brainstorm ✓ → stories ✓ → tests ✓ → impl ◐ → redteam ○ → merge ○
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 50%

  ◐ Implementer                                    11m elapsed
    Reading test files...                          blog/heart-of-gold/
    Last: Edit config.py

  ── History ──────────────────────────────────────────────

  14m  ✓ Test Writer         3 parallel agents, 6 files, all RED
  14m  ─ stories skipped     already written by brainstorm
   0m  ✓ Brainstorm          done

  ── Decisions ─────────────────────────────────────────────

  (none pending)
```

### Design Rules

**1. The active agent gets the spotlight**

The currently running agent is the hero — big, prominent, with live activity:

```
◐ Implementer                                    11m elapsed
  Reading test files...                          blog/heart-of-gold/
  Last: Edit config.py
```

Not:
```
◐ impl  Bash (uv run --with pyyaml --with feedparser --with pytest python3)  · 11m
```

Simplify tool display:
- `Bash (npm test)` → `Running tests`
- `Bash (uv run --with pyyaml...)` → `Installing dependencies`
- `Read (config.py)` → `Reading config.py`
- `Edit (src/pipeline/scout.ts)` → `Editing scout.ts`
- `Write (src/pipeline/tracker.ts)` → `Creating tracker.ts`
- `Grep (fetchRSS)` → `Searching for fetchRSS`
- `Glob (*.test.ts)` → `Finding test files`

The tool name is for developers. The ACTION is for users.

**2. History replaces the log**

The log is a firehose of internal events. Replace with a **history** — one line per meaningful thing that happened:

```
── History ──
14m  ✓ Test Writer         3 parallel agents, 6 files, all RED
14m  ─ stories skipped     already written by brainstorm
 0m  ✓ Brainstorm          done
```

Rules for what makes it into history:
- Phase started → `◐ Test Writer started (3 parallel)`
- Phase completed → `✓ Test Writer done — 6 files, all RED`
- Phase skipped → `─ stories skipped — already written`
- Agent failed → `✗ Implementer failed — rate limit, paused`
- Decision needed → `? Redteam failed 3x — retry or skip?`
- Pipeline completed → `✓ Pipeline complete — 6/6 phases`

What does NOT go in history:
- "Preparing to spawn" (internal)
- "Bead count corrected" (self-healing noise)
- "Session ID: ..." (developer debugging)
- "RED state verified" (TDD internals — show only if it FAILS)
- "Test baseline captured" (internal)
- "Context captured" (internal)

**3. Completed agents disappear**

Once an agent is done, it moves to history. The agents section only shows ACTIVE agents:

```
── Active ──
◐ Implementer    Editing scout.ts    11m
```

Not:
```
── Agents (4) ──
✓ test       done (14m)
✓ test       done (14m)
✓ test       done (14m)
◐ impl       Bash (uv run --with...) · 11m
```

Three "done" lines add zero information. The history already says tests passed.

**4. Progress bar is real**

```
brainstorm ✓ → stories ✓ → tests ✓ → impl ◐ → redteam ○ → merge ○
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 50%
```

Full-width, phase names above, bar below. Not the tiny orange rectangle.

**5. Errors are prominent, not buried**

When something fails, it should be impossible to miss:

```
  ✗ BLOCKED — Implementer failed 3 times

    "Rate limit exceeded — resets 7pm (Europe/Prague)"

    [R]etry  [S]kip  [C]ancel
```

Not buried in a log line that scrolls off screen.

**6. Tool display is human-readable**

Map raw tool names to human actions:

| Raw | Display |
|-----|---------|
| `Read (src/pipeline/scout.ts)` | `Reading scout.ts` |
| `Edit (src/pipeline/scout.ts)` | `Editing scout.ts` |
| `Write (src/pipeline/tracker.ts)` | `Creating tracker.ts` |
| `Bash (npm test)` | `Running tests` |
| `Bash (npm install feedparser)` | `Installing feedparser` |
| `Bash (git commit...)` | `Committing changes` |
| `Bash (cd ... && pytest)` | `Running pytest` |
| `Grep (fetchRSS)` | `Searching for "fetchRSS"` |
| `Glob (*.test.ts)` | `Finding test files` |
| `TodoWrite` | `Planning next steps` |

Show only the last path segment for files. Nobody needs the full path in a status display.

**7. Phase descriptions are useful, not prompt excerpts**

Current:
```
── Current Phase ──
◐ imp  Writing minimum code to make tests pass (GREEN) — can only see failing tests
```

Better — short, action-oriented:
```
◐ Implementer    Making tests pass    11m
```

The full description is in the prompt. The cockpit shows what's happening, not the agent's instructions.

### Keyboard Shortcuts

Keep what works, add what's missing:

| Key | Action |
|-----|--------|
| `P` | New pipeline |
| `j/k` | Navigate pipelines |
| `Enter` | Expand/collapse detail |
| `x` | Pause/resume |
| `d` | Cancel pipeline |
| `l` | Full log (opens in tmux/less) |
| `?` | Help |
| `q` | Quit |
| `1-9` | Answer decision (when blocked) |
| `r` | Retry failed phase |

Remove the brainstorm `Z` key — brainstorm happens before the cockpit, not inside it.

## Implementation Tasks

- [ ] **P.1 Rewrite pipeline detail component**
  Single active agent spotlight, history instead of log, clean progress bar.

- [ ] **P.2 Add tool display humanizer**
  Map raw tool names to human-readable actions. `humanizeToolUse("Read", "src/pipeline/scout.ts")` → `"Reading scout.ts"`

- [ ] **P.3 Filter log to history events only**
  Only show phase transitions, completions, failures, decisions. Filter out internal conductor events.

- [ ] **P.4 Active agents only in agents section**
  Completed agents move to history. No more "done (14m)" lines.

- [ ] **P.5 Update phase descriptions**
  Short action-oriented labels instead of prompt excerpts.

- [ ] **P.6 Error/decision prominence**
  Blocked state gets full-screen treatment with action keys.

- [ ] **P.7 Clean up spacing and formatting**
  Fix timestamp spacing, remove double colons, consistent alignment.
