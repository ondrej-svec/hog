---
title: "feat: Workflow Conductor — Issue Lifecycle Orchestration"
type: feat
status: active
date: 2026-03-01
brainstorm: docs/brainstorms/2026-03-01-workflow-conductor-brainstorm.md
---

# feat: Workflow Conductor — Issue Lifecycle Orchestration

## Overview

Transform hog from a GitHub Issues display dashboard into a workflow conductor that tracks issue lifecycle phases, launches and monitors AI agent sessions, auto-updates GitHub status, and reduces the friction of starting and finishing work. Remove TickTick integration entirely; unify on GitHub as the sole source of truth.

This is a major architectural evolution delivered in 6 incremental phases, each independently shippable and valuable.

## Problem Statement

Developers' project state is scattered across disconnected systems: GitHub, local files, terminal windows, their head, and todo apps. Each transition between these systems requires the human to be the glue — manually updating GitHub, remembering what phase they're in, deciding what to do next. The current hog board shows issues but forgets about them the moment Claude Code launches.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Board TUI (Ink/React)                                               │
│                                                                     │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐│
│  │ Repos   │  │ Statuses │  │ Issues    │  │ Detail / Agent Panel ││
│  │ Panel   │  │ Panel    │  │ + Phase   │  │ (stream-json view)   ││
│  │         │  │          │  │ Indicators│  │                      ││
│  └─────────┘  └──────────┘  └───────────┘  └──────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Agent Activity Strip / Nudge Bar                                ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Hooks:                                                             │
│   useWorkflowState()  ← reads/writes enrichment.json               │
│   useAgentSessions()  ← spawns agents, monitors, captures sessions │
│   useAutoStatus()     ← detects events, updates GitHub status      │
│   useNudges()         ← stale issue detection, suggestions         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ State Layer                                                         │
│                                                                     │
│  GitHub (source of truth)     │  Local enrichment                   │
│  ├─ Project status fields     │  ├─ ~/.config/hog/enrichment.json   │
│  ├─ Issue metadata            │  ├─ ~/.config/hog/agent-results/    │
│  └─ PR/branch events          │  └─ Session IDs, phase timing      │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Agent Layer                                                         │
│                                                                     │
│  Interactive: launchClaude() → tmux/terminal (existing)             │
│  Background:  spawnAgent()   → claude -p --output-format stream-json│
│               └─ Writes result to agent-results/{key}.json on exit  │
│               └─ Captures session_id for interactive resume         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Enrichment File Schema

`~/.config/hog/enrichment.json` — personal, not shared.

```typescript
// src/enrichment.ts
const AGENT_SESSION_SCHEMA = z.object({
  id: z.string(),                                    // unique session key
  repo: z.string(),                                  // "owner/repo"
  issueNumber: z.number(),                           // GitHub issue number
  phase: z.string(),                                 // "brainstorm" | "plan" | custom
  mode: z.enum(["interactive", "background"]),
  claudeSessionId: z.string().optional(),            // from stream-json, for --resume
  pid: z.number().optional(),                        // background process PID
  startedAt: z.string(),                             // ISO 8601
  exitedAt: z.string().optional(),
  exitCode: z.number().optional(),                   // 0 = success, non-zero = failure
  resultFile: z.string().optional(),                 // path to agent-results/*.json
});

const ENRICHMENT_SCHEMA = z.object({
  version: z.literal(1),
  sessions: z.array(AGENT_SESSION_SCHEMA),
  nudgeState: z.object({
    lastDailyNudge: z.string().optional(),           // ISO date of last nudge shown
    snoozedIssues: z.record(z.string(), z.string()), // "owner/repo#42" → snooze-until ISO
  }),
});
```

### Agent Result Files

Background agents write results to `~/.config/hog/agent-results/{repo-slug}-{issueNumber}-{phase}.json`:

```typescript
const AGENT_RESULT_SCHEMA = z.object({
  sessionId: z.string(),                             // Claude session ID for resume
  phase: z.string(),
  issueRef: z.string(),                              // "owner/repo#42"
  startedAt: z.string(),
  completedAt: z.string(),
  exitCode: z.number(),
  artifacts: z.array(z.string()),                    // paths to created files
  summary: z.string().optional(),                    // last text output from agent
});
```

