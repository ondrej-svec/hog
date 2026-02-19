---
status: pending
priority: p1
issue_id: "017"
tags: [code-review, cli, agent-native, dx]
dependencies: []
---

# hog issue create missing --json output path (silently emits nothing structured)

## Problem Statement

`hog issue create <text>` (with `--json`) writes diagnostic fields to `console.error` (not captured by `--json` handling) and then delegates to `execFileSync("gh", args, { stdio: "inherit" })`. The command exits without ever calling `jsonOut(...)`. When an agent passes `--json`, it receives **no JSON output** — the stdout is whatever `gh issue create` printed (the new issue URL as a string), not a structured `{ ok, data }` envelope. This breaks automation pipelines that need the created issue's number or URL.

```bash
# Agent runs:
hog issue create "fix login bug" --repo myrepo/myapp --json

# Stdout:
https://github.com/myorg/myapp/issues/43   <- raw gh output, not JSON

# Stderr:
Title:    Fix login bug
Repo:     myrepo/myapp
# etc.
```

## Findings

- `src/cli.ts:813-817`: `console.error` used for `[info]` diagnostic lines (always goes to stderr, ignores `--json`)
- `src/cli.ts:830`: `execFileSync("gh", args, { stdio: "inherit" })` — `gh` prints the created issue URL to stdout
- No `jsonOut(...)` call exists anywhere in the `issue create` action
- `hog issue create` is used by both TUI background flow (NL create) and CLI agents — making `--json` unreliable breaks agent automation entirely

## Proposed Solutions

### Option 1: Capture gh output and extract issue URL for JSON response

```typescript
const output = execFileSync("gh", args, { encoding: "utf-8", stdio: ["inherit", "pipe", "pipe"] });
const url = output.trim();
const match = url.match(/\/issues\/(\d+)$/);
const issueNumber = match ? Number.parseInt(match[1], 10) : null;

if (useJson()) {
  jsonOut({ ok: true, data: { url, issueNumber, repo: repoName, title: parsed.title, labels: parsed.labels } });
} else {
  process.stdout.write(url + "\n");
}
```

**Pros:** Clean JSON with created issue number, parseable by agents

**Cons:** Parses URL string (fragile if gh changes output format)

**Effort:** 1 hour

**Risk:** Low-medium (depends on gh output format stability)

---

### Option 2: Use execFileAsync with pipe

Same approach but async:

```typescript
const { stdout } = await execFileAsync("gh", args);
const url = stdout.trim();
// ... same extraction
```

**Pros:** Consistent async style with other issue commands

**Effort:** 1 hour

**Risk:** Low-medium

## Technical Details

- File: `src/cli.ts` — `issueCommand create` action (around line 779-837)
- `gh issue create` exits 0 on success and prints the created issue URL to stdout
- The `--json` flag on `gh issue create` returns a different JSON format — better to not use it and instead extract from the URL

## Acceptance Criteria

- [ ] `hog issue create "fix bug" --repo myrepo --json` produces `{ ok: true, data: { url, issueNumber, ... } }`
- [ ] Human mode still prints the URL to stdout (or passes through gh output)
- [ ] `npm run test` passes

## Work Log

- 2026-02-19: Identified by agent-native-reviewer and TypeScript reviewer during code review.

## Resources

- File: `src/cli.ts`
- Reference: `gh issue create` output format (prints URL on success)
