---
status: pending
priority: p1
issue_id: "044"
tags: [code-review, security]
dependencies: []
---

# AppleScript injection via unsanitized issue title in sendOsNotification

## Problem Statement

`sendOsNotification` in `src/notify.ts` only escapes double quotes in title/body before embedding in an AppleScript string. It does NOT escape backslashes or AppleScript continuation characters. A crafted GitHub issue title (sourced from the nudge system or workflow completion) can execute arbitrary shell commands on macOS via `do shell script`.

## Findings

- **File:** `src/notify.ts` lines 20-23
- **Evidence:**
  ```typescript
  const safeTitle = title.replace(/"/g, '\\"');
  const safeBody = body.replace(/"/g, '\\"');
  spawnSync("osascript", ["-e", `display notification "${safeBody}" with title "${safeTitle}"`]);
  ```
- **Impact:** Remote code execution on macOS via crafted GitHub issue titles. An issue titled `test" & do shell script "id" & "` would cause `osascript` to execute the injected shell command with the privileges of the running user.

## Proposed Solutions

### Option A: Multi-statement osascript with JSON.stringify (Recommended)

Pass title and body as separate `-e` statements using `JSON.stringify` to produce safe AppleScript string literals, eliminating all string interpolation of user-controlled values.

```typescript
spawnSync("osascript", [
  "-e", `set theBody to ${JSON.stringify(body)}`,
  "-e", `set theTitle to ${JSON.stringify(title)}`,
  "-e", `display notification theBody with title theTitle`,
]);
```

- **Effort:** Small
- **Risk:** Low

### Option B: Switch to async spawn with detached + unref (also fixes P1 finding 046)

Combines the injection fix with the event-loop blocking fix. Use `spawn` with `detached: true` and `unref()` so the TUI is not frozen, while also passing arguments safely via `JSON.stringify`.

```typescript
import { spawn } from "node:child_process";

const child = spawn("osascript", [
  "-e", `set theBody to ${JSON.stringify(body)}`,
  "-e", `set theTitle to ${JSON.stringify(title)}`,
  "-e", `display notification theBody with title theTitle`,
], { stdio: "ignore", detached: true });
child.unref();
```

- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [ ] No string interpolation of user-controlled values into an AppleScript string literal
- [ ] Notification still works correctly with issue titles containing quotes, backslashes, and special characters
- [ ] Adversarial title `test" & do shell script "id" & "` triggers a notification safely without executing shell code
- [ ] Existing notify behavior is preserved on macOS and Linux

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