### Agent Completion Detection

**Dual-mode approach** (resolves SpecFlow Q1):

1. **When hog is running (board open):** Keep the child process reference (do NOT unref background agents). Attach `child.on('exit', callback)`. On exit: write result file, update enrichment.json, show toast.

2. **When hog is NOT running (overnight batch):** Launch agents fully detached. Agent writes result file on exit via a wrapper script. On next board open, `useAgentSessions()` scans `agent-results/` for new files and reconciles with enrichment.json.

The wrapper script (`~/.config/hog/agent-wrapper.sh`):
```bash
#!/bin/bash
RESULT_FILE="$1"; shift
claude "$@" --output-format json > "$RESULT_FILE" 2>&1
echo "{\"exitCode\": $?}" >> "$RESULT_FILE"
```

### Auto-Status Trigger Table

Complete mapping (resolves SpecFlow Q4):

| Event | Detection Method | Status Transition | Configurable? |
|-------|-----------------|-------------------|--------------|
| Issue assigned to user | GitHub activity events (existing) | → first non-backlog status | Yes |
| Agent launched for phase | Hog-triggered (direct) | No auto-change (user controls) | N/A |
| Branch created matching `*{issueNumber}*` | GitHub activity events | → In Progress equivalent | Yes, branch pattern |
| PR opened referencing `#{issueNumber}` | GitHub activity events (existing) | → Review equivalent | Yes |
| PR merged | GitHub activity events (existing) | → Done equivalent | Yes |
| PR closed without merge | No auto-change | (manual decision) | N/A |
| Issue closed | GitHub activity events (existing) | → Done equivalent | Yes |

Status names are mapped via a new config field:

```typescript
// In REPO_CONFIG_SCHEMA
autoStatus: z.object({
  enabled: z.boolean().default(false),
  triggers: z.object({
    branchCreated: z.string().optional(),      // status name to move to, e.g. "In Progress"
    prOpened: z.string().optional(),            // e.g. "In Review"
    prMerged: z.string().optional(),            // e.g. "Done"
    branchPattern: z.string().optional(),       // regex for branch name matching, default: issue number anywhere
  }).optional(),
}).optional()
```

Status names are resolved to option IDs at runtime via `fetchProjectStatusOptions()` (already exists, results cached per refresh cycle).

### Per-Phase Prompt Templates

Default templates (resolves SpecFlow Q9, Q11, Q12):

```typescript
const DEFAULT_PHASE_PROMPTS: Record<string, string> = {
  research: [
    "Research context for Issue #{number}: {title}",
    "URL: {url}",
    "",
    "Explore the codebase and gather context that would help brainstorm this issue.",
    "Write a short research summary to docs/research/{slug}.md.",
    "Do NOT implement anything. Just gather information.",
  ].join("\n"),

  brainstorm: [
    "Let's brainstorm Issue #{number}: {title}",
    "URL: {url}",
    "",
    "{body}",
  ].join("\n"),

  plan: [
    "Create an implementation plan for Issue #{number}: {title}",
    "URL: {url}",
    "",
    "If a brainstorm doc exists in docs/brainstorms/, use it as context.",
    "Write the plan to docs/plans/.",
  ].join("\n"),

  implement: [
    "Implement Issue #{number}: {title}",
    "URL: {url}",
    "",
    "If a plan exists in docs/plans/, follow it.",
    "Commit frequently. Create a PR when done.",
  ].join("\n"),

  review: [
    "Review the changes for Issue #{number}: {title}",
    "URL: {url}",
    "",
    "Check the current branch diff against main.",
    "Run tests and linting.",
    "Write a review summary.",
  ].join("\n"),

  compound: [
    "Document the solution for Issue #{number}: {title}",
    "URL: {url}",
    "",
    "Write a solution document to docs/solutions/.",
    "Include: symptoms, root cause, solution, prevention.",
  ].join("\n"),
};
```

