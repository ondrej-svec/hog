# 025: Include slackThreadUrl in JSON Output (P3 - Nice-to-Have)

**Status:** Pending
**Priority:** P3 (Nice-to-Have)
**Issue ID:** 025
**Tags:** code-review, agent-native, cli
**Created:** 2026-02-19

---

## Problem Statement

The `GitHubIssue` type includes a `slackThreadUrl` field (populated when GitHub issues are linked to Slack threads). However, this field is **NOT** included in:

- `hog issue show --json` output
- `hog board --json` output
- Any other JSON-serialized issue output

This breaks agent-native parity: external scripts and AI agents cannot retrieve or verify the Slack thread URL associated with an issue. They must either:
1. Re-query GitHub (inefficient)
2. Assume the field doesn't exist (incomplete data model)
3. Manually extract it (fragile, out-of-band)

---

## Findings

### 1. Field Exists but Not Exported
- **Type definition:** `src/types.ts` — `GitHubIssue` interface includes `slackThreadUrl?: string`
- **Data population:** `src/github.ts` — `slackThreadUrl` is populated from GitHub API or stored state
- **Current output:** `src/board/format-static.ts` — JSON formatting for board/issue data
- **Gap:** `slackThreadUrl` is intentionally omitted from JSON serialization (no explicit reason documented)

### 2. Impact on Agent-Native Operations
- **Agents cannot verify mutation results:** After creating an issue or linking to Slack, agents need to confirm the slackThreadUrl was set
- **Agents cannot batch operations:** Filtering/acting on issues by Slack linkage status requires the URL
- **Incomplete audit trail:** Logs don't record which issues are cross-linked to Slack threads

### 3. Current Serialization Paths
- **`hog issue show --json`:**
  - Located in `src/cli.ts` — calls `format-static.ts#formatIssue()`
  - Includes: id, number, title, body, status, url, labels, assignee, createdAt, updatedAt, closedAt
  - Excludes: slackThreadUrl

- **`hog board --json`:**
  - Located in `src/board/format-static.ts` — calls `formatBoardAsJson()`
  - Flattens repos → statuses → issues → rows
  - Each issue rendered via `formatIssueRow()` or similar
  - Excludes: slackThreadUrl

---

## Proposed Solutions

### Option A: Add to All JSON Output (Recommended for P3)
1. Update `src/board/format-static.ts#formatIssue()` to include `slackThreadUrl?: string | null`
2. Update `src/board/format-static.ts#formatBoardAsJson()` to propagate `slackThreadUrl` in row objects
3. Update `src/cli.ts` — `hog issue show --json` to use the updated formatter
4. Add tests in `*.test.ts` files to verify field is present in JSON
5. Estimated effort: 1–2 hours

### Option B: Add with Schema Versioning
1. Introduce JSON schema versioning (add `"schema": "v2"` or similar to output root)
2. Update formatters to conditionally include new fields based on version parameter
3. Document v1 vs v2 schema in README or CLI help
4. Allows graceful evolution without breaking existing consumers
5. Estimated effort: 2–3 hours; higher complexity but more future-proof

---

## Acceptance Criteria

- [ ] `slackThreadUrl` included in `hog issue show --json` output when present
- [ ] `slackThreadUrl` included in `hog board --json` output when present
- [ ] Field is `null` or absent if no URL is available (consistent with other optional fields)
- [ ] Tests verify the field is present in JSON for issues with Slack URLs
- [ ] Tests verify the field is absent/null for issues without Slack URLs
- [ ] Documentation updated (if applicable) to list field in JSON schema
- [ ] All existing tests pass
- [ ] Code review approved

---

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Initial findings and options. Awaiting prioritization. |

---

## Related Issues

- See also: #027 (action-log persistence) — related to agent-native audit trail

## References

- `src/types.ts` — GitHubIssue interface definition
- `src/github.ts` — slackThreadUrl population logic
- `src/board/format-static.ts` — JSON formatting functions
- `src/cli.ts` — `hog issue show` command definition
