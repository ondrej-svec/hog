---
status: pending
priority: p3
issue_id: "065"
tags: [code-review, agent-native]
dependencies: []
---

# CLI Parity Gaps: 4 Key Features Are TUI-Only

## Problem Statement
4 key features lack CLI equivalents and are accessible only through the interactive TUI, making them inaccessible to agents and automation scripts. The underlying primitives (`spawnBackgroundAgent`, `launchClaude`, `snoozeIssue`, config writes) already exist — only the CLI wiring is missing.

## Findings
- **File:** `src/cli.ts`
- **Evidence:** No `hog workflow launch`, `hog workflow resume`, `hog issue snooze`, or non-interactive auto-status config commands exist; score is 7/14 agent-accessible capabilities
- **Impact:** Agents cannot orchestrate the workflow cycle, resume sessions, snooze issues, or configure auto-status non-interactively

## Proposed Solutions
### Option A: Add the 4 missing CLI commands (Recommended)
1. `hog workflow launch <issue> --phase <phase>` — wraps `spawnBackgroundAgent`/`launchClaude`
2. `hog workflow resume <issue> [--session <id>]` — resumes an existing Claude session
3. `hog issue snooze <issue> [--days <n>]` — wraps `snoozeIssue`
4. `hog config repos:set-auto-status` — non-interactive equivalent of the `hog init` wizard steps for auto-status
- **Effort:** Large
- **Risk:** Low

## Acceptance Criteria
- [ ] `hog workflow launch <issue> --phase <phase>` works non-interactively
- [ ] `hog workflow resume <issue>` works non-interactively
- [ ] `hog issue snooze <issue> --days <n>` works non-interactively
- [ ] Auto-status configurable via CLI flags without running `hog init`

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