Additional template variables beyond existing `{number}`, `{title}`, `{url}`:
- `{body}` — issue body text (fetched via `gh issue view`)
- `{slug}` — kebab-case of title
- `{phase}` — current phase name
- `{repo}` — full repo name

### Config v4 Schema Changes

```typescript
// New workflow config per repo
const WORKFLOW_CONFIG_SCHEMA = z.object({
  mode: z.enum(["suggested", "freeform"]).default("suggested"),
  phases: z.array(z.string()).default(["brainstorm", "plan", "implement", "review"]),
  phasePrompts: z.record(z.string(), z.string()).optional(),   // per-phase prompt overrides
  phaseDefaults: z.record(z.string(), z.object({
    mode: z.enum(["interactive", "background", "either"]).default("either"),
    allowedTools: z.array(z.string()).optional(),
  })).optional(),
}).optional();

// Added to REPO_CONFIG_SCHEMA
workflow: WORKFLOW_CONFIG_SCHEMA,
autoStatus: AUTO_STATUS_SCHEMA,

// Added to BOARD_CONFIG_SCHEMA
workflow: z.object({
  defaultMode: z.enum(["suggested", "freeform"]).default("suggested"),
  defaultPhases: z.array(z.string()).default(["brainstorm", "plan", "implement", "review"]),
  phasePrompts: z.record(z.string(), z.string()).optional(),
  staleness: z.object({
    warningDays: z.number().default(7),
    criticalDays: z.number().default(14),
  }).optional(),
  maxConcurrentAgents: z.number().default(3),
  notifications: z.object({
    os: z.boolean().default(false),
    sound: z.boolean().default(false),
  }).optional(),
}).optional(),

// Remove from BOARD_CONFIG_SCHEMA (moved into workflow.phasePrompts)
// claudePrompt (kept for backward compat, used as default for "implement" phase)

// Remove entirely
ticktick: DELETED
defaultProjectId: DELETED
defaultProjectName: DELETED
```

Migration v3 → v4:
1. Remove `ticktick` block
2. Remove `defaultProjectId`, `defaultProjectName`
3. If `claudePrompt` exists, migrate to `workflow.phasePrompts.implement`
4. Set `version: 4`
5. Clean up auth.json: remove `accessToken`, `clientId`, `clientSecret` (keep `openrouterApiKey`)
6. Delete `sync-state.json` (or leave it — harmless dead file)

### Pick Command Replacement

`pick` becomes (resolves SpecFlow Q6):
1. Assign issue to self on GitHub (existing behavior, kept)
2. If workflow mode is "suggested" and first phase has no artifact, suggest: "Start brainstorm? [y/n]"
3. No TickTick task creation

### Workflow Overlay (W key) Behavior

When user presses `W` on an issue (resolves SpecFlow Q7, Q8, Q10):

```
┌─ Workflow: #42 Fix auth flow ──────────────────────┐
│                                                     │
│  ● Brainstorm  ✅ (docs/brainstorms/auth.md)       │
│  ● Plan        ✅ (docs/plans/auth-plan.md)        │
│  ● Implement   🔄 (agent running, 3m)  [cancel]    │
│  ○ Review                                           │
│  ○ Compound                                         │
│                                                     │
│  [Enter] Launch selected phase                      │
│  [r] Resume last session (implement, sid: abc123)   │
│  [b] Launch as background agent                     │
│  [i] Launch interactively                           │
│  [Esc] Back                                         │
│                                                     │
│  ⚠ Agent already running for "implement"            │
│    [Enter] to launch anyway, [r] to resume          │
└─────────────────────────────────────────────────────┘
```

In "suggested" mode, if user selects a phase that skips earlier ones:
```
No plan doc found. Suggested next phase: plan.
Skip to implement anyway? [y/n]
```
Soft warning, user confirms, no hard block.

### Triage Entry Point

Two access methods (resolves SpecFlow Q14, Q15):

1. **CLI subcommand** (works without board, supports overnight):
   ```
   hog workflow triage [--repo <name>] [--phase research|plan|review]
   ```
   Shows all Ready/stale issues, user selects interactively, agents launch detached.

