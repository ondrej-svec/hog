---
title: "feat: Hog unified task dashboard — personal cockpit"
type: feat
status: completed
date: 2026-02-15
deepened: 2026-02-15
---

# Hog Unified Task Dashboard

## Enhancement Summary

**Deepened on:** 2026-02-15
**Research agents used:** 13 (TypeScript Reviewer, Architecture Strategist, Performance Oracle, Security Sentinel, Code Simplicity Reviewer, Frontend Races Reviewer, Agent-Native Reviewer, Spec Flow Analyzer, Pattern Recognition Specialist, Ink Framework Researcher, CLI TUI Best Practices Researcher, Repo Research Analyst, Context7 Docs)

### Key Improvements
1. **Security hardening** — Command injection prevention, input validation, credential storage improvements
2. **Performance architecture** — Lazy loading, multi-layer caching, virtual scrolling, adaptive refresh
3. **Race condition prevention** — Request cancellation tokens, optimistic updates, ID-based navigation
4. **Type safety** — Discriminated unions for state, Result types, runtime validation with Zod, branded IDs
5. **Agent-native parity** — `--json` on ALL commands, standardized error schema, `--dry-run` for pick
6. **Simplification opportunities** — Theme system, provider pattern, and phasing can be leaner

### Critical Pre-Implementation Checklist
- [x] Define all TypeScript types upfront (config schema, board data, error types)
- [x] Add config versioning before any migration code
- [x] Use `execFile` not `exec` for all `gh` CLI calls (command injection prevention)
- [x] Add `--json` flag to every new command
- [x] Implement request cancellation pattern before building --live mode

---

## Overview

Enhance `hog` (Heart of Gold) from a sync tool into Ondrej's **personal task cockpit** — a beautiful terminal dashboard that shows personal TickTick tasks, work GitHub issues across multiple repos (all assignees), and unassigned backlog in one glance. Built with Ink (React for CLI) for a stunning terminal UI.

## Problem Statement

