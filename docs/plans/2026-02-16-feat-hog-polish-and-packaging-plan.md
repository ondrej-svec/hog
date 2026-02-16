---
title: "feat: Hog UX Polish, Configurability & Open-Source Packaging"
type: feat
status: active
date: 2026-02-16
---

# Hog UX Polish, Configurability & Open-Source Packaging

## Overview

Take `hog` from a personal power tool to a polished, team-ready, open-sourceable CLI through three phases:

1. **Phase 1 — Async UX Overhaul**: Make background operations feel responsive and transparent (toast system, refresh feedback, stale data indicators, stable navigation)
2. **Phase 2 — Configurability**: Decouple from hardcoded settings (TickTick optional, board profiles, flexible status mapping, `hog init` wizard)
3. **Phase 3 — Distribution**: Package for public use (npm publish, README, CI/CD, optional Homebrew)

Each phase delivers standalone value. UX first (daily driver quality), then configurability (team-ready), then distribution (open-source).

## Problem Statement / Motivation

**Current gaps:**
- **Feedback is invisible**: Status messages auto-dismiss after 3s with no way to review. Failed operations disappear. No way to tell if data is fresh or 5 minutes stale.
- **Hardcoded for one person**: TickTick always required, single board config, status groups baked in. Can't share with teammates without code changes.
- **Can't distribute**: Shell wrapper requires nvm, no bundling, no README, no CI/CD. Installation is "clone repo + manually configure."

**Why this matters:**
- Ondrej uses hog daily. Polish UX = less friction, more trust in the tool.
- Teammates could benefit from the board but can't install it.
- Open-sourcing creates leverage — others maintain/improve features.

## Proposed Solution

### Architecture Overview

```
Phase 1: New components/hooks layered on existing architecture
  ┌─────────────────────────────────────────────┐
  │  Dashboard.tsx                               │
  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
  │  │ Header   │ │ Toast    │ │ Status Bar   │ │
  │  │ (age +   │ │ Provider │ │ (queue count)│ │
  │  │ refresh) │ │ + Stack  │ │              │ │
  │  └──────────┘ └──────────┘ └──────────────┘ │
  │  ┌──────────────────────────────────────┐    │
  │  │ useData (enhanced: failure tracking, │    │
  │  │ cursor restoration, stale detection) │    │
  │  └──────────────────────────────────────┘    │
  └─────────────────────────────────────────────┘

Phase 2: Config schema v3 + new CLI commands
  ~/.config/hog/config.json
  ├── version: 3
  ├── ticktick: { enabled: boolean }
  ├── profiles: { work: BoardConfig, personal: BoardConfig }
  ├── defaultProfile: "work"
  └── repos: RepoConfig[]  (per-profile)

Phase 3: Bundled for distribution
  @hog-cli/hog (npm)
  ├── dist/cli.js (tsup bundle, #!/usr/bin/env node)
  ├── dist/fetch-worker.js (separate worker entry)
  ├── README.md
  └── .github/workflows/{ci,publish}.yml
```

## Technical Approach

### Implementation Phases

---

#### Phase 1: Async UX Overhaul

**Goal:** Every background operation gives clear, honest feedback. The user always knows what's happening.

##### 1.1 Toast/Notification System

**New files:**
- `hog/src/board/hooks/use-toast.ts` — Toast state management hook
- `hog/src/board/components/toast-container.tsx` — Renders toast stack

**Design decisions:**
- **Stack model**: Show up to 3 toasts simultaneously, newest at bottom. Older toasts pushed up. 4th toast dismisses oldest.
- **Toast types**: `info` (cyan), `success` (green), `error` (red, persistent until dismissed), `loading` (cyan, spinner prefix, no auto-dismiss)
- **Auto-dismiss**: Success/info dismiss after 3s. Errors persist with `[d]ismiss` / `[r]etry` hints. Loading toasts clear when operation completes.
- **Bulk operations**: Single summary toast (e.g., "Assigned 8 issues, 2 failed") not individual toasts per item.

