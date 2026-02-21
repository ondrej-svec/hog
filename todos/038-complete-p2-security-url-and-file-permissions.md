---
status: complete
priority: p2
issue_id: "038"
tags: [code-review, security, permissions, url-validation]
dependencies: []
---

# Security: openInBrowser missing URL scheme check + saveConfig/saveSyncState missing 0o600 permissions

## Problem Statement

Two independent security issues with clear one-line fixes:

1. `openInBrowser` passes URLs from GitHub API responses to the macOS `open` command without
   validating the URL scheme. A malicious `issue.url` value could trigger unintended applications.
2. `saveConfig` and `saveSyncState` write files without `0o600` permissions, potentially
   leaving them world-readable on systems with a permissive `umask`.

## Findings

**A — openInBrowser without URL scheme validation (dashboard.tsx lines 337–343):**
```typescript
function openInBrowser(url: string): void {
  try {
    execFileSync("open", [url], { stdio: "ignore" });
  } catch { }
}
```
Called with `issue.url` (from GitHub API) and `issue.slackThreadUrl` (extracted from issue body).
On macOS, `open` with a `file://` or custom URI scheme can launch unintended applications.
The Slack URL is validated by regex to `https://*.slack.com`, but `issue.url` is not validated.

**B — saveConfig missing 0o600 (config.ts line 241):**
```typescript
export function saveConfig(data: ConfigData): void {
  // NOTE: No { mode: 0o600 } here
  writeFileSync(CONFIG_FILE, `${JSON.stringify({ ...existing, ...data }, null, 2)}\n`);
}
```
`saveFullConfig` and `saveAuth` both correctly use `{ mode: 0o600 }`. `saveConfig` (used by
`task use-project`) does not, leaving the file potentially readable by other users.

**C — saveSyncState missing 0o600 (sync-state.ts line 33):**
```typescript
export function saveSyncState(state: SyncState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  // No { mode: 0o600 }
}
```
`sync-state.json` contains GitHub issue numbers mapped to TickTick task/project IDs.

## Proposed Solutions

### Fix A: Add https:// scheme guard (one-line fix)

```typescript
function openInBrowser(url: string): void {
  // Only allow https:// and http:// to prevent custom URI scheme abuse
  if (!url.startsWith("https://") && !url.startsWith("http://")) return;
  try {
    execFileSync("open", [url], { stdio: "ignore" });
  } catch { }
}
```

### Fix B + C: Add mode to file writes (two one-line fixes)

```typescript
// saveConfig in config.ts
writeFileSync(CONFIG_FILE, `${JSON.stringify(...)}`, { mode: 0o600 });

// saveSyncState in sync-state.ts
writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
```

**Effort:** Very small (3 line changes total)
**Risk:** Zero — additive security improvements

## Acceptance Criteria

- [ ] `openInBrowser` returns early for non-http/https URLs
- [ ] `saveConfig` writes with `{ mode: 0o600 }`
- [ ] `saveSyncState` writes with `{ mode: 0o600 }`
- [ ] `npm run ci` passes

## Work Log

- 2026-02-21: Identified by Security Sentinel (HOG-02 P2, HOG-06 P3, HOG-09 P3).