2. **Board keyboard shortcut** `T`:
   Opens triage overlay within the board. Same selection, but agents launch with process tracking (not detached).

### Staleness Configuration

```typescript
// Per-repo, with board-level defaults
staleness: z.object({
  warningDays: z.number().default(7),      // 🟡 yellow indicator
  criticalDays: z.number().default(14),    // 🔴 red indicator
}).optional()
```

Applied per-issue based on time in current GitHub Project status. Different phases don't have different thresholds (simpler). Shown as `[14d]` suffix on the issue row, color-coded.

### Notification System

```typescript
// Board-level config
notifications: z.object({
  os: z.boolean().default(false),          // macOS: osascript display notification
  sound: z.boolean().default(false),       // terminal bell or custom sound
}).optional()
```

OS notification implementation:
```typescript
// src/board/notify.ts
function sendOsNotification(title: string, body: string): void {
  if (process.platform === "darwin") {
    spawnSync("osascript", ["-e", `display notification "${body}" with title "${title}"`]);
  } else {
    // Linux: notify-send
    spawnSync("notify-send", [title, body]);
  }
}
```

### Shareable Workflow Template Format

```json
{
  "$schema": "https://hog.sh/schemas/workflow-template-v1.json",
  "name": "Full Development Lifecycle",
  "description": "Brainstorm, plan, implement, review with AI agents",
  "version": "1.0.0",
  "workflow": {
    "mode": "suggested",
    "phases": ["research", "brainstorm", "plan", "implement", "review", "compound"],
    "phasePrompts": {
      "research": "Research context for Issue #{number}: {title}...",
      "brainstorm": "Let's brainstorm Issue #{number}: {title}...",
      "plan": "Create an implementation plan...",
      "implement": "Implement Issue #{number}: {title}...",
      "review": "Review the changes...",
      "compound": "Document the solution..."
    },
    "phaseDefaults": {
      "research": { "mode": "background" },
      "brainstorm": { "mode": "interactive" },
      "plan": { "mode": "either" },
      "implement": { "mode": "either" },
      "review": { "mode": "background" },
      "compound": { "mode": "background" }
    }
  },
  "staleness": { "warningDays": 7, "criticalDays": 14 },
  "autoStatus": {
    "branchCreated": "In Progress",
    "prOpened": "In Review",
    "prMerged": "Done"
  }
}
```

Import: `hog config workflow:import <file-or-url>` → merges into board-level or repo-level config.

---

## Implementation Phases

### Phase 1: Foundation — Remove TickTick, Add Config v4

**Goal:** Simplify the codebase. Remove TickTick integration. Migrate config to v4 with workflow fields (optional, all defaulted). No new features yet — just cleanup and schema preparation.

**Tasks:**

- [x] Remove `src/api.ts` (TickTick client)
- [x] Remove `src/auth.ts` (TickTick OAuth)
- [x] Remove `src/sync.ts` (GitHub ↔ TickTick sync)
- [x] Remove `src/sync-state.ts` (sync mapping persistence)
- [x] Simplify `src/pick.ts` — remove TickTick task creation, keep GitHub assign
- [x] Remove TickTick types from `src/types.ts` (`Task`, `ChecklistItem`, `Project`, `ProjectData`, `CreateTaskInput`, `UpdateTaskInput`, `TaskStatus`)
- [x] Remove TickTick output helpers from `src/output.ts` (`printTasks`, `printTask`, `printProjects`, `printSyncResult`, `printSyncStatus`)
- [x] Remove TickTick fetch from `src/board/fetch.ts` (`DashboardData.ticktick`, `DashboardData.ticktickError`, TickTick fetch block)
- [x] Remove TickTick panel rendering from `src/board/components/dashboard.tsx`
- [x] Remove `task` subcommand tree from `src/cli.ts`
- [x] Remove `sync` subcommand tree from `src/cli.ts`
- [x] Remove `config ticktick:enable/disable` from `src/cli.ts`
- [x] Remove TickTick steps from `src/init.ts`
- [x] Clean up auth.json schema — remove `accessToken`, `clientId`, `clientSecret`
- [x] Add config v3 → v4 migration in `migrateConfig()`
- [x] Add `workflow` optional field to `REPO_CONFIG_SCHEMA` and `BOARD_CONFIG_SCHEMA`
- [x] Add `autoStatus` optional field to `REPO_CONFIG_SCHEMA`
- [x] Update all tests — remove TickTick-related test cases, add migration tests
- [x] Run `npm run ci` — verify clean