```typescript
// hog/src/board/hooks/use-toast.ts
interface Toast {
  id: string;
  type: "info" | "success" | "error" | "loading";
  message: string;
  /** For loading toasts — call to resolve/reject */
  resolve?: (result: { type: "success" | "error"; message: string }) => void;
  createdAt: number;
}

interface UseToastResult {
  toasts: Toast[];
  toast: {
    info: (message: string) => void;
    success: (message: string) => void;
    error: (message: string, retry?: () => void) => void;
    loading: (message: string) => { resolve: (msg: string) => void; reject: (msg: string) => void };
  };
  dismiss: (id: string) => void;
  dismissAll: () => void;
}
```

**Migration path:** Replace all `showStatus(text, color)` calls in `use-actions.ts` with `toast.*` calls. Remove `statusMessage` state from Dashboard. The status bar remains for persistent info (queue count, refresh age).

- [x] Create `use-toast.ts` hook with queue management (max 3 visible)
- [x] Create `toast-container.tsx` component (positioned above status bar)
- [x] Migrate `handlePick` → `toast.loading()` / `toast.success()` / `toast.error()`
- [x] Migrate `handleComment`, `handleAssign`, `handleUnassign` similarly
- [x] Migrate `handleStatusChange` (loading → success/error)
- [x] Migrate `handleCreateIssue`
- [x] Migrate bulk actions to summary toasts
- [x] Add `[r]etry` action on error toasts (re-trigger original operation)
- [x] Remove `statusMessage` / `showStatus` from Dashboard
- [x] Tests: `use-toast.test.ts` — queue limits, auto-dismiss, error persistence, bulk summaries

##### 1.2 Refresh Feedback & Stale Data

**Modified files:**
- `hog/src/board/hooks/use-data.ts` — Add failure tracking, stale detection
- `hog/src/board/components/dashboard.tsx` — Header age indicator, color degradation

**Constants** (in `use-data.ts` or shared constants file):
```typescript
const STALE_THRESHOLDS = {
  FRESH: 60_000,        // 0-60s → green
  AGING: 300_000,       // 60s-5m → yellow
  // 5m+ → red
} as const;

const MAX_REFRESH_FAILURES = 3; // Pause auto-refresh after 3 consecutive failures
```

**Behavior:**
- Header always shows: `"Updated Xs/Xm/Xh ago"` with color: green (< 1m), yellow (1-5m), red (> 5m)
- During refresh: spinner + "Refreshing..." replaces age text
- After refresh failure: age text shows but with `(!)` failure badge
- After 3 consecutive failures: `"Auto-refresh paused"` warning in header. Manual `r` resets counter.
- `R` (Shift+R): Force refresh (identical to `r` but also clears failure counter explicitly)
- If `refreshInterval: 0` in config (disabled): age indicator shows but no color degradation, no auto-refresh failure tracking

**Enhanced `useData()` state:**
```typescript
interface DataState {
  // ... existing fields
  consecutiveFailures: number;
  autoRefreshPaused: boolean;
}
```

- [x] Track `consecutiveFailures` in `useData` — increment on worker error, reset on success
- [x] Pause auto-refresh after `MAX_REFRESH_FAILURES` consecutive failures
- [x] Compute `refreshAge` from `lastRefresh` timestamp (re-render every 10s via interval)
- [x] Compute `refreshAgeColor` from thresholds: green/yellow/red
- [x] Show failure badge `(!)` when `consecutiveFailures > 0 && !isRefreshing`
- [x] Show `"Auto-refresh paused — press r to retry"` when paused
- [x] Resume auto-refresh on successful manual refresh
- [x] Bind `R` (Shift+R) as alias for `r` (force refresh)
- [x] Tests: `use-data.test.tsx` — failure counter, pause/resume, age color transitions

##### 1.3 Navigation Stability During Async

**Modified files:**
- `hog/src/board/hooks/use-navigation.ts` — Cursor restoration after refresh
- `hog/src/board/components/dashboard.tsx` — Handle disappearing items

**Cursor restoration logic:**
1. Before refresh: store current `navId`
2. After refresh: find item with same `navId` in new data
3. If found: set cursor to that index, adjust scroll
4. If not found (issue closed/moved to terminal status): move cursor to next item in same section. If section empty, move to previous section header.
5. If multi-select active and some selected items disappear: keep valid subset, clear invalid IDs

