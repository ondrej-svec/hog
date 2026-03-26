---
title: "refactor: Per-project pipeline state — .hog/ in project root"
type: plan
date: 2026-03-25
status: approved
confidence: high
---

# Per-Project Pipeline State

**One-line summary:** Move all pipeline runtime state from `~/.config/hog/` (global) to `.hog/` (per-project). Each project gets isolated pipeline state, question queue, and logs.

## Problem Statement

All pipeline state lives in `~/.config/hog/` — a single global directory shared across every project. This means:
- Pipelines from project A leak into project B's cockpit
- Tests leak data to the user's real state (just fixed with VITEST guard, but root cause remains)
- No isolation between projects
- `question-queue.json` accumulates questions from all projects

Pipeline state should live alongside the project, in `.hog/` at the project root.

## Proposed Solution

```
my-project/
├── .beads/          ← Beads data (already per-project)
├── .hog/            ← NEW: hog runtime state
│   ├── pipelines.json
│   ├── question-queue.json
│   └── pipelines/   ← log files
│       └── feat-xxx.log
├── src/
└── ...
```

The conductor receives `projectRoot` (cwd) and stores/loads state relative to `.hog/` in that directory. Global config (`~/.config/hog/config.json`, `auth.json`) stays global — it's user config, not project state.

---

## Implementation Tasks

### Phase 1: Introduce project-scoped state directory

- [ ] **1.1 Add `hogStateDir(cwd)` helper to `config.ts`**
  ```ts
  export function hogStateDir(cwd: string): string {
    return join(cwd, ".hog");
  }
  ```
  Creates `.hog/` on first use. All pipeline state functions use this instead of `CONFIG_DIR`.

- [ ] **1.2 Add `.hog/` to common `.gitignore` patterns**
  The `hog init` wizard should add `.hog/` to `.gitignore` if not already present.
  Pipeline state is runtime data — not committed.

### Phase 2: Migrate conductor to per-project state

- [ ] **2.1 Make conductor receive `projectRoot` in constructor**
  Add `projectRoot: string` to `ConductorOptions`. The conductor uses this for state file paths:
  - `join(hogStateDir(projectRoot), "pipelines.json")`
  - Question queue path also scoped

- [ ] **2.2 Update `savePipelines` / `loadPipelines` / `syncFromDisk`**
  Replace `CONFIG_DIR` with `hogStateDir(this.projectRoot)` for all file operations.
  Remove the static `PIPELINES_FILE` — it's now instance-scoped.

- [ ] **2.3 Update `loadQuestionQueue` / `saveQuestionQueue`**
  The question queue module currently uses a global `QUEUE_FILE`. Change to accept a directory parameter:
  ```ts
  export function loadQuestionQueue(stateDir: string): QuestionQueue
  export function saveQuestionQueue(queue: QuestionQueue, stateDir: string): void
  ```
  The conductor passes `hogStateDir(projectRoot)`.

### Phase 3: Migrate CLI commands

- [ ] **3.1 `hog pipeline create` — pass cwd to conductor**
  The conductor needs to know the project root. Pass `cwd` (already resolved in the command).

- [ ] **3.2 `hog pipeline watch` — use project-scoped log dir**
  Log files go to `.hog/pipelines/{featureId}.log` instead of `~/.config/hog/pipelines/`.
  Update the log path in the watcher and in the `create` output.

- [ ] **3.3 `hog pipeline status` — read from project state**
  Reads `.hog/pipelines.json` and log files from the current project.

- [ ] **3.4 `hog pipeline clear` — clear project state only**
  Clears `.hog/pipelines.json` for the current project, not the global file.

- [ ] **3.5 `hog beads status/stop` — no changes needed**
  These already use cwd-based detection.

### Phase 4: Migrate cockpit (board)

- [ ] **4.1 `usePipelineData` — pass cwd to conductor**
  The cockpit passes `process.cwd()` as `projectRoot` when constructing the conductor.

- [ ] **4.2 `StartPipelineOverlay` — uses conductor from same project**
  Already uses the cockpit's conductor (same cwd). No changes needed.

### Phase 5: Clean up and migrate

- [ ] **5.1 Remove pipeline-related files from `~/.config/hog/`**
  After migration, `~/.config/hog/` should only contain:
  - `config.json` (user config — stays global)
  - `auth.json` (auth tokens — stays global)
  No more `pipelines.json`, `question-queue.json`, or `pipelines/` logs in global dir.

- [ ] **5.2 Update tests**
  Tests that mock conductor should pass a temp dir as `projectRoot`.
  No more VITEST guards needed — the conductor writes to a test-provided dir.

- [ ] **5.3 Update `beads-sync.ts`**
  Move `beads-sync.json` to `.hog/` as well — it's per-project state.

### Phase 6: Tests and quality

- [ ] **6.1 Test: pipelines are isolated per project**
- [ ] **6.2 Test: `npm run test` doesn't write to `~/.config/hog/`**
- [ ] **6.3 Test: cockpit only shows pipelines for current project**
- [ ] **6.4 Full test suite passes, typecheck, lint**

---

## Acceptance Criteria

1. `.hog/` directory created in project root on first pipeline
2. `pipelines.json`, `question-queue.json`, and log files live in `.hog/`
3. Cockpit only shows pipelines for the current project
4. `hog pipeline clear` clears current project only
5. `~/.config/hog/` contains only `config.json` and `auth.json`
6. Tests don't write to the user's real config directory
7. `.hog/` is in `.gitignore`

## Decision Rationale

### Why `.hog/` and not `.beads/`?

`.beads/` is owned by the Beads CLI. Mixing hog state into it creates coupling. `.hog/` is hog's own runtime directory — clean separation.

### Why not keep global state and filter by project?

Filtering requires knowing the project root at query time AND having clean repo identifiers. Per-project files are simpler, naturally isolated, and easy to reason about.

## References

- [conductor.ts:98](../../src/engine/conductor.ts) — current `PIPELINES_FILE` using `CONFIG_DIR`
- [question-queue.ts:30](../../src/engine/question-queue.ts) — current `QUEUE_FILE` using `CONFIG_DIR`
- [cli.ts:604](../../src/cli.ts) — current log dir using `CONFIG_DIR`