**Files modified:** `src/api.ts` (delete), `src/auth.ts` (delete), `src/sync.ts` (delete), `src/sync-state.ts` (delete), `src/pick.ts`, `src/types.ts`, `src/output.ts`, `src/config.ts`, `src/cli.ts`, `src/init.ts`, `src/board/fetch.ts`, `src/board/components/dashboard.tsx`

**Success criteria:** All TickTick code removed. Config v4 schema validates. Existing board functionality unchanged. All tests pass. 80% coverage maintained.

---

### Phase 2: Enrichment State + Phase-Aware Launch

**Goal:** Track workflow state locally. Add `[W]` key to open a workflow overlay with phase-specific launches. Extend prompt templates with new variables.

**Tasks:**

- [x] Create `src/enrichment.ts` — Zod schema, `loadEnrichment()`, `saveEnrichment()`, `upsertSession()`, `findSession()`, `findActiveSession()`
- [x] Create `src/enrichment.test.ts`
- [x] Extend `buildPrompt()` in `src/board/launch-claude.ts` with `{body}`, `{slug}`, `{phase}`, `{repo}` placeholders
- [x] Update `buildPrompt.test.ts` with new placeholder tests
- [x] Add default phase prompt templates in `src/board/launch-claude.ts` (the `DEFAULT_PHASE_PROMPTS` map)
- [x] Create `src/board/hooks/use-workflow-state.ts` — reads enrichment.json, exposes per-issue phase state
- [x] Create `src/board/hooks/use-workflow-state.test.ts`
- [x] Create `src/board/components/workflow-overlay.tsx` — phase list, phase status (✅/🔄/○), keyboard navigation
- [x] Create `src/board/components/workflow-overlay.test.tsx`
- [x] Add `"overlay:workflow"` to `UIMode` in `src/board/hooks/use-ui-state.ts`
- [x] Add `ENTER_WORKFLOW` / `EXIT_WORKFLOW` actions to UI reducer
- [x] Wire `[W]` key in `src/board/hooks/use-keyboard.ts`
- [x] Add workflow overlay to `src/board/components/overlay-renderer.tsx`
- [x] Extend `launchClaude()` to accept `phase` parameter — selects prompt template
- [x] On interactive launch from workflow overlay: write session to enrichment.json
- [x] Add `hog workflow status [issueRef]` CLI subcommand showing enrichment state
- [x] Update help overlay with `[W]` keybinding

**Files created:** `src/enrichment.ts`, `src/enrichment.test.ts`, `src/board/hooks/use-workflow-state.ts`, `src/board/hooks/use-workflow-state.test.ts`, `src/board/components/workflow-overlay.tsx`, `src/board/components/workflow-overlay.test.tsx`

**Files modified:** `src/board/launch-claude.ts`, `src/board/hooks/use-ui-state.ts`, `src/board/hooks/use-keyboard.ts`, `src/board/components/overlay-renderer.tsx`, `src/board/components/dashboard.tsx`, `src/cli.ts`

**Success criteria:** `[W]` opens workflow overlay. Phases show from config or defaults. Selecting a phase launches Claude Code with phase-specific prompt. Sessions recorded in enrichment.json.

---

### Phase 3: Background Agents + Agent Activity Panel

**Goal:** Launch `claude -p` for background phases. Stream agent status on the board. Capture session IDs for resume.

**Tasks:**

