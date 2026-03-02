---
status: pending
priority: p1
issue_id: "045"
tags: [code-review, security]
dependencies: []
---

# Path traversal via unsanitized phase parameter in buildResultFilePath

## Problem Statement

`buildResultFilePath` in `src/board/spawn-agent.ts` does not sanitize the `phase` parameter before using it to construct a file path. A config value like `../../.ssh/foo` escapes `AGENT_RESULTS_DIR` via path traversal. Additionally, the `replace("/", "-")` call on `repoFullName` is missing the `g` flag, so only the first slash is replaced.

## Findings

- **File:** `src/board/spawn-agent.ts` lines 112-118
- **Evidence:**
  ```typescript
  export function buildResultFilePath(repoFullName: string, issueNumber: number, phase: string): string {
    const slug = repoFullName.replace("/", "-"); // missing g flag — only first slash replaced
    return join(AGENT_RESULTS_DIR, `${slug}-${issueNumber}-${phase}.json`);
  }
  ```
- **Impact:** Arbitrary file write outside the intended `AGENT_RESULTS_DIR` directory via a crafted workflow phase config value. An attacker or misconfigured workflow with `phase: "../../.ssh/authorized_keys"` would write agent result JSON to `~/.ssh/authorized_keys`, potentially overwriting SSH authorization data.

## Proposed Solutions

### Option A: Sanitize phase and fix slug (Recommended)

Replace all non-alphanumeric characters in `phase` with underscores and apply the global flag to the `repoFullName` slug replacement.

```typescript
export function buildResultFilePath(repoFullName: string, issueNumber: number, phase: string): string {
  const safePhase = phase.replace(/[^a-zA-Z0-9_-]/g, "_");
  const slug = repoFullName.replace(/\//g, "-");
  return join(AGENT_RESULTS_DIR, `${slug}-${issueNumber}-${safePhase}.json`);
}
```

- **Effort:** Small
- **Risk:** Low

### Option B: Validate phase against known allowed values

If workflow phase names are an enumerable set, validate `phase` against an allowlist and throw on unknown values. More defensive but requires coupling to workflow schema.

- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [ ] `phase` values containing `/`, `..`, or other special characters are sanitized before path construction
- [ ] `repoFullName` values containing multiple slashes (e.g. `org/repo/sub`) are fully slugified
- [ ] The resulting file path is always within `AGENT_RESULTS_DIR` regardless of input
- [ ] Existing result files for well-formed phase names are unaffected

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