**Implementation:**
- `useData()` already tracks `navId` — navigation hook uses it
- Add `onDataUpdate` callback that runs after worker message received
- In callback: scan flattened rows for matching `navId`, adjust cursor index

- [x] Add cursor restoration in `useData` / `useNavigation` after worker data update
- [x] Handle navId disappearance: fallback to next item, then section header
- [x] Clean up multi-select set on data update (remove stale IDs)
- [x] Tests: cursor restoration when item moves sections, item disappears, section collapses

##### 1.4 Phase 1 Quality Gates

- [x] All existing tests pass (`npm run ci`) — 178/178 pass, 0 type errors
- [x] New test coverage for toast hook, refresh feedback, cursor restoration
- [ ] Manual smoke test: rapid actions, network failures (disconnect WiFi), long-running board session (30m+)
- [x] No regressions in keyboard navigation

---

#### Phase 2: Configurability

**Goal:** Anyone with a GitHub account can use hog without code changes. TickTick is optional. Multiple boards for different contexts.

##### 2.1 TickTick Optional

**Modified files:**
- `hog/src/config.ts` — Add `ticktick.enabled` field, schema v3 migration
- `hog/src/board/fetch.ts` — Conditionally skip TickTick fetch
- `hog/src/cli.ts` — Add `hog config ticktick:enable` / `ticktick:disable` commands
- `hog/src/board/components/dashboard.tsx` — Conditionally hide TickTick section

**Config schema change:**
```typescript
// In HOG_CONFIG_SCHEMA (Zod)
ticktick: z.object({
  enabled: z.boolean().default(true),
}).default({ enabled: true }),
```

**Migration v2 → v3:**
- Add `ticktick: { enabled: true }` to existing configs (preserves current behavior)
- If auth.json exists, `enabled: true`. If not, `enabled: false`.

**Behavior:**
- `ticktick.enabled: false` → No auth check, no API calls, no TickTick section in board, `hog task` commands still work if auth present
- `ticktick.enabled: true` + no auth → Board shows "TickTick not configured" section with `hog init` hint
- Re-enabling after disable: uses existing auth.json if present, otherwise prompts re-auth

- [x] Add `ticktick` field to config schema (Zod)
- [x] V2 → V3 migration: infer `ticktick.enabled` from auth.json presence
- [x] Update `fetchDashboard()` to skip TickTick when disabled
- [x] Add `hog config ticktick:enable` / `ticktick:disable` CLI commands
- [x] Update Dashboard to conditionally render TickTick section
- [x] Tests: fetch with TickTick disabled, config migration, CLI commands

##### 2.2 Board Profiles

**Modified files:**
- `hog/src/config.ts` — Add profiles to schema
- `hog/src/cli.ts` — Add `--profile` flag, profile management commands
- `hog/src/board/fetch.ts` — Accept profile-specific config
- `hog/src/board/live.tsx` — Pass resolved profile to Dashboard

**Config structure (single file, nested):**
```typescript
// Extended HogConfig
profiles: z.record(z.string(), z.object({
  repos: z.array(REPO_CONFIG_SCHEMA),
  board: BOARD_CONFIG_SCHEMA,
  ticktick: z.object({ enabled: z.boolean() }).default({ enabled: true }),
})).default({}),

defaultProfile: z.string().optional(),
```

**Behavior:**
- `hog board` → uses `defaultProfile` if set, otherwise uses top-level `repos`/`board` config (backward compat)
- `hog board --profile work` → uses `profiles.work` config
- Profile creation: `hog config profile:create <name>` (copies current top-level config as starting point)
- Profile deletion: `hog config profile:delete <name>`
- Set default: `hog config profile:default <name>`
- Profiles can share repos (same repo in multiple profiles is fine)
- No live profile switching — requires board restart

**Migration:**
- V3 config without profiles: top-level `repos`/`board` used (no migration needed)
- When user creates first profile: existing top-level config preserved as "default" profile

- [x] Extend config schema with `profiles` and `defaultProfile`
- [x] Add profile resolution logic: `--profile` flag > `defaultProfile` > top-level config
- [x] Add `hog config profile:create`, `profile:delete`, `profile:default` commands
- [x] Thread resolved profile config through `fetchDashboard()` and `live.tsx`
- [x] Show active profile name in board header
- [x] Tests: profile resolution, creation, deletion, backward compatibility

