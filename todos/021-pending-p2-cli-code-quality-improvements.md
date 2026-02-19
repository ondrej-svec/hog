---
status: pending
priority: p2
issue_id: "021"
tags: [code-review, quality, cli, dx]
dependencies: []
---

# CLI issue commands: extract duplicate parseIssueRef block and fix dryRun type

## Problem Statement

Two related code quality issues in the new `hog issue` subcommands in `src/cli.ts`:

**Issue A — 7x repeated parseIssueRef try/catch block:**
Each of the 7 new `issueCommand` actions contains the identical 8-line pattern:
```typescript
const { parseIssueRef } = await import("./pick.js");
let ref: Awaited<ReturnType<typeof import("./pick.js").parseIssueRef>>;
try {
  ref = parseIssueRef(issueRef, cfg);
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
```
This is ~56 lines of identical code across the file.

**Issue B — `dryRun?: boolean` inconsistency:**
The new option interfaces use `dryRun?: boolean` but the established pattern for flag options in this codebase is `?: true` (literal true, not boolean). See `GlobalOptions`, `InitOptions`, `BoardOptions` etc.

## Findings

- `src/cli.ts:845-852, 882-889, 926-933, 960-967, 991-998, 1034-1041, 1088-1095`: identical parseIssueRef blocks
- `src/cli.ts:738-776`: Six option interfaces with `dryRun?: boolean` — should be `dryRun?: true`
- `src/cli.ts:45-48` (GlobalOptions): uses `json?: true; human?: true` — the established pattern
- The `Awaited<ReturnType<typeof import("./pick.js").parseIssueRef>>` type is verbose and has no precedent elsewhere in the file

## Proposed Solutions

### Fix A: Extract helper function

```typescript
// Near top of issueCommand section
const { parseIssueRef } = await import("./pick.js");
type IssueRef = ReturnType<typeof parseIssueRef>;

function resolveRef(issueRef: string, cfg: FullConfig): IssueRef {
  try {
    return parseIssueRef(issueRef, cfg);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
```

**Effort:** 30 minutes
**Risk:** Low

### Fix B: Change `boolean` to `true` in option interfaces

Replace all `dryRun?: boolean` with `dryRun?: true` in IssueCreateOptions, IssueShowOptions, IssueMoveOptions, IssueAssignOptions, IssueUnassignOptions, IssueCommentOptions, IssueEditOptions, IssueLabelOptions.

**Effort:** 5 minutes
**Risk:** None

## Acceptance Criteria

- [ ] Single `resolveRef` helper used by all 7 issue subcommands
- [ ] All `dryRun?: boolean` changed to `dryRun?: true` in option interfaces
- [ ] `npm run check` passes (type check + lint)
- [ ] `npm run test` passes (283 tests)

## Work Log

- 2026-02-19: Identified by TypeScript reviewer, simplicity reviewer, and architecture strategist.
