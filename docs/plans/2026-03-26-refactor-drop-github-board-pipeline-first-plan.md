---
title: "refactor: Drop GitHub board, make hog a pipeline-first orchestrator"
type: plan
date: 2026-03-26
status: in_progress
brainstorm: docs/brainstorms/2026-03-21-hog-agent-development-platform-brainstorm.md
related:
  - docs/plans/2026-03-21-feat-agent-development-platform-plan.md
  - docs/plans/2026-03-23-feat-cockpit-v2-plan.md
confidence: high
---

# Drop GitHub Board, Make Hog a Pipeline-First Orchestrator

**One-line summary:** Remove the GitHub Issues dashboard, restructure hog around the pipeline cockpit TUI, make GitHub a configurable sync layer (labels/status on phase changes), and redesign init + config to be pipeline-first.

## Problem Statement

Hog has two identities: a GitHub Issues dashboard (the original product) and an AI pipeline orchestrator (the engine built over the last month). The dashboard is what the README documents; the engine is where the actual differentiation is. No other tool has TDD-enforced, role-separated, Beads-DAG-driven AI development pipelines.

Keeping both creates confusion (what IS hog?), maintenance burden (~25 board-only components/hooks), and a misleading first-run experience (init is 80% GitHub Projects setup for a feature that isn't the point anymore).

**The pivot:** Hog is the pipeline orchestrator. GitHub is one optional integration target. The cockpit TUI shows pipeline status, not issue lists.

## User Stories

These define "done" from the user's perspective, not the engineer's.

### Story A: New User — First Pipeline

> As a developer who just heard about hog, I want to go from `npm install` to watching my first AI pipeline run in under 5 minutes, without needing a GitHub account or any external setup beyond Beads.

**Done when:** `npm install -g @ondrej-svec/hog && hog init --no-github && hog pipeline create "add user auth"` starts agents. The cockpit shows phases advancing. I understand what's happening without reading docs.

**Failure modes to test:**
- Beads not installed → helpful message with install link, not a stack trace
- Node < 22 → clear version error at startup
- No project directory → init asks me to pick one
- Empty project (no tests, no config) → pipeline still starts (stories phase doesn't need existing code)

### Story B: Existing v1 User — The Upgrade

> As someone who has been using `hog board --live` daily, I want to upgrade to v2 and understand immediately what changed, what replaces my workflows, and how to get back to productive within 5 minutes.

**Done when:** `npm update -g @ondrej-svec/hog` installs v2. Running `hog board` prints a clear message explaining the change and what to use instead. My config auto-migrates. `hog cockpit` works. `MIGRATION.md` answers any remaining questions.

**Failure modes to test:**
- `hog board --live` → migration message (not "unknown command")
- `hog pick` → migration message
- `hog issue create` → migration message
- Old v4 config → auto-migrates to v5 with no data loss
- Corrupt config during migration → backup created, helpful error

### Story C: Team Member — GitHub-Connected Pipeline

> As a developer on a team that tracks work in GitHub Projects, I want pipeline phases to automatically update my GitHub issue's labels and status, so my team can see progress without asking me.

**Done when:** `hog pipeline create --issue myorg/repo#42 "implement OAuth"` links the pipeline to issue #42. As phases complete, labels like `phase:stories`, `phase:red`, `phase:green` appear on the issue. When the pipeline completes, the issue is closed. My team sees the progress in their GitHub board without running hog.

**Failure modes to test:**
- GitHub sync fails mid-pipeline → pipeline continues, sync failure logged but not blocking
- Issue doesn't exist → clear error at `pipeline create` time
- No `gh` CLI installed but GitHub sync configured → helpful message
- Rate limit hit → retry with backoff, pipeline not blocked

---

## Proposed Solution

Six phases. Each produces a working hog. The first phase is a TDD safety net — tests before any code changes.

### Design Principles

1. **RED before GREEN** — every fix starts with a failing test. A TDD tool must TDD its own refactor.
2. **Parity gate before deletion** — cockpit must cover every board workflow before board code is removed
3. **Delete before refactor** — removing 25+ files is better than refactoring them
4. **Pipeline state is king** — Beads DAG + pipelines.json is the source of truth, not GitHub
5. **GitHub is a webhook target** — phase changes optionally push to GitHub, but hog doesn't pull from it
6. **Time to first pipeline < 2 min** — `hog init` should get you to `hog pipeline create` fast
7. **Strangler fig, not big bang** — old commands get tombstones, not silent removal

### Relationship to Prior Plans

- **2026-03-21 platform plan** Phase 1 (engine extraction): ✅ complete. Phase 2 (Beads): mostly done (2.4, 2.5 open). Phase 3+ (conductor, TDD, quality gates, refinery): implemented but some wiring gaps.
- **2026-03-23 cockpit v2 plan**: All phases still open. This plan incorporates those fixes as Phase 1.
- **This plan supersedes both** for the board-removal and config-redesign work. The cockpit v2 bug fixes are prerequisite, not superseded.

---

## Phase 0: Test Safety Net (before touching any code)

**Goal:** Establish the tests that make the refactor safe. Write the parity gate, CLI contract tests, and pipeline lifecycle integration test. All failing — they define what "done" looks like before we start.

**Why first:** A TDD tool must TDD its own refactor. Feathers' rule: characterize behavior before changing it. The parity gate is the Phase 1 → Phase 2 handoff criterion.

**Exit criteria:** Three new test files exist. Parity gate tests are failing (cockpit doesn't yet cover all workflows). CLI contract tests define the v2 command surface. Pipeline lifecycle test defines the end-to-end happy path.

### Tasks

- [x] **0.1 Write parity gate test — `src/board/__migration__/parity-gate.test.tsx`**
  This file gates Phase 2. Every board workflow that users depend on must have a cockpit equivalent. Phase 1 makes these pass. Phase 2 can only start when they're all green.
  ```
  Parity checklist (all initially failing):
  - Users can start a pipeline (replaces: pick an issue)
  - Users can see pipeline progress with real percentages (replaces: issue status view)
  - Users can answer decisions inline via keyboard (replaces: comment input)
  - Users can see agent failures with phase + error detail (replaces: issue error states)
  - Users can pause/resume pipelines (replaces: status change)
  - Users can attach to agent tmux session (replaces: launch claude from issue)
  - Help overlay shows pipeline-only keybindings (replaces: board help)
  - Empty state shows guidance ("no pipelines, press n") (replaces: empty board)
  ```

- [x] **0.2 Write CLI contract tests — `src/cli-contract.test.ts`**
  Defines the v2 command surface. Tests Commander.js command registration, not execution.
  ```
  Commands that must exist:
  - cockpit (new primary TUI)
  - pipeline create/list/status/pause/resume/cancel/done/watch/init/clear
  - decisions (--resolve)
  - beads status/start/stop
  - config get/set/list/edit
  - init
  - launch

  Tombstoned commands (must exist, print migration message, exit 0):
  - board → "hog board was removed in v2.0. Use: hog cockpit"
  - pick → "hog pick was removed in v2.0. Use: hog pipeline create --issue <ref>"
  - issue → "hog issue was removed in v2.0. GitHub is now a sync target."
  - task → "hog task was removed in v2.0."
  - sync → "hog sync was removed in v2.0."
  ```

- [x] **0.3 Write pipeline lifecycle integration test — `src/engine/pipeline-lifecycle.integration.test.ts`**
  End-to-end happy path with mocked BeadsClient and AgentManager.
  ```
  Create conductor with mocked deps
  → startPipeline("Add auth", "implement OAuth flow")
  → verify DAG created with 6 beads
  → tick() → stories agent spawned
  → emit agent:completed for stories → tick()
  → verify test agent spawned (not impl — test comes first)
  → emit agent:completed for test → tick()
  → verify RED state checked before impl spawns
  → continue through redteam, merge
  → verify pipeline status === "completed"
  → verify pipelines.json written correctly at each step
  ```
  Timeout: 10s. This catches the data flow bugs that Phase 1 fixes.

- [x] **0.4 Audit `fetch-loop.ts` dependency on `board/fetch.ts`**
  `src/engine/fetch-loop.ts` imports `fetchDashboard` from `src/board/fetch.ts`. When Phase 2 deletes `fetch.ts`, this breaks. Decision: either DROP `fetch-loop.ts` (pipeline doesn't need GitHub fetching) or EXTRACT the minimal fetch logic the engine needs.

- [x] **0.5 Map all cross-boundary imports**
  Run: `grep -rn "from.*board/" src/engine/ && grep -rn "from.*engine/" src/board/`
  Document every import that crosses the board↔engine boundary. These are the seams Phase 2 must cut cleanly.

### Risks
- Writing tests for code that doesn't exist yet (parity gate) means they'll fail for a while. This is intentional — they're the specification, not a regression suite. Mark them with `it.todo()` or `it.skip()` until Phase 1 implements the feature.

---

## Phase 1: Fix the Pipeline Cockpit (RED→GREEN for each bug)

**Goal:** The cockpit TUI is functional and reliable. Users can create, monitor, and interact with pipelines without touching the issues view. Every parity gate test passes.

**Why second:** Can't remove the board if the pipeline view is broken. These are the cockpit v2 Phase 1 bugs.

**Exit criteria:** All parity gate tests pass. Pipeline lifecycle integration test passes. A pipeline created via the cockpit auto-advances through all 6 phases.

### Tasks

Each task is a RED→GREEN pair. Write the failing test first, then fix the code.

- [x] **1.1 RED: Test that conductor tick loop runs when cockpit mounts**
  Write a test in `use-pipeline-data.test.ts` that verifies the conductor is started (or the watcher process is spawned) when the hook mounts. Currently this test will fail — the conductor is never started.
  **GREEN: Fix conductor.start() not called in usePipelineData**
  The orchestration loop never runs from the TUI cockpit. The watcher process works (spawned by `pipeline create` CLI), but the TUI's own conductor is inert.
  File: `src/board/hooks/use-pipeline-data.ts`
  Note: The TUI cockpit should be read-only — poll pipelines.json, not run its own conductor. If a watcher is already running, don't spawn a second. The fix may be "ensure watcher spawns on pipeline start from cockpit" rather than "call conductor.start() in React."

- [x] **1.2 Already implemented: blocked pipeline resumes after question is resolved**
  Write a conductor test: create pipeline → block it with a question → resolve question → tick() → verify status is "running" again. Currently fails — blocked pipelines stay blocked.
  **GREEN: Fix blocked pipelines never unblocking**
  In `conductor.tick()`, check blocked pipelines for resolved questions → set status back to `"running"`.
  File: `src/engine/conductor.ts`

- [x] **1.3 Already implemented: sessionToPipeline Map wired correctly**
  Write a conductor test: start 2 pipelines → spawn agents for both → complete agent for pipeline B → verify pipeline A's bead is NOT closed. Currently may fail if sessionToPipeline isn't wired correctly.
  **GREEN: Fix agent→pipeline mapping**
  Verify `sessionToPipeline` Map is used in `onAgentCompleted`. If not, wire it.
  File: `src/engine/conductor.ts`

- [ ] **1.4 TODO: Wire D key decision answering in cockpit**
  Write a cockpit interaction test: render cockpit with a blocked pipeline → press D → press 1 → verify decision resolved and pipeline unblocked. Currently fails — decision answering not wired.
  **GREEN: Wire decision answering (D key + number keys)**
  Wire `D` to enter decision mode, `1-9` for quick answers, text input for custom answers. Call `conductor.resolveQuestion()`.
  File: `src/board/components/pipeline-view.tsx`, `src/board/hooks/use-pipeline-data.ts`

- [x] **1.5 Already passing: progress bar shows real percentage from completedBeads/6**
  Write a cockpit render test: pass pipeline with 3/6 beads closed → verify progress shows "50%" or 3/6. Currently fails — hardcoded to 0.4.
  **GREEN: Connect progress bar to real bead status**
  Poll bead statuses, calculate `closedBeads / totalBeads`.
  File: `src/board/components/pipeline-view.tsx`

- [x] **1.6 Already implemented: Esc handler in start-pipeline-overlay.tsx:19-22**
  Write a cockpit interaction test: open overlay → press Esc → verify mode returns to normal. Currently fails.
  **GREEN: Fix Esc in start pipeline overlay**
  Add Esc handling in the overlay's own `useInput` handler.
  File: `src/board/components/start-pipeline-overlay.tsx`

- [x] **1.7 Already implemented: title extracted at dashboard.tsx:1477-1480**
  Write a conductor test: startPipeline with a 200-char description → verify pipeline.title ≤ 60 chars and pipeline.description is the full text. Currently fails — both are identical.
  **GREEN: Fix title vs description duplication**
  Extract first 60 chars as title, full text as description.
  File: `src/board/hooks/use-pipeline-data.ts` or `src/engine/conductor.ts`

- [x] **1.8 Parity gate: 8/9 pass, 1 todo (decision answering — deferred to cockpit.tsx)**
  Un-skip each `parity-gate.test.tsx` test as the corresponding feature is implemented. All 8 parity checks must be green before proceeding to Phase 2.

- [x] **1.9 Pipeline lifecycle integration test: all 4 tests pass**
  The Phase 0.3 integration test should now pass end-to-end with the conductor fixes.

### Risks
- Conductor.start() in the TUI may cause dual-conductor issues if a watcher process is also running. Mitigate: the TUI cockpit should be read-only for pipeline state (poll pipelines.json), not run its own conductor. The existing watcher architecture is correct — TUI polls disk, watcher writes it.

---

## Phase 2: Remove the GitHub Board

**Goal:** Delete all GitHub-board-specific code. The `hog board --live` command becomes a tombstone. `hog cockpit` is the primary TUI.

**Why third:** Phase 0 established the safety net. Phase 1 made the cockpit work. All parity gate tests are green. Now we can safely delete.

**Gate:** All parity gate tests from Phase 0.1 MUST be passing. Do not proceed if any are failing.

**Exit criteria:** `hog cockpit` opens the pipeline TUI. Tombstoned commands print migration messages. ~25 files deleted. CLI surface halved. Coverage delta accounted for.

### Tasks

- [ ] **2.0 Add command tombstones to cli.ts**
  Before deleting any code, add tombstone commands that print migration messages and exit 0:
  ```
  hog board → "hog board was removed in v2.0. Use: hog cockpit"
  hog pick  → "hog pick was removed in v2.0. Start pipelines: hog pipeline create --issue <ref>"
  hog issue → "hog issue was removed in v2.0. GitHub integration: see hog init --help"
  hog task  → "hog task was removed in v2.0."
  hog sync  → "hog sync was removed in v2.0."
  ```
  These satisfy the CLI contract tests from Phase 0.2. The tombstones STAY in v2.0 — they're the migration UX for Story B users.

- [ ] **2.1 Create `cockpit.tsx` — the new entry component**
  Replace the 1,650-line `dashboard.tsx` with a ~200-line cockpit that renders:
  - `PipelineView` (existing)
  - `StartPipelineOverlay` (existing)
  - `ToastContainer`, `ConfirmPrompt`, `HelpOverlay` (generic, keep)
  - Zen mode tmux pane (keep)
  Initializes only: `usePipelineData`, `useToast`, `useZenMode`, `useViewportScroll`, pruned `useUiState`.
  File: new `src/board/components/cockpit.tsx`

- [ ] **2.2 Prune `use-ui-state.ts` to pipeline-only modes**
  Remove: `overlay:status`, `overlay:create`, `overlay:label`, `overlay:bulkAction`, `overlay:confirmPick`, `overlay:editIssue`, `overlay:detail`, `overlay:nlCreate`, `overlay:triage`, `overlay:nudge`, `multiSelect`, `focus`.
  Keep: `normal`, `zen`, `overlay:startPipeline`, `overlay:confirm`, `overlay:workflow`, `help`, `search` (for pipeline filtering).
  File: `src/board/hooks/use-ui-state.ts`

- [ ] **2.3 Rewrite `help-overlay.tsx` for pipeline keybindings**
  Remove all GitHub board shortcuts. Add pipeline shortcuts: `n` (new pipeline), `D` (decisions), `Z` (zen/tmux), `p`/`r` (pause/resume), `?` (help), `q` (quit).
  File: `src/board/components/help-overlay.tsx`

- [ ] **2.4 Update `live.tsx` to render Cockpit instead of Dashboard**
  Swap `<Dashboard>` for `<Cockpit>`. Keep error boundary wrapper.
  File: `src/board/live.tsx`

- [ ] **2.5 Run coverage baseline**
  `npm run test:coverage` BEFORE any deletion. Save the report. This is the baseline for comparing after deletion.

- [ ] **2.6 Delete GitHub-board-only components (17 files)**
  Delete: `dashboard.tsx`, `issue-row.tsx`, `row-renderer.tsx`, `detail-panel.tsx`, `activity-panel.tsx`, `repos-panel.tsx`, `statuses-panel.tsx`, `status-picker.tsx`, `create-issue-form.tsx`, `edit-issue-overlay.tsx`, `nl-create-overlay.tsx`, `comment-input.tsx`, `label-picker.tsx`, `bulk-action-menu.tsx`, `fuzzy-picker.tsx`, `triage-overlay.tsx`, `nudge-overlay.tsx`, `overlay-renderer.tsx`.

- [ ] **2.7 Delete GitHub-board-only hooks (7 files)**
  Delete: `use-data.ts`, `use-navigation.ts`, `use-actions.ts`, `use-multi-select.ts`, `use-auto-status.ts`, `use-nudges.ts`, `use-action-log.ts`.

- [ ] **2.8 Delete board data layer (6 files)**
  Delete: `fetch.ts`, `fetch-worker.ts`, `board-tree.ts`, `board-utils.ts`, `format-static.ts`, `editor.ts`.

- [ ] **2.9 Delete corresponding test files**
  Every deleted source file that has a `.test.ts(x)` companion — delete the test too.

- [ ] **2.10 Resolve `fetch-loop.ts` dependency (from Phase 0.4)**
  Apply the decision made in Phase 0.4 — either drop `fetch-loop.ts` or extract the minimal fetch logic.

- [ ] **2.11 Slim `src/cli.ts` — remove board and issue command implementations**
  Remove the implementation code for: `board` (the full board rendering path), `pick`, all `issue` subcommands, `task` subcommands. The tombstone commands from 2.0 stay.
  Keep: `pipeline *`, `decisions`, `beads *`, `launch`, `config *`, `init`, `cockpit` (new).
  Target: ~2,569 lines → ~1,200 lines.

- [ ] **2.12 Slim `src/github.ts` — keep only sync-relevant functions**
  Keep (8 functions): `updateProjectItemStatusAsync`, `addLabelAsync`, `removeLabelAsync`, `closeIssueAsync`, `createIssueAsync`, `fetchProjectStatusOptions`, `fetchIssueAsync`, `addCommentAsync`.
  Delete everything else: all sync fetchers, bulk operations, edit functions, label fetching, comment fetching, project enrichment.
  File: `src/github.ts`

- [ ] **2.13 Delete `src/pick.ts` and review `src/output.ts`**
  `pick.ts` is GitHub-board-specific. Review `output.ts` for board-only helpers to remove.

- [ ] **2.14 Run `npm run ci` — everything must pass**
  TypeScript compilation, Biome lint, all remaining tests. Fix broken imports.

- [ ] **2.15 Run coverage delta check**
  `npm run test:coverage` AFTER deletion. Compare with Phase 2.5 baseline. Verify the coverage delta is accounted for — deleted code should only reduce coverage in board-specific paths, not engine paths. If engine coverage dropped, a deleted test was covering engine code and needs replacement.

- [ ] **2.16 Delete parity gate test file**
  `src/board/__migration__/parity-gate.test.tsx` has served its purpose. The parity it verified is now permanent — the board code is gone, only the cockpit remains.

### Decision Rationale
- **Tombstones over silent removal**: v1 users running old commands get guidance, not confusion. Tombstones cost ~5 lines each and are the migration UX for Story B.
- **Delete over extract-to-package**: The board code is tightly coupled to hog's config schema and github.ts. Extracting it as a separate package would require significant interface work for something we're actively moving away from. Git history preserves it if needed.
- **Rename to `hog cockpit`**: Clearer intent than `hog board --live`. The "board" metaphor is GitHub-centric. "Cockpit" signals pipeline monitoring.

### Risks
- **Breakage surface**: Deleting 27+ files at once will break imports everywhere. Mitigate: do 2.6–2.9 in one commit, then fix all broken imports in the next. TypeScript compiler will catch everything.
- **Coverage loss**: Deleting board tests might silently drop engine coverage. Mitigate: Phase 2.5 and 2.15 bracket the deletion with coverage snapshots.

---

## Phase 3: Config Redesign & New Init

**Goal:** Config is pipeline-first. Init gets you to a working pipeline in <2 minutes. GitHub is an optional step. Migration from v4 is safe and visible.

**Why fourth:** The code deletion in Phase 2 removes the consumers of the old config fields. Now we can reshape the schema without breaking existing code.

**Exit criteria:** `hog init` asks about pipeline setup first, GitHub second. Config schema has `pipeline` as the primary section. `hog config migrate` shows what changed. Migration from v4 → v5 works with no data loss.

### Tasks

- [ ] **3.1 RED: Write v4 → v5 migration tests with real config snapshots**
  Before writing any migration code, capture 3-4 real-world v4 configs as test fixtures:
  - Minimal (1 repo, no workflow)
  - Full (3 repos, workflow template, profiles)
  - GitHub-heavy (autoStatus, dueDateField, statusGroups, completionAction variants)
  - Edge case (empty repos array, missing optional fields)
  Write tests that assert: every v4 field maps to the correct v5 location. No data lost. Idempotent (migrating twice produces same result).

- [ ] **3.2 Design new config schema (v5)**
  ```
  version: 5
  pipeline:
    owner: string                              # was board.assignee
    maxConcurrentAgents: number                # was board.workflow.maxConcurrentAgents
    launchMode: "auto" | "tmux" | "terminal"   # was board.claudeLaunchMode
    terminalApp?: string                       # was board.claudeTerminalApp
    claudeStartCommand?: { command, extraArgs }
    claudePrompt?: string
    tddEnforcement: boolean                    # new, default true
    phases: string[]                           # was board.workflow.defaultPhases
    phasePrompts?: Record<string, string>
    qualityGates?: { linting: boolean, security: boolean, abusePatterns: boolean }
    notifications?: { os: boolean, sound: boolean }

  projects:                                    # was repos — renamed for clarity
    - name: string                             # owner/repo
      shortName: string
      localPath: string                        # now required
      claudeStartCommand?: ...
      claudePrompt?: string
      workflow?: WorkflowConfig
      github?:                                 # entire block optional
        projectNumber: number
        statusFieldId: string
        completionAction: CompletionAction
        phaseToLabel?: Record<PipelineRole, string>
        phaseToStatus?: Record<PipelineRole, string>
        createIssueOnStart?: boolean
        syncComments?: boolean                 # post phase completion as issue comments

  profiles?: Record<string, ProfileConfig>
  defaultProfile?: string
  ```

- [ ] **3.3 GREEN: Write v4 → v5 migration**
  Map `board.assignee` → `pipeline.owner`, `board.workflow.*` → `pipeline.*`, `repos` → `projects` with `github` block populated from existing fields. All existing GitHub config becomes `projects[].github`. Backup original config before overwriting.
  The migration tests from 3.1 must now pass.

- [ ] **3.4 Add `hog config migrate` command with `--dry-run`**
  Explicit migration command that:
  - `--dry-run`: prints what would change, doesn't write
  - Without flag: backs up config, migrates, prints diff
  - Idempotent: running twice produces no changes
  This is the migration UX for Story B users who want to understand what changed.

- [ ] **3.5 Update all config consumers**
  Engine, conductor, agent-manager, roles, quality-gates, beads — update all `config.board.*` and `config.repos` references to new paths. TypeScript compiler will catch every broken reference.

- [ ] **3.6 RED: Write init flow tests**
  Test the new init wizard paths:
  - `--no-github` path: only pipeline questions asked, no gh CLI calls
  - With GitHub: all 9 steps complete, config written correctly
  - Beads not installed: helpful message, exit 1
  - Existing config: overwrite confirmation prompt

- [ ] **3.7 GREEN: Rewrite `hog init` — pipeline-first wizard**
  New flow:
  1. "What's your name/username?" → `pipeline.owner`
  2. "Select project directory" → auto-detect repo name, set `projects[0].localPath`
  3. "Is Beads (`bd`) installed?" → check, link to install if not
  4. "How should hog launch agents?" → `pipeline.launchMode`
  5. "Enable TDD enforcement?" → `pipeline.tddEnforcement` (default yes)
  6. "Workflow template?" → full/minimal/none → populate `pipeline.phases` + `pipeline.phasePrompts`
  7. "Connect to GitHub?" (optional) → if yes:
     a. Check `gh auth status`
     b. "Which GitHub Project?" → `projects[0].github.projectNumber`
     c. Auto-detect status field → `projects[0].github.statusFieldId`
     d. "Map phases to labels?" → `projects[0].github.phaseToLabel`
     e. "Map phases to statuses?" → `projects[0].github.phaseToStatus`
     f. "Create GitHub issue when starting pipeline?" → `projects[0].github.createIssueOnStart`
  8. "OpenRouter API key?" (optional) → `auth.json`
  9. Write config + run `bd init` in project directory

- [ ] **3.8 Add `--no-github` flag to init**
  Skip GitHub setup entirely. For users who just want pipelines.

- [ ] **3.9 E2E: Validate init → pipeline create flow**
  Integration test (not manual): fresh temp dir → programmatic init with mocked prompts → verify config written → verify `pipeline create` succeeds with that config.

### Decision Rationale
- **`projects` over `repos`**: "Repo" implies GitHub. "Project" is neutral — it's a directory with code. The GitHub integration is a property OF the project, not the project itself.
- **`pipeline.owner` over `pipeline.username`**: "Owner" is what Beads uses. Avoids confusion with GitHub username (which may differ).
- **`tddEnforcement` as a config flag**: Currently hardcoded on. Some users may want to disable it for prototyping. Default true preserves the opinionated stance.
- **Explicit `hog config migrate`**: Silent migration-on-load is fine for minor versions. v4→v5 is a major breaking change — users deserve to see what changed before it happens.

### Risks
- **Migration correctness**: v4 → v5 must not lose any existing config. Mitigate: tests written FIRST with real config snapshots (3.1 before 3.3).
- **Engine consumer updates**: Many files reference `config.board.*`. Mitigate: TypeScript compiler will catch every broken reference after schema change.

---

## Phase 4: Build GitHub Sync Bridge

**Goal:** Pipeline phase transitions optionally update GitHub issue labels and status. Pipelines can be started from a GitHub issue.

**Why fifth:** Requires the new config schema (Phase 3) to know WHAT to sync. The pipeline must work without GitHub first.

**Exit criteria:** When a pipeline phase completes, the linked GitHub issue's labels/status update per config. `hog pipeline create --issue owner/repo#123` links to an existing issue. All sync failures are logged, never blocking.

### Tasks

- [ ] **4.1 RED: Write github-sync tests before implementation**
  Unit tests with mocked github.ts functions:
  ```
  - onPhaseCompleted("stories") → addLabel("phase:stories"), removeLabel("phase:brainstorm")
  - onPhaseCompleted("test") → updateProjectItemStatus("In Progress")
  - onPhaseCompleted("merge") → closeIssue() (completion action)
  - onPhaseCompleted with no linked issue → no GitHub calls
  - onPhaseCompleted with no github config → no GitHub calls
  - addLabel fails → error logged, pipeline not blocked
  - updateProjectItemStatus fails → error logged, pipeline not blocked
  ```

- [ ] **4.2 GREEN: Build `src/engine/github-sync.ts` — the sync bridge**
  Listens to conductor events and calls github.ts:
  ```
  onPhaseCompleted(pipeline, phase):
    if pipeline has linked GitHub issue:
      if config.phaseToLabel[phase] → addLabel(issue, label), remove previous phase label
      if config.phaseToStatus[phase] → updateProjectItemStatus(issue, status)
    if phase === "merge" → trigger completionAction (close issue / add label)
  ```
  Pure function, no state — just maps events to GitHub API calls. All errors caught and logged, never blocking.

- [ ] **4.3 Wire github-sync into Conductor**
  In `conductor.onAgentCompleted()`, after closing the bead, call `githubSync.onPhaseCompleted()` if the pipeline has a linked issue. Only if `projects[].github` config exists.

- [ ] **4.4 Wire `beads-sync.ts` for issue linking**
  The `linkIssueToBead` and `findGitHubIssue` functions exist but are never called. Wire them:
  - `hog pipeline create --issue owner/repo#123` → `linkIssueToBead(featureId, repo, issueNumber)`
  - `hog pipeline create "title" --create-issue` → `createIssueAsync(repo, title)` → `linkIssueToBead(featureId, repo, newIssueNumber)`
  File: `src/engine/beads-sync.ts`, `src/cli.ts`

- [ ] **4.5 Add `--issue` and `--create-issue` flags to `pipeline create`**
  `--issue <ref>`: parse `owner/repo#123` format, fetch issue context, link to pipeline.
  `--create-issue`: create a new GitHub issue with the pipeline title, link it.
  Both store the mapping in beads-sync.json.
  File: `src/cli.ts`

- [ ] **4.6 Optional phase-completion comments**
  If `projects[].github.syncComments` is true, post a comment on the GitHub issue when each phase completes: "Phase `test` completed. 8 tests written, all failing (RED verified). Next: `impl`."
  File: `src/engine/github-sync.ts`

- [ ] **4.7 Integration test: full pipeline lifecycle with GitHub sync**
  End-to-end test with mocked `gh` CLI: create pipeline with --issue → advance through all 6 phases → verify the correct sequence of label adds, label removes, status updates, and final close.

### Decision Rationale
- **Push-only, no pull**: hog pushes phase state TO GitHub. It doesn't pull issues FROM GitHub. This keeps the data flow simple and avoids the complexity of bidirectional sync (which caused issues with the old TickTick integration).
- **Labels over status**: Labels are simpler (no field ID needed), visible in all GitHub views, and work without GitHub Projects. Status mapping is optional on top.
- **Phase comments optional**: Some teams want the audit trail; others find it noisy. Default off.
- **Errors never block**: GitHub sync is a convenience, not a dependency. Pipeline advancement continues regardless of sync success.

### Risks
- **GitHub API rate limits**: 6 phases × (label + status + comment) = up to 18 API calls per pipeline. For concurrent pipelines this could hit rate limits. Mitigate: batch where possible, add retry with backoff in github-sync.ts.
- **Label cleanup**: When a pipeline advances from "test" to "impl", the old "phase:red" label should be removed. If removal fails, stale labels accumulate. Mitigate: best-effort removal, don't block pipeline advancement on label cleanup.

---

## Phase 5: Release Preparation

**Goal:** Ship v1.26.0 with deprecation warnings first, then v2.0.0 with the full pivot. The public face matches the new product. Migration path is clear.

**Exit criteria:** Existing users get warned before breaking. New users can understand, install, and use hog in 5 minutes. MIGRATION.md answers every question.

### Tasks

- [ ] **5.1 Ship v1.26.0 — deprecation release**
  Before v2.0.0, publish a v1.x release that adds deprecation warnings to commands that will be removed:
  ```
  hog board → prints "⚠ hog board will be removed in v2.0. Use: hog cockpit" then runs normally
  hog pick → prints "⚠ hog pick will be removed in v2.0" then runs normally
  hog issue → prints "⚠ hog issue will be removed in v2.0" then runs normally
  ```
  This gives npm users one update cycle to see the warning before the break.

- [ ] **5.2 Write `MIGRATION.md`**
  Standalone migration guide:
  ```
  # Migrating from hog v1 to v2

  ## What changed
  hog is now a pipeline orchestrator. The GitHub board was removed.

  ## Removed commands
  | v1 command | v2 equivalent | Notes |
  |------------|---------------|-------|
  | hog board --live | hog cockpit | Pipeline-focused TUI |
  | hog pick <ref> | hog pipeline create --issue <ref> | Starts a pipeline |
  | hog issue create | (use gh CLI directly) | GitHub is a sync target |
  | hog issue view/close/... | (use gh CLI directly) | |
  | hog task * | removed | TickTick was dropped in v1.x |
  | hog sync * | removed | |

  ## Config migration (v4 → v5)
  Run `hog config migrate --dry-run` to preview changes.
  Run `hog config migrate` to apply (backs up original).

  | v4 path | v5 path |
  |---------|---------|
  | board.assignee | pipeline.owner |
  | board.workflow.maxConcurrentAgents | pipeline.maxConcurrentAgents |
  | repos[].projectNumber | projects[].github.projectNumber |
  | ... | ... |

  ## New requirements
  - Beads (`bd` CLI) — required for pipelines
  - GitHub CLI (`gh`) — optional, only for GitHub sync
  ```

- [ ] **5.3 Add prerequisite guards**
  Runtime checks at the top of `src/cli.ts`:
  - Node < 22 → clear version error with install link
  - `bd` not installed → friendly message (required for `pipeline *` commands)
  - `gh` not installed → friendly message only when GitHub sync is configured
  - Corrupt config → `safeParse` + backup original + user-friendly error (not raw ZodError)
  - Failed v4→v5 migration → backup original, show error, suggest `hog init`

- [ ] **5.4 Rewrite README**
  New structure:
  1. Tagline: "TDD-enforced AI development pipelines. Structure enables autonomy."
  2. What it does: 6-phase pipeline with role separation, Beads DAG, quality gates
  3. Quick Start: `npm install -g @ondrej-svec/hog && hog init && hog pipeline create "my feature"`
  4. The 6 phases explained (brainstorm → stories → test → impl → redteam → merge)
  5. Cockpit TUI screenshot
  6. GitHub integration (optional, configurable)
  7. Configuration reference
  8. Requirements (Node 22+, `bd` CLI, optionally `gh` CLI)
  9. Comparison with Gastown, Claude Code, Devin
  10. Migrating from v1 → link to MIGRATION.md

- [ ] **5.5 Update package.json**
  Description: "TDD-enforced AI development pipelines with structural role separation"
  Keywords: add agent, pipeline, tdd, beads, orchestration. Remove ticktick.

- [ ] **5.6 Generate demo.gif**
  Update `docs/demo.tape` for the pipeline flow (not the board). Generate and embed.

- [ ] **5.7 Update CLAUDE.md**
  Reflect new architecture: engine-first, board is cockpit, GitHub is optional sync. Remove board-specific module documentation. Add engine module map.

- [ ] **5.8 Bump to v2.0.0**
  Semver major — breaking change (board removed, config v5). CHANGELOG entry:
  - What changed (pipeline-first pivot)
  - What was removed (board, issue commands, pick)
  - How to migrate (link to MIGRATION.md)
  - What's new (cockpit TUI, GitHub sync bridge, config v5)

- [ ] **5.9 Smoke test: clean install from npm**
  From a clean environment (no existing config):
  `npm install -g @ondrej-svec/hog@2.0.0 && hog --version && hog init --no-github`
  Verify it works end-to-end. This is different from `npm run ci` in the dev environment.

### Decision Rationale
- **v1.26.0 before v2.0.0**: One deprecation cycle respects existing users. Low effort (just warning prints), high trust signal.
- **MIGRATION.md as a separate file**: The CHANGELOG is chronological. Migration is a how-to guide. Different audiences, different formats.
- **Prerequisite guards in cli.ts, not init.ts**: Every command should give helpful errors, not just `hog init`.

---

## Acceptance Criteria

### User Story Acceptance

| Story | Criterion | How to verify |
|-------|-----------|---------------|
| A: New user | Install to first pipeline in < 5 min | Time the full flow on a clean machine |
| A: New user | No GitHub required | `hog init --no-github` → `hog pipeline create` works |
| A: New user | Beads not installed → helpful message | Run without `bd` in PATH |
| B: Existing user | `hog board` → migration message | Run command, check output |
| B: Existing user | Config auto-migrates | Load v4 config with v2 binary |
| B: Existing user | `MIGRATION.md` answers all questions | Review with a fresh pair of eyes |
| C: Team member | Phase changes update GitHub labels | Create pipeline with --issue, watch labels |
| C: Team member | Pipeline completion closes issue | Complete all 6 phases |
| C: Team member | Sync failure doesn't block pipeline | Kill network mid-pipeline |

### Technical Acceptance

1. All parity gate tests pass before board deletion
2. Pipeline lifecycle integration test passes end-to-end
3. CLI contract tests pass (cockpit exists, tombstones work)
4. `hog pipeline create "feature"` auto-advances through 6 phases
5. `hog cockpit` shows real-time progress, decisions, agent status
6. Decisions answered inline (D + number keys)
7. `hog config migrate --dry-run` shows v4→v5 changes
8. `npm run ci` passes (typecheck + lint + tests)
9. Coverage delta from board deletion is accounted for (no engine coverage loss)
10. v1.26.0 deprecation release published before v2.0.0

---

## Risk Summary

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cockpit bugs harder than expected | Medium | High (blocks Phase 2) | RED→GREEN approach catches issues early; each bug has a test before a fix |
| Config migration breaks existing users | Low | High | Tests written FIRST with real config snapshots (3.1); `--dry-run` preview |
| Deleting 27+ files breaks imports | Certain | Low | TypeScript compiler catches all; coverage delta check brackets the deletion |
| Beads CLI not installed on user machines | High | Medium | Clear install guidance in init; prerequisite guard in cli.ts |
| v2.0.0 confuses existing npm users | Medium | Medium | v1.26.0 deprecation release; MIGRATION.md; command tombstones |
| `fetch-loop.ts` breaks when `fetch.ts` deleted | Certain | Medium | Phase 0.4 audit resolves this before any deletion |
| Parity gate tests take too long to write | Low | Low | Tests are lightweight render checks, not full integration |
| GitHub sync fails silently with no user feedback | Medium | Low | Sync errors logged to pipeline log file; surfaced in cockpit as warning |
