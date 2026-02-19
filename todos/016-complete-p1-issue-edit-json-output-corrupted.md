---
status: pending
priority: p1
issue_id: "016"
tags: [code-review, cli, agent-native, dx]
dependencies: []
---

# hog issue edit --json output corrupted by gh stdio: "inherit"

## Problem Statement

`hog issue edit <ref> [--title --body ...]` uses `execFileSync("gh", ghArgs, { stdio: "inherit" })` which writes `gh`'s output directly to the process's inherited stdout. After this, the command calls `jsonOut(...)` to emit structured JSON. When `--json` is passed, an agent or script receives `gh`'s raw output (the updated issue URL) mixed in with the structured JSON on stdout, making the output unparseable:

```
# Agent runs:
hog issue edit myrepo/42 --title "Fix login" --json

# Gets on stdout (not parseable):
https://github.com/myorg/myrepo/issues/42
{"ok":true,"data":{"issue":42,"changes":["title"]}}
```

This breaks any pipeline doing `hog issue edit ... --json | jq`.

## Findings

- `src/cli.ts:1071`: `execFileSync("gh", ghArgs, { stdio: "inherit" })` — stdout of `gh` flows to process stdout
- `src/cli.ts:1073-1076`: `jsonOut(...)` emits additional JSON after `gh`'s output
- All other new `issue` subcommands (`assign`, `unassign`, `comment`, `label`) correctly capture `gh` output by using `execFileAsync` without stdio inherit
- The existing `issue create` command has the same problem (also `stdio: "inherit"`)

## Proposed Solutions

### Option 1: Use execFileAsync and capture output in JSON mode

```typescript
if (useJson()) {
  await execFileAsync("gh", ghArgs);  // capture, don't inherit
  jsonOut({ ok: true, data: { issue: ref.issueNumber, changes } });
} else {
  execFileSync("gh", ghArgs, { stdio: "inherit" });
}
```

**Pros:** Clean JSON output in --json mode, human-readable output in normal mode

**Cons:** Two execution paths to maintain

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Always use execFileAsync, print captured output in human mode

```typescript
const result = await execFileAsync("gh", ghArgs);
if (useJson()) {
  jsonOut({ ok: true, data: { issue: ref.issueNumber, changes } });
} else {
  if (result.stdout) process.stdout.write(result.stdout);
  printSuccess(`Issue #${ref.issueNumber} updated: ${changes.join(", ")}`);
}
```

**Pros:** Single execution path, consistent with all other async issue commands

**Effort:** 45 minutes

**Risk:** Low

## Technical Details

- File: `src/cli.ts` — `issueCommand` `edit` action (around line 1060-1080)
- Related: `issue create` at line 830 has the same `stdio: "inherit"` issue

## Acceptance Criteria

- [ ] `hog issue edit <ref> --title "X" --json` produces valid JSON on stdout
- [ ] `hog issue edit <ref> --title "X" --json | jq '.ok'` returns `true`
- [ ] Human mode (no --json) still shows readable output
- [ ] `npm run test` passes

## Work Log

- 2026-02-19: Identified by agent-native-reviewer during code review.

## Resources

- File: `src/cli.ts`
- Pattern reference: `hog issue comment` action in same file (uses execFileAsync correctly)
