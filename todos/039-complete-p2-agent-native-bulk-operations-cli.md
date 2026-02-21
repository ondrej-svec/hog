---
status: pending
priority: p2
issue_id: "039"
tags: [code-review, agent-native, cli, bulk-actions]
dependencies: []
---

# Bulk issue operations (assign/unassign/move) have no CLI equivalent

## Problem Statement

The TUI supports bulk operations via multi-select mode:
- Bulk assign multiple issues to self
- Bulk unassign multiple issues from self
- Bulk status change across multiple issues

These are the only TUI capabilities with no CLI equivalent. An agent that needs to batch-process
issues (e.g., "assign all unassigned In Progress issues to me") must loop individual `hog issue assign`
calls with no atomicity or summary result.

The bulk operation handlers already exist in `use-actions.ts`
(`handleBulkAssign`, `handleBulkUnassign`, `handleBulkStatusChange`). The wiring is TUI-only.

## Findings

TUI capability matrix gap:
```
hog issue assign <ref>        → EXISTS
hog issue unassign <ref>      → EXISTS
hog issue move <ref> <status> → EXISTS
hog issue bulk-assign <refs...>       → MISSING
hog issue bulk-unassign <refs...>     → MISSING
hog issue bulk-move <status> <refs...> → MISSING
```

Also missing from the CLI (separate but related):
- `--body` and `--label` flags on `hog issue create` (forces NL parser even for structured input)
- `activity` in `hog board --json` (tracked in 031)
- `--dry-run` not respecting `--json` flag (see below)

**`--dry-run` ignores `--json` (cli.ts lines 913–917):**
```typescript
if (opts.dryRun) {
  console.log(`[dry-run] Would move ${rc.shortName}#${ref.issueNumber} → "${target.name}"`);
  return;  // exits before jsonOut() — always prints human text regardless of --json flag
}
```
Same pattern in assign, unassign, comment, edit, label commands.

**`parsePriority` uses console.error + process.exit instead of errorOut (cli.ts:122):**
```typescript
console.error(`Invalid priority: ${value}. Use: none, low, medium, high`);
process.exit(1);  // not machine-readable, not JSON
```
`errorOut()` is defined on line 102 for this exact purpose but not used here.

## Proposed Solutions

### Option 1: Add bulk commands to the `issue` command group

```
hog issue bulk-assign <ref1> <ref2> ...
hog issue bulk-unassign <ref1> <ref2> ...
hog issue bulk-move <status> <ref1> <ref2> ...
```

Each accepts multiple `<ref>` arguments (format: `owner/repo#123` or `#123` with default repo).
Returns `{ ok: true, results: [{ ref, success, error }] }` in JSON mode.

### Fix --dry-run to respect --json

```typescript
if (opts.dryRun) {
  if (useJson()) {
    jsonOut({ ok: true, dryRun: true, would: { action: "move", issue: ref, status: target.name } });
  } else {
    console.log(`[dry-run] Would move ...`);
  }
  return;
}
```

### Fix parsePriority + resolveProjectId to use errorOut

```typescript
function parsePriority(value: string): Priority {
  const p = PRIORITY_MAP[value.toLowerCase()];
  if (p === undefined) {
    errorOut(`Invalid priority: "${value}". Valid values: none, low, medium, high`);
  }
  return p;
}
```

**Effort:** Medium for bulk commands, Very small for dry-run and parsePriority fixes
**Risk:** Low — additive CLI additions

## Acceptance Criteria

- [ ] `hog issue bulk-assign` works and has `--json` output
- [ ] `hog issue bulk-unassign` works and has `--json` output
- [ ] `hog issue bulk-move <status>` works and has `--json` output
- [ ] `--dry-run` respects `--json` flag across all issue commands
- [ ] `parsePriority` and `resolveProjectId` use `errorOut()` instead of `console.error`+exit
- [ ] `npm run ci` passes

## Work Log

- 2026-02-21: Identified by Agent-Native reviewer (P1 #2, P2 #3, P2 #6), Pattern reviewer (P3-1).