##### 2.3 Flexible Status Mapping

**Modified files:**
- `hog/src/config.ts` — Add `statusGroups` to repo config
- `hog/src/board/fetch.ts` — Use configured or auto-detected status groups
- `hog/src/board/components/dashboard.tsx` — Render dynamic status sections

**Config schema:**
```typescript
// In REPO_CONFIG_SCHEMA
statusGroups: z.array(z.string()).optional(),
// e.g., ["Todo,Backlog", "In Progress", "In Review", "Done,Shipped"]
// Each string is a comma-separated list of statuses that group into one section
// Section header = first status name in the group
```

**Behavior:**
- If `statusGroups` not set: auto-detect from GitHub Project (current behavior — terminal statuses hidden, "Backlog" last)
- If set: group issues by configured sections, in configured order
- Terminal status regex still applies for "completed" indicator regardless of grouping
- Status options are fetched once per board session and cached (refreshed on manual `r`)

- [x] Add optional `statusGroups` to repo config schema
- [x] Implement status group resolution: configured > auto-detected
- [x] Update section rendering to use resolved groups
- [x] Cache status options per session (already cached via worker thread fetch cycle)
- [x] Tests: custom status groups, auto-detection fallback, mixed repos

##### 2.4 Guided Setup — `hog init` Wizard

**New files:**
- `hog/src/init.ts` — Interactive setup wizard

**Dependencies:** `@inquirer/prompts` (or `inquirer`) for interactive prompts

**Wizard flow:**
1. **Check prerequisites**: `gh auth status` → If not authenticated, print instructions and exit
2. **Detect GitHub user**: `gh api user` → extract login for `board.assignee`
3. **Select repos**: `gh repo list --json name,owner --limit 100` → multi-select picker
4. **For each repo**: Detect projects → select project → auto-detect status field ID
5. **TickTick**: "Enable TickTick integration? (y/n)" → If yes, run OAuth flow
6. **Board defaults**: Confirm refresh interval (60s), backlog limit (20), focus duration (25m)
7. **Write config**: Atomic write (build full config in memory, write once at end)
8. **Ctrl+C handling**: Clean exit, no partial config written

**Existing config handling:**
- `hog init` with existing config → "Config exists. Overwrite? (y/n)"
- `hog init --force` → Overwrite without prompt

- [x] Add `@inquirer/prompts` dependency
- [x] Implement `hog init` command with wizard flow
- [x] gh CLI integration: detect auth, list repos, detect projects
- [x] Auto-detect project status field ID (find SingleSelect field named "Status")
- [x] Atomic config write (in-memory assembly → single writeFileSync)
- [x] Ctrl+C handler: clean exit
- [x] `--force` flag for non-interactive overwrite
- [x] Tests: wizard steps (mock inquirer prompts), config output validation

##### 2.5 Phase 2 Quality Gates

- [x] All Phase 1 + existing tests pass (199 tests, 16 files, 0 type errors)
- [x] New tests for config v3, profiles, TickTick toggle, wizard (config: 12, init: 6, dashboard status groups: 3)
- [ ] Manual test: fresh install flow (no config) → `hog init` → `hog board`
- [ ] Manual test: existing config migration v2 → v3
- [ ] Manual test: profile switching

---

#### Phase 3: Distribution

**Goal:** `npm install -g @hog-cli/hog && hog init` just works.

##### 3.1 npm Package

**Modified files:**
- `hog/package.json` — Publish config, metadata
- `hog/bin/hog` → `hog/bin/hog.js` — Portable Node shebang
- `hog/tsup.config.ts` — Bundle configuration (new file)

**Package.json additions:**
```json
{
  "name": "@hog-cli/hog",
  "version": "1.0.0",
  "description": "Personal command deck — unified task dashboard for GitHub Projects + TickTick",
  "author": "Ondrej Svec",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/ondrej-svec/hog" },
  "publishConfig": { "access": "public" },
  "bin": { "hog": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=22" }
}
```