Ondrej has three disconnected task environments:
1. **Personal tasks** in TickTick (underused because it's isolated)
2. **Work issues** in `aibilitycz/aibility` (GitHub)
3. **Project issues** in `aibilitycz/aimee-product` (GitHub)

The current `hog sync` bridges GitHub and TickTick but only syncs Ondrej's assigned issues from hardcoded repos. There's no unified view, no team visibility, and no way to browse or pick up backlog issues.

**Goal**: One command (`hog board`) shows everything. One command (`hog pick`) lets him grab work. TickTick stays the personal dashboard, `hog board` becomes the cockpit.

### Research Insights: Problem Validation

**From Spec Flow Analysis — 38 gaps identified across 10 categories:**
- The core problem is well-defined, but several flows are underspecified (see per-phase insights)
- Critical gaps: config validation, sync metadata schema, pick validation rules, cache TTL policy, undo/unpick flow
- **Missing user flow**: What happens when repos are added/removed while synced tasks exist? (orphan handling)
- **Missing user flow**: How does the agent (Claude Code) discover and use board commands? (CLAUDE.md update needed)

**From Agent-Native Review — currently 0/9 commands have `--json`:**
- Every new command MUST support `--json` from day one (existing `hog task` commands already do this)
- The `--json` / `--human` pattern from `output.ts` is the right foundation — extend it consistently

## Proposed Solution

### New Commands

```
hog board                    # Static snapshot: print everything, exit
hog board --live             # Persistent TUI: auto-refresh, navigate, act
hog board --repo aibility    # Filter by repo
hog board --mine             # Only my tasks/issues
hog board --backlog          # Only unassigned issues

hog pick <repo>/<issue>      # Assign issue to self + sync to TickTick
hog pick aibility/145        # Example: pick up issue #145

hog config repos             # List configured repos
hog config repos add <repo>  # Add a repo to track
hog config repos rm <repo>   # Remove a repo
hog config show              # Show full config
```

### Architecture

```
hog/src/
├── cli.ts                      # Add board, pick, config commands
├── api.ts                      # TickTick client (existing)
├── github.ts                   # Extended: all issues, configurable repos
├── sync.ts                     # Existing sync (reads config instead of hardcoded)
├── sync-state.ts               # Existing state management
├── config.ts                   # Extended: repo config, dashboard prefs
├── output.ts                   # Extended: board formatting
├── board/
│   ├── fetch.ts                # Parallel data fetching (GH + TT)
│   ├── format-static.ts        # Beautiful static output (chalk, boxen)
│   ├── components/
│   │   ├── App.tsx             # Root Ink component
│   │   ├── Header.tsx          # Title bar + refresh indicator
│   │   ├── RepoSection.tsx     # Issues grouped by repo
│   │   ├── TickTickSection.tsx  # Personal tasks section
│   │   ├── IssueRow.tsx        # Single issue display
│   │   └── StatusBar.tsx       # Keybindings + last refresh time
│   └── hooks/
│       ├── useData.ts          # Data fetching + refresh
│       └── useNavigation.ts    # Keyboard navigation state
└── types.ts                    # Extended with board types
```

### Config Schema

`~/.config/hog/config.json` (extended):

```json
{
  "defaultProjectId": "inbox123",
  "repos": [
    {
      "name": "aibilitycz/aibility",
      "shortName": "aibility",
      "projectNumber": 10,
      "statusFieldId": "PVTSSF_...",
      "completionAction": { "type": "updateProjectStatus", "optionId": "df73e18b" }
    },
    {
      "name": "aibilitycz/aimee-product",
      "shortName": "aimee",
      "projectNumber": 8,
      "statusFieldId": "PVTSSF_...",
      "completionAction": { "type": "addLabel", "label": "review:pending" }
    }
  ],
  "board": {
    "refreshInterval": 60,
    "backlogLimit": 20,
    "assignee": "ondrej-svec"
  }
}
```

This replaces all hardcoded values in `github.ts` and `sync.ts`.

### Research Insights: Architecture & Types

**From TypeScript Review — critical type safety gaps:**

The config schema shows JSON but lacks TypeScript definitions with runtime validation. Config from files is `unknown` at runtime.

```typescript
// MUST ADD: Runtime validation with Zod
import { z } from "zod";

const CompletionActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updateProjectStatus"), optionId: z.string() }),
  z.object({ type: z.literal("closeIssue") }),
  z.object({ type: z.literal("addLabel"), label: z.string() }),
]);

const RepoConfigSchema = z.object({
  name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  shortName: z.string(),
  projectNumber: z.number(),
  statusFieldId: z.string(),
  completionAction: CompletionActionSchema,
});

const HogConfigSchema = z.object({
  version: z.number().default(2),  // ADD: Schema versioning
  defaultProjectId: z.string(),
  repos: z.array(RepoConfigSchema),
  board: z.object({
    refreshInterval: z.number().default(60),
    backlogLimit: z.number().default(20),
    assignee: z.string(),
  }),
});

export type HogConfig = z.infer<typeof HogConfigSchema>;
```

**From Architecture Review — config migration needs versioning:**

```typescript
function migrateConfig(raw: unknown): HogConfig {
  const parsed = raw as Record<string, unknown>;
  if (!parsed.version || parsed.version < 2) {
    // v1 → v2: Move hardcoded repos to config
    return { ...parsed, version: 2, repos: LEGACY_SYNC_REPOS };
  }
  return HogConfigSchema.parse(raw);
}
```

**From Repo Research — existing codebase conventions to follow:**
- Files: kebab-case (`sync-state.ts`), Types: PascalCase (`SyncMapping`)
- Always use `.js` extension in imports (ESM)
- Maximum TypeScript strictness (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Error pattern: `formatError(err: unknown): string` — `err instanceof Error ? err.message : String(err)`
- Test factories: `function makeTask(overrides: Partial<Task> = {}): Task`
- Dual output: `useJson()` auto-detects TTY, override with `--json`/`--human`

**From Agent-Native Review — add `--json` to ALL new commands:**

```bash
# EVERY command needs structured output
hog board --json                     # Returns full board data
hog board --repo aibility --json     # Filtered board
hog pick aibility/145 --json         # Returns assignment result
hog config repos --json              # Returns repo list
hog config show --json               # Returns full config
```

**Standardized JSON error schema:**
```json
{
  "success": false,
  "error": {
    "code": "REPO_NOT_FOUND",
    "message": "Repository 'owner/typo' not found",
    "details": { "repo": "owner/typo" }
  }
}
```

## Design System & Development Practices

### Terminal Color System

A proper color theme, defined once, used everywhere. No ad-hoc color choices in components.

**Theme file:** `hog/src/board/theme.ts`

```typescript
export interface Theme {
  // Semantic colors (not "blue" but "primary")
  text: {
    primary: string;      // Main content
    secondary: string;    // Metadata, timestamps
    muted: string;        // Disabled, low-priority
    inverse: string;      // Text on colored backgrounds
    success: string;      // Completed, green states
    warning: string;      // Due soon, attention needed
    error: string;        // Overdue, failures
    accent: string;       // Issue numbers, links
  };
  border: {
    primary: string;      // Section borders
    muted: string;        // Subtle dividers
    focus: string;        // Selected item highlight
  };
  priority: {
    high: string;         // Red
    medium: string;       // Yellow/amber
    low: string;          // Blue
    none: string;         // Gray
  };
  assignee: {
    self: string;         // Ondrej's issues (highlighted)
    others: string;       // Colleagues
    unassigned: string;   // Backlog
  };
  status: {
    inProgress: string;
    backlog: string;
    done: string;
  };
}
```

**Two built-in themes:** `dark` (default) and `light`. Auto-detect is unreliable, so default to dark with `hog config set board.theme light` override.

**Color format:** Hex (`#RRGGBB`) with truecolor rendering, automatic fallback to ANSI 256 in limited terminals via `chalk.level` detection.

**Rules:**
- Never use raw chalk colors in components (`chalk.red`). Always use theme tokens (`theme.text.error`).
- Every color choice must pass 4.5:1 contrast ratio against both dark and light backgrounds.
- Test in: iTerm2, Terminal.app, VS Code integrated terminal.

### Component Architecture

Ink components follow React patterns. Establish conventions from the start.

**Component conventions:**

```typescript
// board/components/IssueRow.tsx

import type { FC } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../hooks/useTheme.js";

interface IssueRowProps {
  readonly number: number;
  readonly title: string;
  readonly assignee: string | null;
  readonly priority: "high" | "medium" | "low" | "none";
  readonly isSelected: boolean;
}

const IssueRow: FC<IssueRowProps> = ({ number, title, assignee, priority, isSelected }) => {
  const theme = useTheme();
  // ...render
};

export { IssueRow };
export type { IssueRowProps };
```

**Rules:**
- All props are `readonly` (enforced by TypeScript strict config)
- Props interface exported alongside component (for testing)
- Theme accessed via `useTheme()` hook, never imported directly
- Components are pure — no side effects, no direct API calls
- Data fetching lives in hooks (`useData`, `useGitHub`), not components
- Every component gets a test file (`IssueRow.test.tsx`)

### Component Preview & Testing (Storybook Alternative)

No Storybook for terminal exists. Instead:

**1. Dedicated preview script** — `hog/src/board/preview.tsx`

A harness that renders components with mock data. Run `npm run preview` to see them live.

```typescript
// preview.tsx — render all components with sample data
import { render } from "ink";
import { App } from "./components/App.js";
import { mockBoardData } from "../test/fixtures.js";

render(<App data={mockBoardData} />);
```

```json
// package.json
{ "preview": "tsx src/board/preview.tsx" }
```

**2. React DevTools** — for interactive debugging:

```bash
DEV=true npm run preview
# In another terminal:
npx react-devtools
```

Inspect component tree, change props live, see results immediately.

**3. ink-testing-library** — for automated visual assertions:

```typescript
import { render } from "ink-testing-library";
import { IssueRow } from "./IssueRow.js";

it("highlights selected row", () => {
  const { lastFrame } = render(
    <IssueRow number={42} title="Fix auth" assignee="ondrej" priority="high" isSelected={true} />
  );
  // lastFrame() returns the exact terminal output as a string
  expect(lastFrame()).toContain("#42");
  expect(lastFrame()).toContain("Fix auth");
});
```

**4. Snapshot testing** for visual regression:

```typescript
it("renders board layout correctly", () => {
  const { lastFrame } = render(<App data={mockBoardData} />);
  expect(lastFrame()).toMatchSnapshot();
});
```

Snapshots catch unintended visual changes. Review diffs in PRs.

### Shared Test Fixtures

All mock data lives in one place: `hog/src/test/fixtures.ts`

```typescript
// test/fixtures.ts
export const mockGitHubIssues: GitHubIssue[] = [/* ... */];
export const mockTickTickTasks: Task[] = [/* ... */];
export const mockBoardData: BoardData = {/* ... */};
export const mockConfig: HogConfig = {/* ... */};
```

Reused by: unit tests, component tests, preview harness, integration tests.

### TypeScript & Linting

**TSX support** — extend existing `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

**Biome** — already configured (Biome 2.0). No ESLint needed. Biome handles:
- Formatting (100-char line width, 2-space indent)
- Linting (recommended rules + no explicit `any`, no unused vars)
- Import sorting
- JSX/TSX support built-in

Add one rule for component files:

```json
{
  "overrides": [{
    "include": ["src/board/**/*.tsx"],
    "linter": {
      "rules": {
        "style": {
          "useFragmentSyntax": "error"
        }
      }
    }
  }]
}
```

### Responsive Layout

Terminal width varies (80-200+ columns). Handle it:

```typescript
import { useStdoutDimensions } from "ink";

const Dashboard: FC = () => {
  const [columns] = useStdoutDimensions();

  // Breakpoints
  const isWide = columns >= 120;    // Side-by-side repos
  const isMedium = columns >= 80;   // Stacked but full info
  // Below 80: compact mode (truncated titles, no assignee column)

  return isWide ? <SideBySideLayout /> : <StackedLayout />;
};
```

**Minimum:** 60 columns. Below that, show a "terminal too narrow" message.

### UX States

Every data section handles four states:

| State | Display |
|-------|---------|
| **Loading** | Spinner + "Fetching aibility issues..." |
| **Empty** | Helpful message: "No unassigned issues. Nice!" |
| **Error** | Error message + last cached data (if available) |
| **Content** | Normal render |

No blank sections. No unexplained pauses. Always give feedback.

### Research Insights: Design System

**From Code Simplicity Review — YAGNI assessment:**

> This is a personal tool for ONE user. Consider what complexity is actually needed.

| Element | Verdict | Recommendation |
|---------|---------|----------------|
| Theme system (2 themes + tokens) | Over-engineered | Start with hardcoded colors. Add themes only if you actually switch. |
| DataProvider plugin pattern | Premature | Just call services directly. Extract interface when 3rd source added. |
| Responsive layout (3 breakpoints) | Overkill | Two cases: narrow (<80) and normal. Done. |
| cli-table3 + boxen for static | Heavy | Simple `console.log` + chalk for static. Save beauty for `--live`. |
| Snapshot testing | Questionable | You'll see breakage immediately. Add tests for data logic, not rendering. |
| Component conventions (readonly, exports) | Too formal | This isn't a library. Simplify. |

**Potential LOC reduction: 60%** (from ~1000 planned to ~400)

**Simplified architecture if following simplicity recommendations:**
```
board/
  fetch.ts          # fetchDashboard() - calls TickTick + GitHub directly
  format-static.ts  # 30 lines, plain console.log + chalk
  components/
    Dashboard.tsx   # Main component, inline layout
    TaskList.tsx    # Shows tasks
    GitHubStats.tsx # Shows issues
  dev.tsx           # Preview with mock data
```

**From Pattern Recognition — shared view model prevents duplication:**

Three rendering paths (JSON, static, Ink) WILL duplicate formatting logic unless abstracted:

```typescript
// board/view-model.ts — shared by ALL renderers
interface BoardViewModel {
  sections: SectionViewModel[];
  stats: { totalIssues: number; myIssues: number; backlog: number };
  fetchedAt: Date;
}

function toBoardViewModel(data: DashboardData): BoardViewModel { /* ... */ }

// Then:
formatStatic(toBoardViewModel(data));   // chalk output
renderJson(data);                        // raw JSON
renderInk(toBoardViewModel(data));       // Ink components
```

**From Ink Framework Research (Context7) — theming with @inkjs/ui:**

Ink UI has a built-in `ThemeProvider` with `extendTheme()`. Use it instead of building custom:

```typescript
import { ThemeProvider, defaultTheme, extendTheme } from '@inkjs/ui';

const hogTheme = extendTheme(defaultTheme, {
  components: {
    Spinner: { styles: { frame: () => ({ color: 'cyan' }) } },
  },
});

// In App.tsx
<ThemeProvider theme={hogTheme}><Dashboard /></ThemeProvider>
```

**From Ink Framework Research — focus management for sections:**

```typescript
import { useFocus, useFocusManager, useInput } from 'ink';

function Dashboard() {
  const { focusNext, focusPrevious, focus } = useFocusManager();
  useInput((input, key) => {
    if (key.tab) key.shift ? focusPrevious() : focusNext();
    if (input === '1') focus('github');
    if (input === '2') focus('ticktick');
  });
  return (
    <Box flexDirection="column">
      <RepoSection id="github" />
      <TickTickSection id="ticktick" />
    </Box>
  );
}

function RepoSection({ id }) {
  const { isFocused } = useFocus({ id });
  useInput((input, key) => {
    if (!isFocused) return; // Only handle input when focused
    // j/k navigation within this section
  });
  return <Box borderColor={isFocused ? 'cyan' : 'gray'}>...</Box>;
}
```

### Keyboard Shortcuts

Follow lazygit / gh-dash conventions:

| Key | Action | Context |
|-----|--------|---------|
| `j` / `Down` | Next item | Navigation |
| `k` / `Up` | Previous item | Navigation |
| `Tab` | Next section | Navigation |
| `Shift+Tab` | Previous section | Navigation |
| `Enter` | Open in browser | On any issue/task |
| `p` | Pick up issue | On unassigned issue |
| `r` | Refresh data | Global |
| `q` | Quit | Global |
| `?` | Show help overlay | Global |
| `/` | Filter/search | Global (future) |

**Discoverability:** Status bar always shows available shortcuts for current context.

### Research Insights: Testing Strategy

**From Ink Framework Research — ink-testing-library patterns:**

```typescript
import { render } from "ink-testing-library";

test("highlights selected row", () => {
  const { lastFrame } = render(
    <IssueRow issue={mockIssue} isSelected={true} />
  );
  expect(lastFrame()).toContain("#42");
  expect(lastFrame()).toContain("Fix auth");
});

test("navigates with j/k", () => {
  const { lastFrame, stdin } = render(<Dashboard data={mockData} />);
  stdin.write("j"); // Press j
  expect(lastFrame()).toContain("→ Issue 2"); // Selection moved
});
```

**From TypeScript Review — missing test details to specify:**
- How to mock GitHub API: mock `execFile` calls, provide fixture JSON
- How to test keyboard navigation: `stdin.write()` in ink-testing-library
- Integration tests: `execAsync('hog board --json')` → parse JSON → assert structure
- Test fixtures with factory pattern (existing convention): `makeIssue(overrides)`

**From Code Simplicity Review — pragmatic testing approach:**
- Test data fetching and transformation logic (high value)
- Skip rendering snapshot tests initially (you'll see breakage immediately)
- Add visual regression only if you find yourself breaking the same thing twice

## Technical Approach

### Phase 1: Foundation — Configurable Repos

Extract hardcoded values into config. This is prerequisite for everything else.

**Changes:**
- `config.ts` — Add `loadRepoConfig()`, `saveRepoConfig()`, config schema types
- `github.ts` — Read repos from config instead of hardcoded `PROJECT_FIELDS` and repo array
- `sync.ts` — Read repos from config instead of hardcoded array at line 21
- `cli.ts` — Add `hog config repos`, `hog config repos add`, `hog config repos rm`, `hog config show`

**Migration:** First run auto-migrates by writing current hardcoded values to config file. Existing sync state stays valid since repo names don't change.

**Acceptance criteria:**
- [x] Repos configured in `~/.config/hog/config.json`, not hardcoded
- [x] `hog config repos` lists configured repos
- [x] `hog config repos add owner/repo` adds a new repo
- [x] `hog config repos rm owner/repo` removes a repo (warns about orphaned sync tasks)
- [x] Existing `hog sync run` works unchanged after migration
- [x] Auto-migration on first run creates config from current hardcoded values
- [x] Tests updated, coverage maintained at 80%+

#### Research Insights: Phase 1

**From Architecture Review — config versioning is critical:**
- Add `version: number` field to ConfigData BEFORE any migration
- Implement `migrateConfig()` chain: `v1→v2→v3` for future-proofing
- Backup config before migration: `config.json.backup`
- Add `hog config validate` command to verify schema

**From Security Review — config migration concerns:**
- Auto-write on first run: prompt user for confirmation (or at least log what happened)
- Ensure new config file has 0600 permissions (match existing auth.json pattern)
- Validate repo names with strict regex: `/^[\w.-]+\/[\w.-]+$/`

**From Spec Flow Analysis — missing edge cases:**
- What if config exists but is malformed/partially valid? → Validate with Zod, show helpful error
- What if migration runs twice (user deletes config)? → Must be idempotent
- What about concurrent config modifications (two terminals)? → Last-write-wins is acceptable for personal tool
- Add `hog config reset` command for recovery

**From Repo Research — existing hardcoded values to migrate:**
- `sync.ts:21` → `SYNC_REPOS = ["aibilitycz/aibility", "aibilitycz/aimee-product"]`
- `github.ts:18-29` → `PROJECT_FIELDS` with projectNumber, statusFieldId per repo

### Phase 2: Extended GitHub — All Issues

Extend `github.ts` to fetch all issues, not just Ondrej's assigned ones.

**Changes:**
- `github.ts` — New `fetchRepoIssues(repo, options)` function with filters for assignee, state, labels, limit
- `github.ts` — Remove hardcoded `--assignee ondrej-svec`, make it a parameter
- `types.ts` — Add `GitHubIssue` with assignee field, `BoardData` aggregate type

**GitHub API considerations:**
- Use `gh issue list` which handles auth and pagination
- Default limit: 100 issues per repo (configurable)
- Fetch in parallel across repos for speed
- Cache results for board display duration (no repeated fetches in one session)

**Acceptance criteria:**
- [x] `fetchRepoIssues(repo)` returns all open issues (any assignee)
- [x] `fetchRepoIssues(repo, { assignee: 'ondrej-svec' })` filters to Ondrej
- [x] Issues include: number, title, url, state, assignee login, labels, updatedAt
- [x] Existing sync uses new function with assignee filter (backward compatible)
- [ ] Parallel fetching across repos (sequential for now, sufficient for 2 repos)

#### Research Insights: Phase 2

**From Security Review — CRITICAL command injection prevention:**

The existing `github.ts` uses `execSync(`gh ${args}`)` which is vulnerable to injection. ALL `gh` calls must use `execFile` (argument array) instead of `exec` (shell string):

```typescript
// ❌ DANGEROUS: Shell injection possible
import { execSync } from "child_process";
function runGh(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf-8" }).trim();
}

// ✅ SAFE: Argument array prevents injection
import { execFileSync } from "child_process";
function runGh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf-8", timeout: 30_000 }).trim();
}

// Usage: runGh(["issue", "list", "--repo", repo, "--json", "number,title,url"])
```

**From Performance Review — parallel fetching with concurrency control:**

```typescript
async function fetchRepoData(repos: RepoConfig[], concurrency = 5): Promise<RepoData[]> {
  const results = await Promise.allSettled(
    repos.map(repo => fetchRepoIssues(repo))
  );
  return results.map((r, i) => ({
    repo: repos[i]!.name,
    data: r.status === "fulfilled" ? r.value : null,
    error: r.status === "rejected" ? r.reason : null,
  }));
}
```

**From Performance Review — GitHub API rate limiting is the biggest risk:**
- 5000 requests/hour for authenticated users
- With 2 repos + project fields: 800+ API calls per `hog board` run without caching
- **6 runs exhausts hourly limit!**
- Solution: Multi-layer cache with ETags (see Phase 3 insights)

### Phase 3: Static Board — `hog board`

The quick-glance command. Fetches data, renders beautifully, exits.

**New dependencies:** `chalk` (colors), `boxen` (bordered sections), `cli-table3` (aligned tables)

**Display layout:**
```
┌─ HOG BOARD ──────────────────────────── Feb 15, 2026 ─┐
│                                                        │
│  aibility                        aimee-product         │
│  ────────                        ────────────          │
│  In Progress                     In Progress           │
│   #89  CI pipeline    ondrej      #142 Auth refactor   │
│   #87  Billing        petr        #138 Rate limits     │
│                                                        │
│  Backlog (unassigned)            Backlog (unassigned)   │
│   #91  Docs update                #145 Mobile fixes    │
│   #90  Logging                    #143 Error pages     │
│                                                        │
│  Personal (TickTick)          3 due today / 12 total   │
│   Buy groceries          today                         │
│   Dentist appointment     tomorrow                     │
│   Review insurance        Feb 20                       │
└────────────────────────────────────────────────────────┘
```

**Changes:**
- `board/fetch.ts` — Parallel data fetching (GitHub repos + TickTick)
- `board/format-static.ts` — Render logic using chalk + boxen + cli-table3
- `cli.ts` — Add `hog board` command with `--repo`, `--mine`, `--backlog` filters
- `output.ts` — Board-specific formatting helpers

**Acceptance criteria:**
- [x] `hog board` shows all repos + TickTick in one output
- [x] Issues grouped by repo, then by status (In Progress vs Backlog)
- [x] Each issue shows: number, title, assignee (or "unassigned")
- [x] TickTick section shows tasks due today/overdue/upcoming
- [x] `--repo <name>` filters to single repo
- [x] `--mine` shows only Ondrej's assigned issues + personal tasks
- [x] `--backlog` shows only unassigned issues
- [x] `--json` outputs structured JSON (for Claude Code)
- [x] `--human` forces beautiful output even in non-TTY
- [x] Graceful error handling: if one repo fails, show others + error note
- [ ] Renders in under 5 seconds for 2 repos (not tested against live data yet)

#### Research Insights: Phase 3

**From Performance Review — CRITICAL caching layer (must implement here):**

```typescript
// board/cache.ts — multi-layer cache with ETag support
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  etag?: string;
}

