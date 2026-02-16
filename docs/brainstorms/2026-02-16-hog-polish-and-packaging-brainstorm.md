# Hog: UX Polish, Configurability & Open-Source Readiness

**Date:** 2026-02-16
**Status:** Brainstorm
**Approach:** UX-first, then configurability, then distribution

---

## What We're Building

A three-phase improvement plan to take `hog` from a personal power tool to a team-ready (and eventually open-sourceable) CLI:

1. **Async UX overhaul** — make background operations feel responsive and transparent
2. **Configurability** — decouple from hardcoded repos, make TickTick optional, support multiple boards
3. **Distribution** — npm publish, README, `hog init` wizard, optional Homebrew tap

The whole tool ships as `hog` (name stays). No component extraction — this is about polishing and packaging the complete CLI.

---

## Why This Approach

**UX first because:**
- Ondrej is the primary user; polish for daily driver experience before exposing to others
- Worker thread infrastructure is in place but the UI doesn't fully leverage it yet
- Battle-tested UX means fewer "it's broken" reports from teammates
- Each phase delivers standalone value (no big-bang release)

**Not extracting hooks because:**
- The hooks are valuable *in context* of hog's board, not as standalone primitives
- Maintenance burden of a separate package isn't worth it for the team size
- The patterns can be copied by others reading the source (open-source benefit)

---

## Phase 1: Async UX Overhaul

### 1.1 Refresh Feedback
**Problem:** The `isRefreshing` spinner exists but is subtle. During worker thread fetch, users can't tell if a refresh is happening, stuck, or failed silently.

**Ideas:**
- **Status bar refresh indicator**: Persistent bottom-bar element showing "Refreshing..." with elapsed time
- **Last refresh timestamp**: Always visible in status bar (e.g., "Updated 2m ago")
- **Refresh failure badge**: If last refresh failed, show a persistent warning that doesn't block navigation
- **Manual refresh feedback**: When pressing `r`, immediate visual acknowledgment before worker starts

### 1.2 Action Feedback
**Problem:** Pick, assign, status change, comment — these fire async operations but feedback is unclear. Optimistic updates exist but error recovery is invisible.

**Ideas:**
- **Toast/notification system**: Transient messages that appear and auto-dismiss (e.g., "Assigned #145 to ondrej")
- **Operation queue indicator**: Show count of in-flight operations (e.g., "[2 ops]" in status bar)
- **Error toast with retry**: Failed operations show actionable error with "r to retry" hint
- **Optimistic rollback animation**: If an optimistic update fails, visually revert with a brief flash

### 1.3 Stale Data Awareness
**Problem:** No way to know if data is 30 seconds old or 5 minutes old. Silent refresh failures make this worse.

**Ideas:**
- **Age indicator in header**: "Updated just now" / "Updated 2m ago" / "Updated 5m ago (stale)"
- **Color degradation**: Header color shifts from green to yellow to red as data ages
- **Auto-refresh failure counter**: After N consecutive failures, show persistent warning
- **Force refresh shortcut**: `R` (shift+r) for force refresh with visual confirmation

### 1.4 Navigation During Async
**Problem:** When operations are in flight, navigation should remain fully responsive (worker thread helps) but state transitions can feel jarring.

**Ideas:**
- **Stable cursor position**: After refresh, cursor stays on the same issue (by ID, not index)
- **Smooth section collapse on refresh**: If sections change, animate transitions rather than jump
- **Lock indicator**: If a destructive action is pending (e.g., bulk assign), show lock icon on affected rows
- **Debounced navigation**: While data is being swapped, buffer navigation inputs and apply after

---

## Phase 2: Configurability

### 2.1 TickTick Optional
**Current:** TickTick is always fetched. If auth fails, it shows an error section.
**Target:** `hog config ticktick:enable` / `hog config ticktick:disable`. When disabled, no TickTick section, no auth required.

### 2.2 Multiple Boards
**Current:** One board with all tracked repos.
**Target:** Named board configurations:
```bash
hog board --profile work     # aibility + amy repos
hog board --profile personal # side project repos
hog board                    # default profile
```

### 2.3 Flexible Status Mapping
**Current:** Status grouping is hardcoded (In Progress, Backlog, Done, etc.).
**Target:** Status groups configurable per-board or auto-detected from GitHub Project fields.

### 2.4 Guided Setup
**Current:** Manual `hog config repos:add` with obscure field IDs.
**Target:** `hog init` wizard that:
1. Detects GitHub auth (`gh auth status`)
2. Lists available repos/projects
3. Walks through board configuration interactively
4. Optionally sets up TickTick

---

## Phase 3: Distribution

### 3.1 npm Package
- Publish as `hog` (or scoped `@hog-cli/hog` if name taken)
- `npm install -g hog` installs the CLI
- Peer dependency: Node 22+ (worker threads, native ESM)
- Bundle with `tsup` or similar for single-file distribution

### 3.2 README
- Quick start (install + `hog init`)
- Feature overview with screenshots/GIFs of the live board
- Configuration reference
- Architecture overview for contributors
- License (MIT or similar)

### 3.3 Homebrew Tap (Nice-to-Have)
- `brew tap ondrejsvec/hog && brew install hog`
- Formula wraps npm install
- Lower priority — npm is the primary channel

### 3.4 CI/CD
- GitHub Actions: test + typecheck on PR
- Auto-publish to npm on tagged release
- Changelog generation from conventional commits

---

## Key Decisions

1. **Whole tool, not components** — ship hog as a complete CLI, not extracted hooks
2. **UX before distribution** — polish first, package second
3. **TickTick is optional** — must work without it for non-TickTick teams
4. **Keep the name "hog"** — Heart of Gold, short, memorable
5. **npm primary, Homebrew secondary** — npm for distribution, brew as nice-to-have
6. **Directional timeline** — no rush, chip away incrementally

---

## Resolved Questions

1. **Notification/toast system**: Separate `<ToastProvider>` / `useToast()` component pattern. Cleaner architecture, reusable across screens.
2. **Board profiles**: Extend existing `~/.config/hog/config.json` for now. Consider YAML migration if config grows complex, but no strong preference either way.
3. **Open-source license**: MIT.
4. **Bundling strategy**: Decide during Phase 3 — implementation detail, not worth locking in now.

5. **Config migration**: Manual re-init (`hog init`) when config schema changes. No auto-migration needed — small user base.

## Open Questions

None — all questions resolved.
