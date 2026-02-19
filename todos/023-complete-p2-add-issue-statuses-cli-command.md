---
status: pending
priority: p2
issue_id: "023"
tags: [code-review, cli, agent-native, dx]
dependencies: []
---

# Add hog issue statuses <repo> command for agent discoverability

## Problem Statement

`hog issue move <ref> <status>` requires knowing the exact status name upfront. There is no CLI command to discover what status names are valid for a repo. When an agent provides an invalid status, it gets an error message (as plain text on stderr) listing the valid options. This forces agents to either hard-code status names or parse error output to discover them.

The `fetchProjectStatusOptions` function in `github.ts` already implements this fetch — it just needs to be exposed as a CLI command.

## Findings

- `src/github.ts`: `fetchProjectStatusOptions(repo, projectNumber, statusFieldId)` exists and returns `StatusOption[]`
- `src/cli.ts`: No command exposes this data
- `hog board --json` includes status info in the full board data, but requires fetching all issues across all repos just to get status option names
- This is the most commonly needed discovery step before calling `hog issue move`

## Proposed Solutions

### Option 1: Add hog issue statuses <repo>

```
hog issue statuses <owner/repo-shortname>
```

Output (human):
```
Available statuses for myrepo:
  Todo
  In Progress
  In Review
  Done
```

Output (--json):
```json
{"ok":true,"data":{"repo":"myrepo","statuses":["Todo","In Progress","In Review","Done"]}}
```

Look up repo config from hog config using the short name.

**Effort:** 1-2 hours
**Risk:** Low

## Acceptance Criteria

- [ ] `hog issue statuses <repo>` prints available status names
- [ ] `hog issue statuses <repo> --json` prints structured JSON
- [ ] Unconfigured repo prints actionable error + exit 1
- [ ] `npm run check` and `npm run test` pass

## Work Log

- 2026-02-19: Identified by agent-native-reviewer during code review.