class BoardCache {
  private memory = new Map<string, CacheEntry<unknown>>();
  private diskPath = join(homedir(), ".config", "hog", "cache");

  async get<T>(key: string, ttl: number): Promise<T | null> {
    // L1: Memory (0ms), L2: Disk (~5ms)
    const mem = this.memory.get(key);
    if (mem && Date.now() - mem.fetchedAt < ttl) return mem.data as T;
    // ... disk fallback
    return null;
  }

  async fetchWithETag<T>(key: string, fetcher: (etag?: string) => Promise<{ data: T; etag?: string }>): Promise<T> {
    const cached = this.memory.get(key);
    try {
      const result = await fetcher(cached?.etag);
      this.memory.set(key, { data: result.data, fetchedAt: Date.now(), etag: result.etag });
      return result.data;
    } catch {
      if (cached) return cached.data as T; // Stale fallback
      throw new Error("Fetch failed, no cache available");
    }
  }
}
```

**Cache TTL strategy:**

| Data Type | Static TTL | Live TTL | Rationale |
|-----------|-----------|----------|-----------|
| Issue list | 60s | 30s | Changes frequently |
| Project fields | 120s | 60s | Less frequent |
| TickTick tasks | 30s | 15s | Personal tasks change often |
| Repo metadata | 1 hour | 1 hour | Rarely changes |

**Expected impact:** 800 API calls/run → 50-100 (90% reduction)

**From Performance Review — lazy loading for startup speed:**

```typescript
// cli.ts — NEVER import Ink at top level
board.action(async (opts: BoardOptions) => {
  if (opts.live) {
    const { runLiveDashboard } = await import("./board/live.js");
    await runLiveDashboard(opts);
  } else {
    const { runStaticBoard } = await import("./board/static.js");
    await runStaticBoard(opts);
  }
});
```

**Startup impact:** Static mode 50-80ms (chalk only) vs Live mode 300-400ms (Ink+React)

**From Security Review — sanitize terminal output:**
Issue titles and assignee names are user-controlled and could contain ANSI escape codes:
```typescript
import stripAnsi from "strip-ansi";
function sanitize(text: string): string {
  return stripAnsi(text)
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "")
    .substring(0, 500);
}
```

**From Code Simplicity Review — consider simpler static output:**
For the static board, plain `console.log` + chalk may suffice instead of boxen + cli-table3. Save the beautiful formatting for `--live` mode. This removes 2 dependencies.

### Phase 4: Pick Command — `hog pick`

Quick issue assignment from the terminal.

**Changes:**
- `cli.ts` — Add `hog pick <repo/issue>` command
- `github.ts` — New `assignIssue(repo, issueNumber, assignee)` function
- `sync.ts` — Extend to create TickTick task on pick (reuse existing sync logic)

**Flow:**
1. Parse `repo/issue` format (e.g., `aibility/145`)
2. Verify issue exists and is unassigned (or warn if assigned to someone else)
3. Assign on GitHub via `gh issue edit --add-assignee`
4. Create TickTick task via existing sync mapping logic
5. Update sync state
6. Print confirmation

**Error handling for partial failure:**
- If GitHub assign succeeds but TickTick fails → log warning, next `hog sync run` will create the task
- No rollback (GitHub assignment is the primary action, TickTick is convenience)

**Acceptance criteria:**
- [x] `hog pick aibility/145` assigns issue #145 to Ondrej
- [x] Creates corresponding TickTick task
- [x] Updates sync state
- [x] Warns if issue is already assigned to someone (confirm to reassign)
- [x] Error if issue doesn't exist or repo not in config
- [x] `--json` outputs structured result
- [x] Partial failure (GH ok, TT fail) logs warning, doesn't crash

#### Research Insights: Phase 4

**From Security Review — CRITICAL input validation:**

```typescript
const ISSUE_PATTERN = /^([a-zA-Z0-9_-]+)\/([0-9]+)$/;