- [ ] Create `src/board/spawn-agent.ts` — `spawnBackgroundAgent(options)`: spawns `claude -p --output-format stream-json`, parses stream, writes result file on exit
- [ ] Create `src/board/spawn-agent.test.ts`
- [ ] Create `~/.config/hog/agent-results/` directory on first use
- [ ] Implement stream-json parser: extract tool_use events (for status display), result events (for session_id capture), and final text output
- [ ] Create `src/board/hooks/use-agent-sessions.ts` — manages running background agents, monitors exit, reconciles with enrichment.json on board open
- [ ] Create `src/board/hooks/use-agent-sessions.test.ts`
- [ ] Create `src/board/components/agent-activity-panel.tsx` — shows running/completed agents with streaming status lines
- [ ] Create `src/board/components/agent-activity-panel.test.tsx`
- [ ] Add agent activity strip to `src/board/components/panel-layout.tsx` (bottom strip, similar to activity-panel.tsx)
- [ ] Wire `[r]` key in keyboard handler — resumes last session for selected issue via `claude --resume <sessionId>` through `launchClaude()`
- [ ] Add `[b]` option in workflow overlay to force background mode
- [ ] Handle agent crash: update enrichment.json with exit code, show error toast
- [ ] Smart scheduling: track running agent count, queue if over `maxConcurrentAgents` (default 3)
- [ ] Scan `agent-results/` on board open for unprocessed results (overnight completion detection)

**Files created:** `src/board/spawn-agent.ts`, `src/board/spawn-agent.test.ts`, `src/board/hooks/use-agent-sessions.ts`, `src/board/hooks/use-agent-sessions.test.ts`, `src/board/components/agent-activity-panel.tsx`, `src/board/components/agent-activity-panel.test.tsx`

**Files modified:** `src/board/hooks/use-keyboard.ts`, `src/board/components/panel-layout.tsx`, `src/board/components/dashboard.tsx`, `src/board/components/workflow-overlay.tsx`, `src/board/components/overlay-renderer.tsx`

**Success criteria:** Background agents launch and show real-time status on board. Session IDs captured. `[r]` resumes sessions interactively. Crashed agents show errors. Results from overnight runs detected on next board open. Max 3 concurrent agents enforced.

---

### Phase 4: Auto-Status Updates + Phase Indicators

**Goal:** Hog auto-updates GitHub Project status based on detected events. Issue rows show phase indicators and age.

**Tasks:**

- [ ] Create `src/board/hooks/use-auto-status.ts` — on each data refresh, compare current activity events against trigger table; fire `updateProjectItemStatusAsync()` for matching events
- [ ] Create `src/board/hooks/use-auto-status.test.ts`
- [ ] Status name → option ID resolution: use `fetchProjectStatusOptions()` (already in github.ts), cache per refresh cycle
- [ ] Branch detection: parse `CreateEvent` (ref_type: "branch") from activity events, match branch name against issue number pattern
- [ ] PR detection: parse `PullRequestEvent` from activity events, match PR body/title for `#issueNumber`
- [ ] Guard against duplicate updates: skip if issue already in target status
- [ ] Guard against race: if user manually changed status since last refresh, skip auto-update
- [ ] Add `autoStatus` config field to `REPO_CONFIG_SCHEMA` with `enabled`, `triggers`, `branchPattern`
- [ ] Extend `src/board/components/issue-row.tsx` — add phase indicator badge and age suffix
- [ ] Phase indicator: derive from enrichment.json sessions + artifact detection (check if brainstorm/plan docs exist in repo)
- [ ] Age calculation: time since issue entered current GitHub Project status (use `updatedAt` or project field dates)
- [ ] Color coding: no indicator (<7d), 🟡 (7-14d), 🔴 (14d+), thresholds from config
- [ ] Add `autoStatus` section to `hog init` wizard — prompt for trigger status names
- [ ] Show auto-status activity in action log

**Files created:** `src/board/hooks/use-auto-status.ts`, `src/board/hooks/use-auto-status.test.ts`

**Files modified:** `src/board/components/issue-row.tsx`, `src/board/components/dashboard.tsx`, `src/config.ts`, `src/init.ts`

