---
status: pending
priority: p3
issue_id: "041"
tags: [code-review, security, oauth, ansi]
dependencies: []
---

# Security P3: static OAuth state, fixed redirect port, ANSI injection in activity feed, LLM validation

## Problem Statement

Four lower-priority security improvements that are non-blocking but worth addressing
for spec compliance and defense-in-depth.

## Findings

**A — Static OAuth `state` parameter (auth.ts line 12):**
```typescript
state: "hog"  // static — no CSRF protection
```
The OAuth `state` parameter is designed to prevent CSRF. The static string `"hog"` provides
no protection. Any redirect to `http://localhost:8080?code=xxx&state=hog` could complete
the flow. In a personal tool this is low risk but non-conformant.

**B — Fixed OAuth redirect port 8080 (auth.ts lines 5, 40):**
```typescript
const REDIRECT_URI = "http://localhost:8080";
server.listen(8080, () => { });
```
If port 8080 is in use, `hog init` fails cryptically. An attacker controlling port 8080
before `hog init` could intercept the auth code. Ephemeral port (`0`) is safer and
more reliable on systems running many services.

**C — ANSI escape sequences in GitHub activity feed (fetch.ts):**
GitHub event data (actor logins, issue titles, commit messages) flows into the activity
feed display strings without sanitization. Terminal escape sequences in GitHub content
could corrupt the TUI display or, on some terminals, trigger actions.

**D — LLM response validation in ai.ts is incomplete (lines 111–112):**
```typescript
const escapedText = userText.replace(/<\/input>/gi, "< /input>");
```
Only `</input>` is escaped. A label named `</valid_labels><injected>` would break the
prompt structure. More importantly, LLM-returned labels are not validated against the
repo's actual label list before being passed to `gh issue create`.

## Proposed Solutions

**Fix A: Random OAuth state**
```typescript
import { randomBytes } from "node:crypto";
const oauthState = randomBytes(16).toString("hex");
// Store it, verify on callback
const params = new URLSearchParams({ ..., state: oauthState });
```

**Fix B: Ephemeral port**
```typescript
server.listen(0, () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 8080;
  const redirectUri = `http://localhost:${port}`;
  // proceed with redirectUri
});
```

**Fix C: Strip ANSI from activity strings**
```typescript
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
// Apply to ev.actor, ev.title, ev.body before building summary
```

**Fix D: Validate LLM labels against repo labels**
```typescript
// After LLM response, validate labels
const validLabels = await fetchRepoLabelsAsync(repoName);
const safeLabels = parsed.labels.filter(l => validLabels.includes(l));
```

**Effort:** Small (A, C, D) / Medium (B requires passing port around)
**Risk:** Low

## Acceptance Criteria

- [ ] OAuth `state` uses `crypto.randomBytes` (or equivalent) and is verified on callback
- [ ] LLM-returned labels validated against repo label list before use
- [ ] ANSI escape sequences stripped from GitHub activity strings
- [ ] `npm run ci` passes

## Work Log

- 2026-02-21: Identified by Security Sentinel (HOG-04, HOG-05, HOG-03, HOG-08).
