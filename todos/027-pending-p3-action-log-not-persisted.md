# 027: Persist Action Log for Agent Auditability (P3 - Nice-to-Have)

**Status:** Pending
**Priority:** P3 (Nice-to-Have)
**Issue ID:** 027
**Tags:** code-review, agent-native, action-log
**Created:** 2026-02-19

---

## Problem Statement

The action log (`src/board/hooks/use-action-log.ts`) is **entirely ephemeral** — stored only in memory during the current board session. When the TUI exits:

- All action history is lost
- External scripts/agents cannot verify what mutations `hog` performed
- Audit trail is incomplete
- No forensic data available if operations fail silently

This is the **last gap in agent-native parity**: agents can trigger mutations via `hog issue assign`, `hog issue comment`, etc., but cannot reliably verify outcomes without re-querying GitHub (slow) or implementing their own tracking (error-prone).

---

## Findings

### 1. Current Action Log Architecture
- **In-memory storage:** `src/board/hooks/use-action-log.ts` — React hook with local state
- **Lifecycle:** Actions added during board session; cleared on exit
- **Consumers:** Dashboard UI displays toast notifications; no persistence layer
- **Entry structure:** `{ entryId, action, status, timestamp, details }`
- **Limitation:** No disk I/O; no recovery; no forensic value

### 2. Agent-Native Gaps
- **After mutation:** Agent calls `hog issue assign` → mutation executes → shell script has no way to confirm
- **Solution today:** Agent re-queries GitHub API (adds latency, uses API quota)
- **Better solution:** Agent calls `hog log show --json` → reads last N entries from persistent log
- **Why it matters:** Enables fully autonomous workflows without GitHub API polling

### 3. Relevant Existing Patterns
- **Config persistence:** `src/config.ts` — reads/writes `~/.config/hog/config.json` using Zod + file I/O
- **Sync state persistence:** `src/sync-state.ts` — reads/writes `~/.config/hog/sync-state.json`
- **Directory structure:** `~/.config/hog/` already established; can add `action-log.json` here
- **Pattern to follow:** Zod schema + readJson/writeJson helpers

### 4. Design Considerations
- **Retention policy:** Keep last N entries (e.g., 1000) to avoid unbounded growth
- **Rotation:** Archive old logs to `action-log.YYYY-MM-DD.json` if desired (optional for P3)
- **Privacy:** Ensure logs don't capture sensitive data (e.g., full comment bodies if large)
- **Format:** Flat JSON array of action entries; easy for agents to parse
- **Recovery:** On startup, load recent entries to seed in-memory log (optional)

---

## Proposed Solutions

### Option A: Simple Persistence (Recommended for P3)
1. Create `src/log-persistence.ts` with helpers:
   - `appendActionLog(entry: ActionLogEntry): void` — append entry to `~/.config/hog/action-log.json`
   - `getActionLog(limit?: number): ActionLogEntry[]` — read last N entries
   - `clearActionLog(): void` — optional manual cleanup
2. Call `appendActionLog()` whenever an action completes in `use-action-log.ts`
3. Add CLI command: `hog log show [--json] [--limit 50]` that calls `getActionLog()`
4. JSON output: array of `{ id, action, status, timestamp, ...details }`
5. Rotate log file when it exceeds 10MB (keep last 1000 entries)
6. Estimated effort: 2–3 hours

### Option B: Full-Featured Audit System (Forward-Looking)
1. Create structured `ActionAuditLog` with:
   - Separate schema for different action types (assign, comment, status-change, create, etc.)
   - Full audit context (user, repo, issue, result, error message if failed)
   - Support for multiple log files rotated by date
2. Add `hog log [list|show|search] [--repo X] [--action assign] [--status success|failed]` commands
3. Integrate with sync state for replay/validation
4. Estimated effort: 4–5 hours; higher complexity; may defer to future

---

## Acceptance Criteria

- [ ] Action log entries persisted to `~/.config/hog/action-log.json` (or equivalent)
- [ ] Log file survives board TUI exit and is available on next `hog log show` call
- [ ] `hog log show [--json]` command implemented and returns recent N entries
- [ ] Entries include: id, action type, status (success/failed), timestamp, relevant details
- [ ] Log file has retention policy (e.g., keep last 1000 entries; rotate when >10MB)
- [ ] Sensitive data not captured (e.g., truncate long comment bodies if needed)
- [ ] Agent scripts can reliably query action history via `hog log show --json`
- [ ] Tests verify persistence and retrieval
- [ ] Documentation added (CLI help, README, or CLAUDE.md)
- [ ] Code review approved

---

## Optional (Forward-Looking)
- [ ] Action log recovery: load recent entries on startup to seed in-memory log
- [ ] Rotation/archival: move old logs to date-stamped files (`action-log.2026-02-19.json`)
- [ ] Search/filter: `hog log show --repo X --action assign --status failed`
- [ ] Metrics: `hog log stats` — summary of actions/success-rate by type

---

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Initial findings and options. Marks last gap in agent-native parity. |

---

## Related Issues

- See also: #024 (CLI simplifications), #025 (Slack URL in JSON), #026 (action-log entry ID counter)
- Depends on: None (independent feature)
- Blocks: None (optional enhancement)

## References

- `src/board/hooks/use-action-log.ts` — in-memory action log definition
- `src/config.ts` — pattern for persistent config with Zod
- `src/sync-state.ts` — pattern for persistent state JSON
- `src/cli.ts` — where new `hog log` command would be registered