function parseIssueRef(input: string, config: HogConfig): { repo: RepoConfig; issueNumber: number } {
  const match = input.match(ISSUE_PATTERN);
  if (!match) throw new Error("Invalid format. Use: shortName/number (e.g., aibility/145)");

  const [, repoShortName, issueNum] = match;
  const repo = config.repos.find(r => r.shortName === repoShortName);
  if (!repo) throw new Error(`Unknown repo "${repoShortName}". Run: hog config repos`);

  const num = parseInt(issueNum!, 10);
  if (num < 1 || num > 999999) throw new Error("Invalid issue number");

  return { repo, issueNumber: num };
}
```

**From Security Review — use `execFile` for GitHub operations:**
```typescript
// ✅ SAFE: Argument array
execFileSync("gh", ["issue", "edit", String(issueNumber), "--repo", repoName, "--add-assignee", "@me"]);
```

**From Spec Flow Analysis — missing edge cases to handle:**
- **Already assigned to self:** No-op with message "Issue already assigned to you"
- **Assigned to someone else:** Warn + confirm to reassign
- **Issue is closed/merged:** Block with error "Cannot pick closed issue"
- **Repo not in config:** Error with hint: `hog config repos add owner/repo`
- **TickTick task already exists (from manual sync):** Skip TickTick creation, log info
- **No undo command specified:** Consider `hog drop aibility/145` for future

**From Agent-Native Review — `--dry-run` for agents:**
```bash
hog pick aibility/42 --dry-run --json
# Returns what WOULD happen without doing it:
# { "wouldAssign": "aibility#42", "wouldCreateTask": true, "currentAssignee": null }
```

**From Security Review — TOCTOU race condition:**
Check + assign is not atomic. Another user could assign between check and action. Handle gracefully:
```typescript
try {
  await assignIssue(repo, issueNumber);
} catch (err) {
  if (isAlreadyAssignedError(err)) {
    console.warn("Issue was assigned by another user during operation");
  }
}
```

### Phase 5: Interactive Dashboard — `hog board --live`

Ink-based persistent TUI with navigation and actions.

**New dependencies:** `ink`, `react`, `@inkjs/ui`

**Features:**
- Auto-refresh (configurable interval, default 60s)
- Keyboard navigation (`j/k` or arrows to move, `Enter` to open in browser, `p` to pick, `r` to refresh, `q` to quit)
- Visual refresh indicator (last updated timestamp, spinner during fetch)
- Issue detail panel (press `Enter` or `space` to expand)

**Changes:**
- `board/components/*.tsx` — Ink components for the dashboard
- `board/hooks/*.ts` — Data fetching and navigation hooks
- `cli.ts` — Add `--live` flag to `hog board`

**Acceptance criteria:**
- [x] `hog board --live` opens persistent TUI
- [x] Auto-refreshes at configured interval
- [x] `j/k` or arrows navigate between issues
- [x] `Enter` opens issue URL in browser
- [ ] `p` on unassigned issue triggers pick flow (future: wire pick into live mode)
- [x] `r` forces manual refresh
- [x] `q` exits cleanly
- [x] Shows "Last refreshed: 30s ago" indicator
- [x] Graceful degradation on fetch errors (show stale data + error note)

#### Research Insights: Phase 5 — THIS IS THE CRITICAL PHASE

**From Frontend Races Review — 6 race conditions to prevent:**

**1. Concurrent auto-refresh vs manual refresh (SEVERE):**
When user presses `r` while auto-refresh is running, two fetches fight over state. Screen flickers as results arrive in unpredictable order.

```typescript
// Fix: Request cancellation tokens
function useData() {
  const activeRequestRef = useRef<{ canceled: boolean } | null>(null);

  const refresh = useCallback(async () => {
    // Cancel in-flight request
    if (activeRequestRef.current) activeRequestRef.current.canceled = true;

    const token = { canceled: false };
    activeRequestRef.current = token;

    const results = await fetchAllData();

    if (token.canceled) return; // Stale — discard
    setState(results);
  }, []);

  useEffect(() => {
    return () => { activeRequestRef.current?.canceled = true; }; // Cleanup
  }, []);
}
```

**2. Pick action during refresh (CRITICAL):**
User picks issue → optimistic update → refresh overwrites with old data → issue appears unassigned again → next refresh shows correct state. Janky.

```typescript
// Fix: Optimistic update registry
type OptimisticUpdate = {
  id: string;
  applyToState: (state: BoardData) => BoardData;
  revertOnError: (state: BoardData) => BoardData;
};

// When refresh arrives, re-apply all pending optimistic updates on top:
function mergeRefreshData(freshData: BoardData, pending: OptimisticUpdate[]): BoardData {
  return pending.reduce((data, update) => update.applyToState(data), freshData);
}
```

**3. Navigation during data change (MODERATE):**
User selects issue at index 2. Refresh changes the list. Index 2 now points to a different issue.

```typescript
// Fix: Track selection by ID, not index
const [selectedId, setSelectedId] = useState<string | null>(null);
const selectedIndex = useMemo(() => {
  if (!selectedId) return 0;
  const idx = items.findIndex(i => i.id === selectedId);
  return idx >= 0 ? idx : 0; // Fallback if item disappeared
}, [selectedId, items]);
```

**4. Timer cleanup on unmount (SEVERE):**
If component unmounts while interval is running, callback fires on dead component.

```typescript
useEffect(() => {
  const timer = setInterval(refresh, intervalMs);
  return () => clearInterval(timer); // MUST clean up
}, [refresh, intervalMs]);
```

**5. Partial failures (MODERATE):**
Use `Promise.allSettled()` — show partial data + error indicator per section.

**6. Status message conflicts (MINOR):**
Multiple async ops updating status bar simultaneously. Use message queue with priorities.

**From TypeScript Review — navigation should use reducer pattern:**

```typescript
type NavState = {
  readonly selectedSection: "github" | "ticktick";
  readonly selectedId: string | null;
};

type NavAction =
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN" }
  | { type: "NEXT_SECTION" }
  | { type: "SELECT"; id: string };

function navReducer(state: NavState, action: NavAction): NavState {
  // Pure function — easy to test without hooks
}

// In component: const [nav, dispatch] = useReducer(navReducer, initialNav);
```

**From Performance Review — virtual scrolling for large lists:**

```typescript
function IssueList({ issues, selectedIndex, maxVisible = 20 }) {
  const [, rows] = useStdoutDimensions();
  const visible = Math.min(maxVisible, rows - 10);
  const start = Math.max(0, selectedIndex - Math.floor(visible / 2));
  const end = Math.min(issues.length, start + visible);

  return (
    <Box flexDirection="column">
      {start > 0 && <Text dimColor>↑ {start} more above</Text>}
      {issues.slice(start, end).map((issue, idx) => (
        <IssueRow key={issue.id} issue={issue} isSelected={start + idx === selectedIndex} />
      ))}
      {end < issues.length && <Text dimColor>↓ {issues.length - end} more below</Text>}
    </Box>
  );
}
```

**From Performance Review — adaptive refresh saves rate limits:**

```typescript
// Slow down refresh when user is idle (no keypress for 5 min)
let idleMs = 0;
const interval = setInterval(() => {
  idleMs += refreshInterval;
  if (idleMs > 5 * 60 * 1000) {
    // Slow to 5-minute intervals after idle
    currentInterval = 5 * 60 * 1000;
  }
  refresh();
}, currentInterval);

// Reset on any user interaction
const resetIdle = () => { idleMs = 0; currentInterval = refreshInterval; };
```

**From Performance Review — memory management for long sessions:**
- Without cleanup: 2.4GB after 8 hours (memory leak from accumulated data)
- With cleanup: 65MB stable
- Keep only last 3 data snapshots (LRU cache)
- Clean up on SIGINT: `process.on("SIGINT", () => { unmount(); process.exit(0); })`

**From Ink Framework Research — Ink's Static component for performance:**
Use `<Static>` for items that don't need re-rendering (completed tasks, history):
```typescript
<Static items={completedTasks}>
  {(task) => <Text key={task.id} color="green">✓ {task.title}</Text>}
</Static>
```

**Performance budget (from Performance Review):**

| Metric | Target | Without Optimization | With Optimization |
|--------|--------|---------------------|-------------------|
| Startup (static) | <100ms | 300-500ms | 50-80ms |
| Startup (live) | <500ms | 300-500ms | 300-400ms |
| Data fetch (cold) | <2s | 2.4s | 600ms |
| Data fetch (cached) | <200ms | N/A | 50-150ms |
| Rate limit/hour | <1000 | 4800 | 600 |
| Memory (8h) | <100MB | 2.4GB | 65MB |
| Render (100 items) | <50ms | 50ms+ | 5ms |

### Phase 6 (Future): Slack Integration — The Full Cockpit

**Not in MVP.** Architecture should accommodate it. But the vision is compelling.

**The idea:** A simplified Slack client built into the cockpit. Channels, DMs, threads, messages — all visible alongside tasks and issues. Reply directly from the TUI. Link conversations to specific GitHub issues.

**Potential display:**

```
┌─ SLACK ──────────────────────────────────────────────┐
│  #aimee-dev      "deployed v2.3 to staging"    jan   │
│  #general        "standup in 5 min"            petr  │
│  DM: jan         "can you review #142?"        2m    │
│                                                       │
│  Thread on #142:                                      │
│    jan: auth refactor ready for review                │
│    > ondrej: looking at it now                        │
│    > jan: thx, also check the migration               │
│                                                       │
│  [r]eply  [t]hread  [m]ark read  [Tab] next section  │
└───────────────────────────────────────────────────────┘
```

**Capabilities:**
- **Read:** Show unread mentions, DMs, channel highlights in a board section
- **Reply:** Type a response inline, post to Slack thread
- **Link:** Connect Slack threads to GitHub issues (via issue number detection)
- **Notify:** Post to a channel when picking up or completing an issue

**Architecture hook:** The `board/fetch.ts` module uses a plugin/provider pattern where data sources (GitHub, TickTick, Slack) are independent. Adding Slack means adding a new provider, not modifying existing ones.

```typescript
// board/fetch.ts — provider pattern
interface DataProvider {
  name: string;
  fetch(): Promise<BoardSection>;
  // Future: action support
  actions?: Record<string, (params: unknown) => Promise<void>>;
}

const providers: DataProvider[] = [
  new GitHubProvider(config),
  new TickTickProvider(config),
  // new SlackProvider(config),  // Future: channels, DMs, threads
];
```

**Slack API requirements:**
- Slack Web API for reading channels/DMs (`conversations.list`, `conversations.history`)
- Slack Web API for posting (`chat.postMessage`)
- Socket Mode or Events API for real-time updates in `--live` mode
- OAuth 2.0 bot token (similar pattern to TickTick auth in `auth.ts`)

## Dependencies & Risks

**Dependencies:**
- `gh` CLI installed and authenticated (existing requirement)
- TickTick OAuth token valid (existing requirement)
- New npm packages: `ink`, `react`, `chalk`, `boxen`, `cli-table3`, `@inkjs/ui`

**Risks:**

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GitHub API rate limiting | Medium | Board shows stale data | Cache responses, respect rate limits, show cached data with warning |
| Ink adds significant bundle size | Low | Slower CLI startup | Lazy-load Ink only for `--live` mode |
| TickTick API changes/breaks | Low | Sync stops working | Existing risk, no change |
| Large backlog overwhelming display | Medium | Unusable board | Default limit of 20 backlog items, configurable |
| Config migration breaks existing sync | Medium | Lost task mappings | Auto-migration with backup of old state |

### Research Insights: Dependencies & Security

**From Security Review — OWASP compliance matrix:**

| Category | Status | Finding |
|----------|--------|---------|
| Injection | **NON-COMPLIANT** | Command injection via `exec` → fix with `execFile` |
| Cryptographic Failures | **NON-COMPLIANT** | Plaintext auth.json → consider OS keychain (`keytar`) |
| Insecure Design | PARTIAL | Missing input validation → add regex patterns |
| Security Misconfiguration | PARTIAL | Over-privileged GitHub tokens → document required scopes |

**Security remediation priority:**
1. **Immediate**: Use `execFile` for all `gh` calls. Validate all user input with regex.
2. **Week 1**: Sanitize terminal output (strip ANSI from issue titles). Add audit logging.
3. **Month 1**: Consider OS keychain for tokens. Set up `npm audit` in CI.

**From Performance Review — dependency isolation strategy:**

```json
{
  "dependencies": { "commander": "^13.0.0" },
  "optionalDependencies": { "chalk": "^5.0.0" },
  "peerDependencies": {
    "ink": "^6.0.0",
    "react": "^18.0.0"
  },
  "peerDependenciesMeta": {
    "ink": { "optional": true },
    "react": { "optional": true }
  }
}
```

Static mode: 85KB (chalk only). Full install with Ink: 2.8MB. 97% reduction for default install.

**New risks identified by review agents:**

| Risk | Source | Likelihood | Impact | Mitigation |
|------|--------|-----------|--------|------------|
| Command injection via `gh` calls | Security Review | High | Critical | Use `execFile`, validate inputs |
| Race conditions in --live mode | Races Review | High | High | Request cancellation, optimistic updates |
| Memory leaks in long TUI sessions | Performance Review | Medium | High | LRU cache, cleanup on exit |
| Two rendering paths drift apart | Architecture Review | Medium | Medium | Shared view model layer |
| Rate limit exhaustion without cache | Performance Review | High | High | Multi-layer cache with ETags |
| 0/9 commands have --json for agents | Agent-Native Review | Certain | Medium | Add --json to ALL commands |

## Implementation Order

```
Phase 1 (Foundation)     →  Phase 2 (GitHub)  →  Phase 3 (Static Board)
                                                        ↓
Phase 4 (Pick)           ←────────────────────  Phase 3 done
        ↓
Phase 5 (Live TUI)
        ↓
Phase 6 (Slack - future)
```

**Suggested pace:** Phases 1-3 are one work session each. Phase 4 is quick (reuses existing sync logic). Phase 5 is the largest (Ink setup + components).

### Research Insights: Implementation Order

**From Code Simplicity Review — consider merging phases:**

Original (6 phases) → Simplified (3 phases):
1. **Data + Config + JSON output** (Phases 1+2+3 merged): Get `hog board --json` working end-to-end
2. **Interactive TUI** (Phases 4+5 merged): Ink components + pick action in one go
3. **Polish** (ongoing): Add features only if you actually use the tool daily

**Ship in 1 week instead of 3.**

**From Architecture Review — parallel tracks:**
Phase 4 (pick) is independent of Phase 5 (TUI). They can be developed in parallel if desired:
```
Phase 1 → Phase 2 → Phase 3 → Ship static board
                                    ↓
                              Phase 4 (pick) + Phase 5 (TUI) in parallel
```

**From Agent-Native Review — update CLAUDE.md after Phase 3:**
Once `hog board --json` works, immediately update CLAUDE.md with:
```markdown
# Board commands
hog board --json              # Full board data
hog board --mine --json       # My issues + tasks
hog board --backlog --json    # Unassigned issues
hog pick aibility/145 --json  # Assign + sync
```

## References

### Codebase
- Current `hog` source: `hog/src/` (TypeScript, Commander.js, Vitest)
- Config location: `~/.config/hog/`
- Sync state: `~/.config/hog/sync-state.json`
- Auth: `~/.config/hog/auth.json` (0600 perms)
- GitHub repos: `aibilitycz/aibility`, `aibilitycz/aimee-product`

### Libraries
- Ink (React for CLI): https://github.com/vadimdemedes/ink
- ink-testing-library: https://github.com/vadimdemedes/ink-testing-library
- @inkjs/ui (component library): https://github.com/vadimdemedes/ink-ui
- Chalk 5.x (colors): https://github.com/chalk/chalk
- Boxen (borders): https://github.com/sindresorhus/boxen
- cli-table3 (tables): https://github.com/cli-table/cli-table3

### Inspiration
- gh-dash (TUI GitHub dashboard): https://github.com/dlvhdr/gh-dash
- gh-dash theming: https://dlvhdr.github.io/gh-dash/configuration/theme/
- lazygit (TUI UX patterns): https://github.com/jesseduffield/lazygit

### Design Resources
- 4bit Terminal Color Scheme Designer: https://ciembor.github.io/4bit/
- terminal.sexy (theme designer): https://terminal.sexy/
- Catppuccin palette: https://github.com/catppuccin
- WCAG contrast checker: https://webaim.org/resources/contrastchecker/

---

## Appendix A: Simplification Decision Matrix

The Code Simplicity Reviewer identified significant YAGNI violations. This matrix helps decide what to keep vs cut for v1:

| Element | Keep for v1? | Rationale |
|---------|-------------|-----------|
| `hog board` (static) | **YES** | Core feature, quick glance |
| `hog board --live` (Ink TUI) | **YES** | Main value prop, the whole point |
| `hog pick` | **YES** | Key workflow action |
| `hog config repos` | **YES** | Required for configurable repos |
| Theme system (dark/light) | **NO** | Hardcode one good palette. Add later if needed. |
| DataProvider plugin interface | **NO** | Just call GitHub + TickTick directly. Extract when adding 3rd source. |
| 3 responsive breakpoints | **NO** | Two cases: narrow (<80) and normal. |
| cli-table3 + boxen | **MAYBE** | Try chalk-only first. Add if output looks bad. |
| @inkjs/ui components | **YES** | Spinner, Badge save time |
| ink-testing-library | **YES** | Test data logic + key interactions |
| Snapshot tests | **NO** | Add later if visual regressions become a problem |
| Preview/dev harness | **YES** | One `dev.tsx` file, <30 LOC. Useful during development. |
| Shared test fixtures | **YES** | Existing pattern. Reuse `makeTask()` factory. |

**Recommended v1 target: ~400 LOC** (down from ~1000 in original plan)

## Appendix B: Complete Type Definitions (Pre-Implementation)

Types that MUST be defined before writing any implementation code:

```typescript
// types.ts additions

// ── Config Types ──
export interface RepoConfig {
  readonly name: string;          // "aibilitycz/aibility"
  readonly shortName: string;     // "aibility"
  readonly projectNumber: number;
  readonly statusFieldId: string;
  readonly completionAction: CompletionAction;
}

export type CompletionAction =
  | { readonly type: "updateProjectStatus"; readonly optionId: string }
  | { readonly type: "closeIssue" }
  | { readonly type: "addLabel"; readonly label: string };

export interface BoardConfig {
  readonly refreshInterval: number;
  readonly backlogLimit: number;
  readonly assignee: string;
}

export interface HogConfig {
  readonly version: number;
  readonly defaultProjectId: string;
  readonly repos: readonly RepoConfig[];
  readonly board: BoardConfig;
}

// ── Board Data Types ──
export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly assignee: string | null;
  readonly labels: readonly string[];
  readonly updatedAt: string;
  readonly repo: string;
}

export interface BoardData {
  readonly github: Result<GitHubIssue[], FetchError>;
  readonly ticktick: Result<Task[], FetchError>;
  readonly fetchedAt: Date;
}

// ── Result Type (no throwing in data layer) ──
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface FetchError {
  readonly type: "github" | "ticktick" | "network";
  readonly message: string;
  readonly statusCode?: number;
}

// ── UI State (discriminated union) ──
export type DataState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly data: BoardData; readonly lastRefresh: Date }
  | { readonly status: "error"; readonly error: FetchError; readonly staleData?: BoardData };

// ── Pick Command ──
export interface PickResult {
  readonly success: boolean;
  readonly issue: GitHubIssue;
  readonly ticktickTask?: Task;
  readonly warning?: string;
}
```

## Appendix C: Agent Workflow Example

After implementing with `--json` on all commands, this Claude Code workflow becomes possible:

```
User: "What should I work on next?"

Claude: hog board --mine --json
→ Parses: 3 assigned issues, 2 due TickTick tasks

Claude: "You have 3 GitHub issues and 2 personal tasks. I'd suggest
aibility#42 (Add authentication) — it's highest priority and blocks
other work. Want me to check the backlog too?"

User: "Yes, and pick up anything quick from backlog"

Claude: hog board --backlog --json
→ Finds: aimee#145 labeled "quick-win"

Claude: hog pick aimee/145 --dry-run --json
→ Confirms: would assign + create TickTick task

Claude: hog pick aimee/145 --json
→ Success: assigned + TickTick task created

Claude: "Done. Picked up aimee#145 (Mobile fixes) — labeled quick-win,
now in your TickTick inbox. Your board now shows 4 assigned issues."
```

## Appendix D: References from Research

### Ink Framework (v6.6.0)
- `useInput(callback)` for keyboard handling — supports arrows, vim keys, modifiers
- `useFocus({ id, autoFocus })` + `useFocusManager()` for section navigation
- `useStdout()` for terminal dimensions (auto re-renders on resize)
- `<Static>` component for append-only content (performance optimization)
- `React.lazy` + `<Suspense>` supported for code splitting
- `ink-testing-library`: `render()` → `lastFrame()`, `stdin.write()` for input simulation

### @inkjs/ui Components
- `Select` — scrollable option list with `isDisabled`, `visibleOptionCount`
- `Spinner` — loading indicators with customizable label
- `Badge` — status indicators (`<Badge color="green">Pass</Badge>`)
- `ThemeProvider` + `extendTheme()` — built-in theming system

### CLI Best Practices (2025-2026)
- **gh-dash patterns**: Section-based layout, context-aware help, vim+arrow key navigation
- **Caching**: Stale-while-revalidate with GitHub ETags for conditional requests
- **Colors**: Chalk auto-detects terminal capabilities, respect `NO_COLOR`/`FORCE_COLOR`
- **Startup**: Lazy load heavy deps, fast path for `--version`/`--help`
- **Testing**: ink-testing-library for component tests, `execAsync` for integration tests

### Catppuccin Palette (recommended for terminal themes)
- 4 flavors: Latte (light), Frappé, Macchiato, Mocha (dark)
- 26 colors per flavor, designed for terminal readability
- Auto-detect macOS dark/light: `defaults read -g AppleInterfaceStyle`