**Success criteria:** When a branch matching `*42*` is pushed, hog auto-moves #42 to "In Progress" on next refresh. When a PR referencing #42 is opened, auto-move to "In Review". Issue rows show phase badge and age. Color coding works. Auto-status is opt-in per repo.

---

### Phase 5: Nudges + Triage + Completion Assistance

**Goal:** Help people start work (nudges, triage) and finish work (completion diagnostics).

**Tasks:**

- [ ] Create `src/board/hooks/use-nudges.ts` — daily nudge overlay, staleness detection, snooze tracking
- [ ] Create `src/board/hooks/use-nudges.test.ts`
- [ ] Daily nudge overlay: on board open, if `lastDailyNudge` < today, show summary of stale issues (dismissable/snoozeable)
- [ ] Create `src/board/components/nudge-overlay.tsx`
- [ ] Ready-issue suggestions: issues in first status group (backlog/ready) for >7 days get a subtle "Quick brainstorm?" indicator
- [ ] Completion assistance: new action in workflow overlay — "Check what's left" launches background agent that reads plan, diffs branch, runs tests, reports status
- [ ] Completion agent prompt template: "Check the status of Issue #{number}. Read the plan doc if it exists. Run `git diff main...HEAD --stat`. Run tests. Report: what's done, what's remaining, what's blocking."
- [ ] Add `hog workflow triage` CLI subcommand:
  - List all Ready/stale issues across repos (or `--repo` filter)
  - Interactive selection with checkboxes
  - Launch background agents for selected issues (detached for overnight, tracked for board-open)
  - `--phase` flag to specify which phase to run (default: research for Ready, review for In Progress)
- [ ] Wire `[T]` key on board for triage overlay (same selection UI as CLI, but agents tracked)
- [ ] Snooze mechanism: `snoozedIssues` in enrichment.json, snooze for 1d/3d/7d, snoozed issues hidden from nudges

**Files created:** `src/board/hooks/use-nudges.ts`, `src/board/hooks/use-nudges.test.ts`, `src/board/components/nudge-overlay.tsx`

**Files modified:** `src/board/hooks/use-keyboard.ts`, `src/board/components/overlay-renderer.tsx`, `src/board/components/dashboard.tsx`, `src/board/components/workflow-overlay.tsx`, `src/cli.ts`, `src/enrichment.ts`

**Success criteria:** Opening board shows daily nudge for stale issues. Triage command launches batch agents. Completion check reports remaining work. Snooze persists across sessions.

---

### Phase 6: Notifications + Shareable Templates

**Goal:** Configurable notification channels. Importable/exportable workflow template format.

**Tasks:**

- [ ] Create `src/notify.ts` — `sendNotification(title, body, config)` with OS notification (osascript/notify-send) and terminal bell support
- [ ] Create `src/notify.test.ts`
- [ ] Wire notifications into `use-agent-sessions.ts` — on agent completion, call `sendNotification()` if configured
- [ ] Add `notifications` config to `BOARD_CONFIG_SCHEMA`
- [ ] Define workflow template JSON schema (as documented in Technical Approach above)
- [ ] Create `src/workflow-template.ts` — `exportTemplate(repoConfig)`, `importTemplate(filePath)`, `validateTemplate(json)`
- [ ] Create `src/workflow-template.test.ts`
- [ ] Add `hog config workflow:export [--repo <name>] [--output <file>]` CLI subcommand
- [ ] Add `hog config workflow:import <file-or-url>` CLI subcommand — merges template into config
- [ ] Add `hog config workflow:show [--repo <name>]` CLI subcommand — display current workflow config
- [ ] Add workflow template section to `hog init` — offer built-in templates (code, blog, minimal) or import from file

**Files created:** `src/notify.ts`, `src/notify.test.ts`, `src/workflow-template.ts`, `src/workflow-template.test.ts`

**Files modified:** `src/board/hooks/use-agent-sessions.ts`, `src/config.ts`, `src/cli.ts`, `src/init.ts`

**Success criteria:** OS notifications fire when background agents complete (if enabled). Workflow templates export to clean JSON. Import from file works. Init wizard offers template selection.

---

## Alternative Approaches Considered

