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
npx vitest run src/board/hooks/use-navigation.test.tsx
```

Run hog locally (without building):
```sh
npm run dev -- board --live
npm run dev -- init
```

## Architecture

`hog` is a Node.js CLI tool (ESM, TypeScript, Node 22+) that combines GitHub Issues from GitHub Projects with TickTick tasks into a unified terminal dashboard.

### Entry Points

- **`src/cli.ts`** — Commander.js program; defines all subcommands (`board`, `task`, `sync`, `pick`, `config`, `init`). All commands are wired here and call into the modules below.
- **`bin/`** — thin shebang wrapper pointing to `dist/cli.js`.

### Core Modules

| File | Responsibility |
|------|---------------|
| `src/types.ts` | Shared types: `Task`, `BoardIssue`, `BoardData`, `Priority`, `PickResult` |
| `src/config.ts` | Zod schemas + read/write for `~/.config/hog/config.json` and `~/.config/hog/auth.json`. Config v3 schema; includes migration from v1/v2. |
| `src/github.ts` | Thin wrapper around `gh` CLI via `execFileSync`. Synchronous. All GitHub data comes through here. |
| `src/api.ts` | TickTick HTTP API client (async, uses `fetch`). Handles OAuth token in `Authorization` header. |
| `src/auth.ts` | TickTick OAuth flow helpers |
| `src/init.ts` | Interactive setup wizard (`hog init`) using `@inquirer/prompts` |
| `src/pick.ts` | "Pick an issue": assign on GitHub + create TickTick task + update sync state |
| `src/sync.ts` | GitHub ↔ TickTick sync logic |
| `src/sync-state.ts` | Persistent mapping of GitHub issue numbers ↔ TickTick task IDs (`~/.config/hog/sync-state.json`) |
| `src/output.ts` | `setFormat`/`useJson` + all print helpers; commands always call these instead of `console.log` directly |

### Board TUI (`src/board/`)

The live board (`hog board --live`) renders an [Ink](https://github.com/vadimdemedes/ink) (React-for-CLIs) TUI. The data pipeline:

1. **`fetch.ts`** — `fetchDashboard()`: fetches GitHub issues synchronously via `gh` CLI, TickTick tasks async via HTTP, and recent GitHub activity events. Returns `DashboardData`.
2. **`live.tsx`** — calls `render(<Dashboard />)` from Ink, awaits exit.
3. **`components/dashboard.tsx`** — the main orchestrator component (~1250 lines). Owns:
   - `buildNavItems()` / `buildFlatRows()`: flatten hierarchical repo→status-group→issue structure into a linear navigable list.
   - All keyboard input handling via Ink's `useInput`.
   - Overlay lifecycle (search, status picker, comment input, focus mode, bulk actions, create issue form).
4. **`hooks/`** — extracted React hooks:
   - `use-data.ts` — fetch + auto-refresh with `setInterval`
   - `use-navigation.ts` — cursor position, section collapsing, tab-jump
   - `use-ui-state.ts` — finite state machine for overlay modes (`normal` | `search` | `multiSelect` | `overlay:*` | `focus`)
   - `use-toast.ts` — toast notification queue
   - `use-multi-select.ts` — multi-selection with same-repo constraint
   - `use-actions.ts` — GitHub/TickTick mutations (assign, comment, status change, create, pick)
5. **`components/`** — individual Ink components: `IssueRow`, `TaskRow`, `FocusMode`, `SearchBar`, `StatusPicker`, `CreateIssueForm`, `BulkActionMenu`, `DetailPanel`, `ToastContainer`, etc.
6. **`format-static.ts`** — renders board as plain text or JSON for non-live mode.

### Data Flow

- **GitHub data**: always synchronous via `execFileSync("gh", ...)`. Never use the GitHub REST/GraphQL API directly — always go through the `gh` CLI.
- **TickTick data**: always async HTTP via `TickTickClient` in `api.ts`. Auth token from `~/.config/hog/auth.json`.
- **Output format**: commands check `useJson()` from `output.ts` and call either `jsonOut()` or print helpers. Global `--json` / `--human` flags set this.

### Configuration

Config file: `~/.config/hog/config.json` (version 3). Zod-validated on load. Contains:
- `repos[]` — tracked GitHub repos with `statusFieldId`, `projectNumber`, `completionAction`, optional `statusGroups`
- `board` — `assignee`, `refreshInterval`, `backlogLimit`, `focusDuration`
- `ticktick.enabled` — boolean, gates all TickTick calls
- `profiles` — named snapshots of `{repos, board, ticktick}`

### Toolchain

- **Biome** (not ESLint/Prettier): linting + formatting. Config in `biome.json`. Filenames must be `kebab-case`. `noExplicitAny` is an error.
- **tsup** for bundling (config in `tsup.config.ts`). Outputs ESM to `dist/`.
- **TypeScript** with maximum strictness: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Use `import type` for type-only imports.
- **Vitest** for tests. Tests live alongside source as `*.test.ts` / `*.test.tsx`. 80% coverage threshold on statements/branches/functions/lines.
