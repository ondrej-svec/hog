---
status: pending
priority: p2
issue_id: "020"
tags: [code-review, cli, agent-native, dx]
dependencies: []
---

# CLI issue commands use console.error for errors — bypasses --json flag

## Problem Statement

When `hog issue move/assign/unassign/comment/label` encounters an error (invalid ref, unconfigured repo, invalid status), it writes to `console.error(...)` and exits. When `--json` is passed, an agent receives the error on stderr as plain text, not as JSON on stdout. This forces agents to monitor both stdout and stderr and parse human-readable error strings.

```bash
hog issue move notinconfig/repo#42 "In Progress" --json
# stdout: (nothing)
# stderr: Error: Repo "notinconfig/repo" is not configured in hog...
# exit: 1
```

Expected agent-friendly behavior:
```bash
# stdout: {"ok":false,"error":"Repo not configured","data":{"repo":"notinconfig/repo"}}
# exit: 1
```

## Findings

- `src/cli.ts:850`: `console.error(\`Error: ${err...}\`)` — all issue commands
- `src/cli.ts:893-901`: `console.error(\`Error: Invalid status...\`)` — move command
- `src/cli.ts:936`: same pattern — assign command
- Pattern repeats for all 7 new issue subcommands
- The existing `task` commands have the same pattern — this is pre-existing, but the new `issue` commands offer an opportunity to establish a better pattern

## Proposed Solutions

### Option 1: Add a shared errorOut helper

```typescript
function errorOut(message: string, data?: Record<string, unknown>): never {
  if (useJson()) {
    jsonOut({ ok: false, error: message, ...(data ? { data } : {}) });
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}
```

Replace all `console.error + process.exit(1)` in issue commands with `errorOut(message, optionalData)`.

For invalid status, pass the valid options:
```typescript
errorOut(`Invalid status "${status}". Valid: ${valid}`, { validStatuses: options.map(o => o.name) });
```

**Pros:** Consistent, agents can parse errors structurally, valid status list accessible without parsing
**Effort:** 1-2 hours
**Risk:** Low

### Option 2: Only fix the most impactful error path (invalid status)

Just make the `move` command emit JSON-formatted error with valid statuses list, since that's the most commonly needed discovery mechanism for agents.

**Effort:** 20 minutes
**Risk:** None

## Acceptance Criteria

- [ ] `hog issue move <ref> <bad-status> --json` emits `{"ok":false,"error":"...","data":{"validStatuses":[...]}}` to stdout
- [ ] All issue subcommand errors emit JSON to stdout when `--json` is active
- [ ] `npm run check` passes

## Work Log

- 2026-02-19: Identified by agent-native-reviewer and architecture strategist during code review.
