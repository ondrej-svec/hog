# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run build          # compile TypeScript → dist/ (tsup)
npm run dev            # run from source via tsx (no build needed)
npm run check          # biome lint + format check
npm run check:fix      # biome lint + format with auto-fix
npm run lint           # biome lint only
npm run format         # biome format with auto-fix
npm run typecheck      # tsc --noEmit (no emit, type errors only)
npm run test           # vitest run (all tests, once)
npm run test:watch     # vitest in watch mode
npm run test:coverage  # vitest with v8 coverage (80% threshold enforced)
npm run ci             # typecheck + check + test (what CI runs)
```

Run a single test file:
```sh
npx vitest run src/engine/conductor.test.ts
```

Run hog locally (without building):
```sh
npm run dev -- cockpit
npm run dev -- pipeline create "test feature"
npm run dev -- init
```

## Architecture

`hog` is a Node.js CLI tool (ESM, TypeScript, Node 22+) that orchestrates AI agents through TDD-enforced development pipelines using Beads for DAG-based task management.

### Entry Points

- **`src/cli.ts`** — Commander.js program; defines subcommands (`cockpit`, `pipeline`, `decisions`, `beads`, `config`, `init`, `launch`).
- **`bin/`** — thin shebang wrapper pointing to `dist/cli.js`.

### Engine (`src/engine/`)

The pipeline orchestration layer. All pipeline logic lives here.

| File | Responsibility |
|------|---------------|
| `engine.ts` | Top-level wiring: EventBus, WorkflowEngine, AgentManager, ActionExecutor, Orchestrator, BeadsClient |
| `conductor.ts` | Pipeline state machine: polls `bd ready`, spawns role-separated agents, manages lifecycle |
| `beads.ts` | Beads CLI wrapper: createFeatureDAG, ready, claim, close, ensureDoltRunning |
| `roles.ts` | 6 pipeline roles with prompt templates: brainstorm, stories, test, impl, redteam, merge |
| `role-context.ts` | Writes role-specific CLAUDE.md to worktrees, builds agent launch args |
| `agent-manager.ts` | Spawns Claude processes, polls PID liveness, reconciles results |
| `tdd-enforcement.ts` | RED state verification, story traceability, mutation testing |
| `quality-gates.ts` | Linting, security (semgrep), abuse pattern detection |
| `refinery.ts` | Serial merge queue: rebase → test → quality gates → fast-forward merge |
| `worktree.ts` | Git worktree management for agent isolation |
| `question-queue.ts` | Human-in-the-loop: persistent question queue, blocking, resolution |
| `event-bus.ts` | Typed EventEmitter for engine events |
| `workflow.ts` | Phase resolution and status derivation |
| `beads-sync.ts` | GitHub issue ↔ Bead ID mapping |

### Cockpit TUI (`src/board/`)

The pipeline monitoring TUI. Minimal Ink (React-for-CLIs) components.

| File | Responsibility |
|------|---------------|
| `live.tsx` | Entry point: `runCockpit()` renders `<Cockpit>` via Ink |
| `components/cockpit.tsx` | Main component: pipeline view, keyboard handling, overlays |
| `components/pipeline-view.tsx` | Pipeline list, agent status, decision panel, DAG visualization |
| `components/start-pipeline-overlay.tsx` | "What do you want to build?" overlay |
| `components/toast-container.tsx` | Toast notifications |
| `hooks/use-pipeline-data.ts` | Pipeline data polling from pipelines.json |
| `hooks/use-toast.ts` | Toast notification queue |
| `spawn-agent.ts` | Low-level Claude process spawning with stream-json parsing |
| `launch-claude.ts` | Interactive Claude session launcher (tmux/terminal) |

### Core Modules

| File | Responsibility |
|------|---------------|
| `src/config.ts` | Zod schemas + read/write for config v5. Migration from v1→v5. |
| `src/github.ts` | Thin wrapper around `gh` CLI. Used for optional GitHub sync. |
| `src/init.ts` | Interactive setup wizard (`hog init`) |
| `src/output.ts` | `setFormat`/`useJson` + print helpers |

### Configuration

Config file: `~/.config/hog/config.json` (version 5). Zod-validated on load.

Key sections:
- `pipeline` — owner, maxConcurrentAgents, launchMode, tddEnforcement, phases, qualityGates
- `repos[]` — tracked projects with localPath, optional GitHub integration
- `board` — legacy board settings (kept for backward compatibility)

### Data Flow

- **Pipeline state**: Beads DAG (`bd ready`) + `pipelines.json` (conductor persistence)
- **GitHub data**: optional, via `gh` CLI. Push-only — hog doesn't poll GitHub for pipeline state.
- **Agent spawning**: `spawn-agent.ts` → Claude with `--output-format stream-json`
- **Output format**: commands check `useJson()` from `output.ts`. Global `--json` / `--human` flags.

### Toolchain

- **Biome** (not ESLint/Prettier): linting + formatting. Config in `biome.json`. Filenames must be `kebab-case`. `noExplicitAny` is an error.
- **tsup** for bundling (config in `tsup.config.ts`). Outputs ESM to `dist/`.
- **TypeScript** with maximum strictness: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Use `import type` for type-only imports.
- **Vitest** for tests. Tests live alongside source as `*.test.ts` / `*.test.tsx`. 80% coverage threshold on statements/branches/functions/lines.