**Bundling with tsup:**
- Main entry: `src/cli.ts` → `dist/cli.js` (ESM, with `#!/usr/bin/env node` banner)
- Worker entry: `src/board/fetch-worker.ts` → `dist/fetch-worker.js` (separate file, ESM)
- External: `ink`, `react`, `@inkjs/ui`, `zod`, `commander`, `@inquirer/prompts` (keep as deps, not bundled)
- Target: `node22`
- Source maps: yes (development debugging)

**Worker URL fix:**
- Current: `new URL("../fetch-worker.ts", import.meta.url)` → won't work after bundling
- Fix: `new URL("./fetch-worker.js", import.meta.url)` — tsup outputs both files to `dist/`

- [x] Add `tsup` dev dependency + `tsup.config.ts`
- [x] Configure dual entry points (cli + fetch-worker)
- [x] Replace shell wrapper with `#!/usr/bin/env node` shebang in bundled output
- [x] Fix worker URL to work in bundled context
- [x] Add `publishConfig`, `repository`, `author`, `license`, `description` to package.json
- [x] Verify `npm pack` produces clean tarball
- [ ] Test: install from local tarball, run `hog init` + `hog board`
- [x] Add Node version check at startup: graceful error if < 22

##### 3.2 README

**New file:** `hog/README.md`

**Sections:**
1. **Hero**: One-line description + GIF/screenshot of board in action
2. **Quick Start**: `npm install -g @hog-cli/hog` → `hog init` → `hog board`
3. **Features**: Board, actions (pick/assign/comment/status), focus mode, multi-select, search
4. **Configuration**: Config file reference (`~/.config/hog/config.json`), profiles, TickTick toggle
5. **Commands**: `hog board`, `hog task`, `hog pick`, `hog config`, `hog init`
6. **Requirements**: Node 22+, `gh` CLI authenticated, optional TickTick account
7. **License**: MIT

**Not in README** (for CONTRIBUTING.md later): Architecture, worker threads, Ink internals, test patterns.

- [x] Write README.md with above sections
- [ ] Record terminal GIF of board usage (vhs tape file ready, needs manual recording — Ink alternate screen not captured by vhs)
- [x] Add LICENSE file (MIT)

##### 3.3 CI/CD

**New files:**
- `.github/workflows/ci.yml` — Test + typecheck on PR
- `.github/workflows/publish.yml` — Publish to npm on tagged release

**CI workflow:**
```yaml
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
        working-directory: hog
      - run: npm run ci
        working-directory: hog
```