1. **Agent SDK integration (in-process)** — Maximum control but couples hog's process to the agent runtime. Rejected: dashboard becomes engine, violating ATC metaphor.

2. **TickTick retained alongside GitHub** — Keeps the existing todo integration. Rejected: two sources of truth add complexity without proportional value. GitHub Issues can serve as personal todos via dedicated repos.

3. **Daemon process for overnight agents** — A background `hog agent --daemon` process. Rejected for now: adds operational complexity (process management, crash recovery). The detached-agent + result-file approach is simpler and achieves 90% of the value. Can be added later if demand exists.

4. **Enforced phase gates** — Hard-block users from skipping phases. Rejected: kills creative flow for non-code work. Soft warnings + suggestions respect user autonomy (Aaron Dignan's principle).

## Acceptance Criteria

### Functional Requirements

- [ ] TickTick integration fully removed; no references in code, config, or tests
- [ ] Config v4 with workflow fields; migration from v3 automatic
- [ ] `[W]` key opens workflow overlay with phase-specific launches
- [ ] Background agents launch via `claude -p --output-format stream-json`
- [ ] Agent activity panel shows real-time streaming status
- [ ] Session IDs captured; `[r]` resumes interactively
- [ ] Auto-status updates GitHub Project status on branch/PR events
- [ ] Issue rows show phase indicators and age with color coding
- [ ] Daily nudge overlay for stale issues
- [ ] `hog workflow triage` launches batch agents
- [ ] Completion assistance reports remaining work on aging issues
- [ ] OS notifications when background agents complete (configurable)
- [ ] Workflow templates exportable and importable

### Non-Functional Requirements

- [ ] No performance regression on board render (<100ms)
- [ ] Background agents run in separate processes (no TUI impact)
- [ ] Enrichment file writes are atomic (write tmp, rename)
- [ ] All new code follows existing patterns (hooks, kebab-case, import type, no any)
- [ ] 80% test coverage maintained across all new files

### Quality Gates

- [ ] `npm run ci` passes at every phase boundary
- [ ] Each phase is independently deployable (no partial states)
- [ ] Config migration is backward compatible (v3 configs still load)

## Dependencies & Prerequisites

- Claude Code CLI installed with `-p` and `--output-format stream-json` support
- `gh` CLI authenticated (existing requirement)
- Node.js 22+ (existing requirement)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `claude -p stream-json` format changes | Low | High | Parse defensively; degrade to fire-and-forget if stream parsing fails |
| Session IDs not resumable after time | Medium | Medium | Catch resume error, offer fresh session |
| Auto-status conflicts with manual changes | Medium | Low | Skip auto-update if status changed since last refresh |
| Enrichment file corruption | Low | Medium | Atomic writes (tmp+rename), schema validation on load |
| Background agents consuming excessive API credits | Medium | High | Max concurrent agents config, smart scheduling, user consent for batch |
| Large number of agent result files accumulating | Low | Low | Periodic cleanup: delete results older than 30 days |

## Documentation Plan

- [ ] Update README.md with workflow conductor overview
- [ ] Add `docs/workflow-guide.md` — user guide for workflow features
- [ ] Update `hog init` to include workflow configuration
- [ ] Add `--help` text for all new CLI subcommands

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-03-01-workflow-conductor-brainstorm.md`
- Config schema: `src/config.ts`
- Launch Claude: `src/board/launch-claude.ts`
- GitHub operations: `src/github.ts`
- Board hooks pattern: `src/board/hooks/use-data.ts`
- UI state FSM: `src/board/hooks/use-ui-state.ts`
- Sync state (pattern to follow): `src/sync-state.ts`
- Existing status update: `src/board/hooks/use-actions.ts:handleStatusChange`

### External References

- Claude Code CLI headless mode: https://code.claude.com/docs/en/headless
- Claude Agent SDK: https://github.com/anthropics/claude-agent-sdk-typescript
- Mitchell Hashimoto agentic patterns: https://mitchellh.com/writing/my-ai-adoption-journey
- GitHub Agentic Workflows: https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/