**Publish workflow:**
```yaml
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: 'https://registry.npmjs.org' }
      - run: npm ci && npm run build
        working-directory: hog
      - run: npm publish --access public
        working-directory: hog
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Changelog:** Use `npx changelogen` or similar — generate from conventional commits on release.

- [x] Create `.github/workflows/ci.yml`
- [x] Create `.github/workflows/publish.yml`
- [ ] Add `NPM_TOKEN` secret to GitHub repo settings
- [ ] Test CI locally with `act` or by pushing a PR
- [x] Test publish flow with dry-run: `npm publish --dry-run`

##### 3.4 Homebrew Tap (Nice-to-Have)

**Deferred.** Can be added after npm publish is stable. Formula wraps `npm install -g @hog-cli/hog`.

##### 3.5 Phase 3 Quality Gates

- [x] `npm pack` produces clean tarball < 5MB (126KB packed, 560KB unpacked)
- [ ] Fresh install on clean machine: `npm install -g` → `hog init` → `hog board` works
- [ ] CI passes on GitHub Actions
- [x] `npm publish --dry-run` succeeds
- [x] README renders correctly on npm and GitHub

---

## Acceptance Criteria

### Functional Requirements

- [ ] **Toast system**: All async operations show toasts (loading → success/error). Errors persist with dismiss/retry hints.
- [ ] **Refresh feedback**: Header always shows data age with color (green/yellow/red). Failure badge visible. Auto-refresh pauses after 3 failures.
- [ ] **Cursor stability**: After refresh, cursor stays on same issue (by navId). Graceful fallback when item disappears.
- [ ] **TickTick optional**: `hog config ticktick:disable` removes all TickTick UI and API calls from board.
- [ ] **Board profiles**: `hog board --profile <name>` loads named config. Default profile configurable.
- [ ] **Status mapping**: Per-repo configurable status groups. Auto-detection fallback.
- [ ] **Guided setup**: `hog init` wizard walks through config with interactive prompts.
- [ ] **npm package**: `npm install -g @hog-cli/hog && hog init && hog board` works on a clean machine with Node 22+.

### Non-Functional Requirements

- [ ] No performance regression: board load time stays under 3s
- [ ] Worker thread data fetch unaffected by new toast/UI features
- [ ] Config migration v2 → v3 is non-destructive (preserves all existing settings)
- [ ] npm package size < 5MB (packed tarball)

### Quality Gates (All Phases)

- [ ] `npm run ci` passes (typecheck + lint + test)
- [ ] Test coverage for all new hooks and components
- [ ] Manual smoke test for each phase before moving to next

## Dependencies & Prerequisites

**Between phases:**
- Phase 2 can start immediately after Phase 1 toast system is done (other 1.x items can finish in parallel)
- Phase 2.4 (`hog init`) depends on 2.1-2.3 being complete (wizard configures all new fields)
- Phase 3.1 (npm package) depends on Phase 2.4 (ship with wizard included)
- Phase 3.2-3.4 can start during Phase 2 (README, CI don't need code changes)

**Parallel-safe work within phases:**
- Phase 1: 1.1 (toast), 1.2 (refresh), 1.3 (navigation) are independent UI changes
- Phase 2: 2.1 (TickTick toggle) and 2.2 (profiles) are independent config changes
- Phase 3: 3.2 (README) and 3.3 (CI/CD) can proceed in parallel with 3.1 (bundling)

**External dependencies:**
- `tsup` — bundler for Phase 3
- `@inquirer/prompts` — interactive prompts for Phase 2.4
- npm account + token for Phase 3.3

## Risk Analysis & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Toast rendering in Ink is limited (no absolute positioning) | Phase 1 design | Medium | Use bottom-anchored stack above status bar. Prototype early. |
| Worker thread bundling with tsup breaks `new URL()` | Phase 3 blocked | Medium | Keep worker as separate entry point. Test bundled output early. |
| `@inquirer/prompts` conflicts with Ink rendering | Phase 2.4 | Low | Wizard runs before Ink (CLI command, not board). No conflict. |
| npm name `hog` already taken | Phase 3 naming | Medium | Use scoped `@hog-cli/hog`. Check availability early. |
| Config migration edge cases | Phase 2 | Low | Write comprehensive migration tests. Default to safe values. |
| Bulk operations overwhelming toast queue | Phase 1 UX | Low | Summary toasts for bulk ops (already specified). |

## Future Considerations

- **YAML config**: If config grows complex, consider YAML migration (human-readable, comments). Not now.
- **Plugin system**: If hog attracts users, plugins for different task managers (Jira, Linear, Asana). Far future.
- **Remote boards**: Shared board configs via URL/gist for team sync. Requires Phase 2 foundation.
- **Homebrew tap**: Add after npm publish is stable and there's user demand.

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-16-hog-polish-and-packaging-brainstorm.md`
- Board Command Center plan: `docs/plans/2026-02-15-feat-hog-board-command-center-plan.md`
- Current status feedback: `hog/src/board/hooks/use-actions.ts` — `showStatus()` pattern
- UI state machine: `hog/src/board/hooks/use-ui-state.ts` — reducer with modes
- Data fetching: `hog/src/board/hooks/use-data.ts` — worker thread, refresh, lastRefresh
- Config schema: `hog/src/config.ts` — Zod schema, v1→v2 migration
- Worker thread: `hog/src/board/fetch-worker.ts` + `hog/src/board/fetch.ts`
- Dashboard component: `hog/src/board/components/dashboard.tsx` (980 lines)
- Test patterns: `hog/src/board/hooks/*.test.tsx` — Vitest + ink-testing-library

### Key Architecture Notes

- **No existing toast/notification system** — `showStatus()` is a simple 3s auto-dismiss in status bar
- **Navigation uses `navId` strings** (e.g., `"gh:owner/repo:123"`) — basis for cursor stability
- **Worker thread sends structured clone** — Dates need manual revival after message
- **Config at `~/.config/hog/config.json`** — JSON format, Zod validated, migration system in place
- **Bin wrapper uses nvm** — must be replaced with portable `#!/usr/bin/env node` for distribution
