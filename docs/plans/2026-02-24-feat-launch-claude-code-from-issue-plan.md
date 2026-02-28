---
title: "Launch Claude Code from Issue (C shortcut)"
type: feat
status: completed
date: 2026-02-24
deepened: 2026-02-24
brainstorm: docs/brainstorms/2026-02-24-launch-claude-code-from-issue-brainstorm.md
---

# Launch Claude Code from Issue (`C` shortcut)

## Overview

Press `C` on any issue in the hog board and instantly open a Claude Code session in the correct local repo directory — pre-loaded with the issue's context. Collapses "I see this issue → I want to start working on it with Claude" to a single keypress.

**Example flow:**
1. Issue selected: `Fix login bug (#42)` in `aimee-product`
2. Press `C`
3. New tmux window opens: `claude` running in `/Users/me/code/aimee-product`
4. Claude receives: `Issue #42: Fix login bug\nURL: https://github.com/...`

---

## Proposed Solution

- Add `C` (uppercase) keyboard binding in `normal` and `overlay:detail` modes
- Add optional `localPath` and `claudeStartCommand` to `RepoConfig` in config schema
- Add optional `claudeStartCommand`, `claudeLaunchMode`, and `claudeTerminalApp` to `BoardConfig`
- Launch via tmux (`new-window`) when in tmux; fall back to a new OS terminal window otherwise
- Show a toast if `localPath` is not configured for the repo
- Add `hog launch <issueRef>` CLI command for agent-native parity

---

## Technical Considerations

### Launch mechanism

**tmux path** (preferred, works in SSH environments):
```typescript
import { spawn } from "node:child_process";

// detect: process.env.TMUX
// MUST use spawn + unref(), not execFileSync — execFileSync blocks the Ink render loop
// MUST include -d — without it tmux steals focus from the hog board
const child = spawn(
  "tmux",
  [
    "new-window",
    "-d",                                // don't steal focus from hog board
    "-c", localPath,                      // working directory
    "-n", `claude-${issue.number}`,       // named window for navigation
    "-e", `HOG_ISSUE=${issue.number}`,    // env vars for context (safe, no injection)
    "-e", `HOG_REPO=${repoFullName}`,
    "claude", "--", buildPrompt(issue),   // -- prevents title content from being parsed as flags
  ],
  { stdio: "ignore", detached: true }
);
child.unref(); // fire and forget; hog continues
```

**Why `spawn` + `unref()` instead of `execFileSync`:**
The existing `openInBrowser` pattern uses `execFileSync` because `open` exits in milliseconds. Spawning a new tmux window or terminal may take longer and must not block the Ink render loop. `spawn` with `detached: true` + `child.unref()` is the correct fire-and-forget pattern.

**Why `--` before the prompt:**
Without `--`, an issue title like `--version` or `--dangerously-skip-permissions` would be parsed as a claude CLI flag. The `--` signals end-of-flags to POSIX-compliant parsers. The entire string after `--` arrives verbatim in claude's argv.

**terminal fallback** (when not in tmux):
- Detect terminal via `$TERM_PROGRAM` — see detection table below
- Override via `claudeTerminalApp` config field (must be enum, not free-form)

**Startup prompt delivery (confirmed working):**
`claude -- "PROMPT_TEXT"` works as a positional arg — the interactive REPL auto-sends the initial message and stays open. No flag needed, no piping required.

```typescript
function buildPrompt(issue: Pick<BoardIssue, "number" | "title" | "url">): string {
  // execFileSync/spawn with args array passes this verbatim to the OS.
  // No shell escaping needed — ", ', `, $, \n all arrive as literal bytes.
  return `Issue #${issue.number}: ${issue.title}\nURL: ${issue.url}`;
}
```

**Shell escaping: use args array, never shell string**
`execFileSync`/`spawn` with an args array bypasses the shell entirely — no escaping is needed. An issue title like `Fix "login" bug $(rm -rf ~)` arrives verbatim in claude's argv. Never use `execSync` with a template string for this. `JSON.stringify` is NOT a shell escaping function (`JSON.stringify("Fix $PATH")` → `'"Fix $PATH"'` which still expands `$PATH` in a shell).

**Terminal detection table (`$TERM_PROGRAM` values):**

| Terminal | `$TERM_PROGRAM` | Launch command |
|----------|-----------------|----------------|
| iTerm2 | `iTerm.app` | AppleScript via `osascript` (most reliable for cwd) |
| Terminal.app | `Apple_Terminal` | `open -a Terminal /path` (correctly sets cwd) |
| WezTerm | `WezTerm` | `wezterm start --cwd /path` |
| Ghostty | `ghostty` | `open -na Ghostty --args --working-directory=/path` |
| kitty | *(not set)* | Detect via `KITTY_WINDOW_ID`; use `kitty --directory /path` |
| Alacritty | *(not set)* | `alacritty --command bash -c "cd /path && exec bash"` |
| gnome-terminal | *(not set)* | Detect via `VTE_VERSION`; use `gnome-terminal --working-directory=/path` |
| konsole | *(not set)* | Detect via `KONSOLE_VERSION`; use `konsole --workdir /path` |

**Linux universal fallback:** `xdg-terminal-exec bash -c "cd /path && exec bash"` (Ubuntu 25.04+, available via manual install on others).

**macOS final fallback:** `open -a Terminal /path` — Terminal.app is always present.

**SSH without tmux:** Check `SSH_CLIENT` / `SSH_TTY`. If in an SSH session without `$TMUX` set, opening a local terminal is impossible. Show toast: "Running over SSH without tmux — start tmux to enable Claude Code launch."

### Config schema changes (no migration needed — all fields optional)

**`REPO_CONFIG_SCHEMA`** additions:
```typescript
// Absolute path to local clone of this repo
localPath: z.string()
  .refine((p) => isAbsolute(p), { message: "localPath must be an absolute path" })
  .refine((p) => normalize(p) === p, { message: "localPath must be normalized (no .. segments)" })
  .refine((p) => !p.includes("\0"), { message: "localPath must not contain null bytes" })
  .optional(),

// Per-repo Claude startup command (overrides board-level)
// Structured as { command, extraArgs } — NOT a free-form string — to prevent command injection.
// A free-form string split on spaces would allow e.g. "sh -c evil" to execute arbitrary commands.
claudeStartCommand: z.object({
  command: z.string().min(1),       // binary name (e.g. "claude")
  extraArgs: z.array(z.string()),   // args array (e.g. ["--append-system-prompt", "..."])
}).optional(),
```

**`BOARD_CONFIG_SCHEMA`** additions:
```typescript
// Default Claude startup command for all repos (repo-level overrides this)
claudeStartCommand: z.object({
  command: z.string().min(1),
  extraArgs: z.array(z.string()),
}).optional(),

// Launch mode: auto = detect $TMUX, tmux = force tmux, terminal = force terminal window
claudeLaunchMode: z.enum(["auto", "tmux", "terminal"]).default("auto"),

// Terminal app override — enum allowlist, NOT z.string().
// A free-form string used as an executable name would allow config-level arbitrary binary execution.
claudeTerminalApp: z.enum([
  "Terminal",    // Terminal.app (macOS)
  "iTerm",       // iTerm2 (macOS)
  "Ghostty",     // Ghostty (macOS/Linux)
  "WezTerm",     // WezTerm (cross-platform)
  "Kitty",       // kitty (cross-platform)
  "Alacritty",   // Alacritty (cross-platform)
]).optional(),
```

Since all fields are optional (or have defaults), no version bump or migration block is needed — Zod will coerce missing keys to `undefined`.

**Why structured `claudeStartCommand` instead of a string:**
A free-form string like `"claude --append-system-prompt"` must be split on spaces before being passed to `execFileSync`. This split is trivially exploitable: `"sh -c 'rm -rf ~'"` would pass `sh` as the command and `-c 'rm -rf ~'` as arguments, executing arbitrary code. By storing `{ command, extraArgs[] }` directly, each element is a discrete argv value — injection is structurally impossible.

**Why `claudeTerminalApp` is an enum:**
A free-form string would be passed to `execFileSync("open", ["-a", claudeTerminalApp, ...])` on macOS. Setting `claudeTerminalApp: "/bin/sh"` would execute the shell. The enum limits values to known-safe terminal applications.

### New utility: `src/board/launch-claude.ts`

Extract all launch logic here. Keeps `dashboard.tsx` clean and the logic independently testable.

```typescript
// src/board/launch-claude.ts
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { BoardIssue } from "../../types.js";
import type { Result } from "../../types.js"; // Already exists in src/types.ts

export type LaunchFailureReason =
  | "no-local-path"
  | "directory-not-found"      // localPath set but doesn't exist on disk
  | "claude-not-found"          // claude binary not in PATH
  | "tmux-failed"
  | "terminal-failed"
  | "terminal-app-not-found";   // claudeTerminalApp configured but app not installed

export interface LaunchError {
  readonly kind: LaunchFailureReason;
  readonly message: string;   // shown directly in toast
  readonly cause?: Error;     // original thrown error (preserves stack trace for logging)
}

// Reuses the existing Result<T, E> generic from src/types.ts
export type LaunchResult = Result<void, LaunchError>;

export interface LaunchClaudeOptions {
  readonly localPath: string;
  readonly issue: Pick<BoardIssue, "number" | "title" | "url">;
  readonly startCommand?: { command: string; extraArgs: readonly string[] }; // already-resolved: repo > board > none
  readonly launchMode?: "auto" | "tmux" | "terminal";
  readonly terminalApp?: string; // value from the enum, already validated by Zod
}

export function launchClaude(opts: LaunchClaudeOptions): LaunchResult { ... }
```

**Key implementation notes:**
- Call `existsSync(opts.localPath)` before spawning — return `{ ok: false, error: { kind: "directory-not-found", ... } }` if missing
- Check `claude` in PATH via `spawnSync("which", ["claude"], { stdio: "pipe" })` — return `{ ok: false, error: { kind: "claude-not-found", ... } }` if missing
- All `spawn`/`spawnSync` calls use args arrays (never shell strings)
- `stdio: "ignore"` always — Ink owns the terminal; `"inherit"` would conflict with Ink's raw mode

### Keyboard wiring

1. **`src/board/hooks/use-keyboard.ts`**: add `handleLaunchClaude: () => void` to `KeyboardActions` interface; add `if (input === "C") { handleLaunchClaude(); return; }` in the `canAct || overlay:detail` guard block (after the `e` binding, ~line 218). No state machine changes needed.

2. **`src/board/components/dashboard.tsx`**: define `handleLaunchClaude` as `useCallback` (pattern: same as `handleCopyLink` ~line 793). Resolve repo config, call `launchClaude()`, show appropriate toast.

**`handleLaunchClaude` implementation sketch:**
```typescript
const handleLaunchClaude = useCallback(() => {
  // findIssueContext (use-actions.ts:78) already does this lookup — reuse the same pattern
  const found = findSelectedIssueWithRepo(repos, nav.selectedId);
  if (!found) return; // cursor on header / empty row → silent no-op

  const rc = config.repos.find((r) => r.name === found.repoName);
  if (!rc?.localPath) {
    toast.info(
      `Set localPath for ${rc?.shortName ?? found.repoName} in ~/.config/hog/config.json to enable Claude Code launch`
    );
    return;
  }

  const result = launchClaude({
    localPath: rc.localPath,
    issue: found.issue,
    // Precedence: repo-level overrides board-level (resolved here, not inside launchClaude)
    startCommand: rc.claudeStartCommand ?? config.board.claudeStartCommand,
    launchMode: config.board.claudeLaunchMode,
    terminalApp: config.board.claudeTerminalApp,
  });

  if (!result.ok) {
    toast.error(result.error.message);
    return;
  }

  toast.info(`Claude Code session opened in ${rc.shortName ?? found.repoName}`);
}, [repos, nav.selectedId, config, toast]);
```

**Why `dashboard.tsx`, not `use-actions.ts`:**
`use-actions.ts` owns async GitHub/TickTick mutations. Launching a local process has no remote state, no loading phase, no refresh cycle. It belongs alongside `handleOpen` and `handleCopyLink` — both in `dashboard.tsx`.

**`claudeStartCommand` precedence:** Resolve at the call site in `dashboard.tsx` (`rc.claudeStartCommand ?? config.board.claudeStartCommand`). The utility receives an already-resolved value. This keeps `launchClaude()` decoupled from the config schema.

### Hint bar + help overlay

- **`hint-bar.tsx` line 87**: add `C:claude` to panel 3 normal-mode string
- **`hint-bar.tsx` lines 63-72**: add `C:claude` to `overlay:detail` hint text
- **`help-overlay.tsx` ~line 42**: add `{ key: "C", desc: "Launch Claude Code session for this issue" }` to Actions category

**Hint bar truncation:** The panel 3 hint string is already long. `C:claude` makes it longer. On narrow terminals (common in split-pane tmux), hints at the end become invisible — this is acceptable. The `?` help overlay always shows all shortcuts at any width.

### Agent-Native Parity: `hog launch` CLI Command

The `C` keyboard shortcut creates a parity gap — agents cannot trigger this capability without the TUI. Add `hog launch <issueRef>` as a top-level CLI command in `src/cli.ts`:

```typescript
program
  .command("launch <issueRef>")
  .description("Launch Claude Code for an issue in its local repo directory")
  .option("--dry-run", "Print resolved config without spawning")
  .action(async (issueRef: string, opts: { dryRun?: boolean }) => {
    // 1. Load config
    // 2. Resolve issue ref (reuse parseIssueRef pattern from src/pick.ts)
    // 3. Find localPath for the repo
    // 4. If --dry-run: jsonOut({ localPath, command, launchMode }) and exit
    // 5. Call launchClaude() from src/board/launch-claude.ts
    // 6. useJson() → jsonOut({ ok: true/false, ... }) or human-readable output
  });
```

**`--dry-run` is essential for agent use** — agents must be able to inspect what would happen before spawning a process.

---

## Acceptance Criteria

**Core behavior:**
- [ ] Pressing `C` on a selected issue (normal mode) opens Claude Code in the issue's repo directory
- [ ] Pressing `C` from `overlay:detail` mode also works; detail overlay stays open (no mode change)
- [ ] If in tmux (`$TMUX` set): new tmux window opens in `localPath` with `-d` flag (no focus steal) and `-n claude-<number>` name
- [ ] If not in tmux: new OS terminal window opens in `localPath`
- [ ] `claudeLaunchMode: "tmux"` forces tmux; `"terminal"` forces terminal window; `"auto"` (default) detects
- [ ] hog board continues running normally after launch (no state change, no blocking)

**Configuration:**
- [ ] If `localPath` not set for repo: toast "Set localPath for `<shortName>` in ~/.config/hog/config.json to enable Claude Code launch"
- [ ] If `claudeStartCommand` set (per-repo or board-level): issue context is appended as `{ command: "claude", extraArgs: ["--", prompt] }`
- [ ] Repo-level `claudeStartCommand` takes precedence over board-level when both are set
- [ ] `claudeTerminalApp` overrides terminal detection

**Guard clauses:**
- [ ] `C` on a header row, empty-state row, or with empty list: silent no-op, no toast
- [ ] `C` in `multiSelect` mode: silent no-op (consistent with other actions in that mode)
- [ ] Lowercase `c` still opens the comment overlay — `C` does not affect it

**Error handling:**
- [ ] If `localPath` is configured but directory doesn't exist on disk: toast "Directory not found: `<localPath>`. Check localPath config for `<shortName>`."
- [ ] If `claude` binary is not in PATH: toast "claude binary not found in PATH. Install Claude Code first."
- [ ] If tmux launch fails (e.g. server not running) and `launchMode` is `"auto"`: fall back to terminal path; if terminal also fails, show error toast
- [ ] If `launchMode: "tmux"` is forced and tmux fails: toast "tmux launch failed. Is tmux running?" — no fallback
- [ ] If `claudeTerminalApp` is configured but app not found: toast naming the missing app

**UX:**
- [ ] On successful launch: info toast "Claude Code session opened in `<shortName>`"
- [ ] Issue prompt uses `--` separator: `claude -- "Issue #42: <title>\nURL: <url>"`
- [ ] `C` hint visible in hint bar (normal mode and detail overlay)
- [ ] `C` visible in help overlay (`?`)

**Agent-native:**
- [ ] `hog launch <issueRef>` CLI command calls the same `launchClaude()` utility as the keyboard shortcut
- [ ] `hog launch --dry-run <issueRef>` prints resolved config without spawning
- [ ] `hog launch` supports `--json` output following existing `jsonOut()` pattern

**Tests:**
- [ ] Unit tests for `launch-claude.ts`: tmux path, terminal fallback, missing localPath, directory-not-found, claude-not-found, shell-unsafe title chars (single quote, double quote, backtick, `$`, backslash, newline)
- [ ] Tests use `vi.mock("node:child_process", ...)` with the `node:` prefix (ESM-correct)
- [ ] Tests use `vi.stubEnv("TMUX", ...)` for env var isolation

---

## Dependencies & Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **`-d` flag missing from original plan** | High | Add `-d` to `tmux new-window` args. Without it tmux steals focus from the board. |
| **`execFileSync` blocks Ink render loop** | High | Use `spawn` + `detached: true` + `child.unref()` instead of `execFileSync` for all process launches. |
| **Flag injection via issue title** | Medium | Always add `--` before the prompt arg: `["claude", "--", buildPrompt(issue)]`. Prevents issue titles like `--dangerously-skip-permissions` from being parsed as flags. |
| **`claudeStartCommand` as free-form string** | High | Use `{ command, extraArgs[] }` struct in Zod schema. Free-form string split on spaces = command injection. |
| **`claudeTerminalApp` as free-form string** | High | Use `z.enum([...allowlist])`. Free-form string used as executable name = arbitrary binary execution via config. |
| **`localPath` path traversal** | Medium | Add Zod refinements: `isAbsolute`, `normalize(p) === p`, no null bytes. Also check `existsSync` at launch time. |
| **Terminal app detection fragility** | Low | `$TERM_PROGRAM` is well-supported across macOS terminals. `claudeTerminalApp` enum provides override. Linux: check `VTE_VERSION`, `KONSOLE_VERSION`. `xdg-terminal-exec` as modern Linux fallback. |
| **SSH without tmux** | Low | Check `SSH_CLIENT`/`SSH_TTY`. Show actionable toast; don't attempt terminal open. |
| **`claude` binary missing** | Low | Check via `spawnSync("which", ["claude"])` before spawning. Show specific toast. |

---

## References

### Internal (from repo research)

- Config schema: `src/config.ts:27-55` — REPO_CONFIG_SCHEMA, BOARD_CONFIG_SCHEMA, migration pattern
- Existing `Result<T, E>` type: `src/types.ts` — reuse for `LaunchResult = Result<void, LaunchError>`
- `findIssueContext`: `src/board/hooks/use-actions.ts:78` — pattern for resolving selected issue + repo config
- Fire-and-forget launch pattern: `src/board/components/dashboard.tsx:248-255` — `openInBrowser`
- Terminal takeover (do NOT use): `src/board/components/edit-issue-overlay.tsx:206` — `spawnSync` with `stdio: "inherit"`
- Keyboard binding block: `src/board/hooks/use-keyboard.ts:197-219` — `canAct || overlay:detail` guard
- `C` currently unbound: `src/board/hooks/use-keyboard.test.ts:627` — "C does nothing (collapse-all removed)"
- Existing uppercase key bindings: `use-keyboard.ts` — `"R"`, `"L"`, `"I"`, `"F"` — all use `input === "X"` pattern
- Toast API: `src/board/hooks/use-toast.ts:11-16` — `info`, `success`, `error`, `loading`
- Hint bar normal hints: `src/board/components/hint-bar.tsx:87`
- Hint bar detail overlay hints: `src/board/components/hint-bar.tsx:63-72`
- Help overlay actions: `src/board/components/help-overlay.tsx:42`
- Issue ref resolution: `src/pick.ts` — `parseIssueRef` pattern for `hog launch` CLI command
- `jsonOut` / `useJson` pattern: `src/cli.ts` throughout

### External

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) — confirms `claude "prompt"` positional arg, `--append-system-prompt`, `--print`
- tmux `man tmux` — `-d`, `-c`, `-n`, `-e` flags for `new-window`
- [Ghostty `--working-directory` bug](https://github.com/ghostty-org/ghostty/discussions/9508) — use `open -na Ghostty --args --working-directory=/path` on macOS

---

## Files to Touch

| File | Change |
|------|--------|
| `src/config.ts` | Add `localPath` (with Zod refinements), `claudeStartCommand` (`z.object`) to REPO_CONFIG_SCHEMA; add `claudeStartCommand`, `claudeLaunchMode`, `claudeTerminalApp` (enum) to BOARD_CONFIG_SCHEMA |
| `src/board/launch-claude.ts` | **New file** — all launch logic using `Result<void, LaunchError>` from `src/types.ts`; `spawn` + `unref()`; args array throughout |
| `src/board/launch-claude.test.ts` | Unit tests: tmux path, terminal fallback, missing localPath, directory-not-found, claude-not-found, shell-unsafe title chars |
| `src/board/hooks/use-keyboard.ts` | Add `handleLaunchClaude` to `KeyboardActions` interface + `if (input === "C")` handler in `canAct \|\| overlay:detail` block |
| `src/board/components/dashboard.tsx` | Define `handleLaunchClaude` as `useCallback`, resolve `claudeStartCommand` precedence here, wire to `useKeyboard` actions |
| `src/board/components/hint-bar.tsx` | Add `C:claude` to panel 3 normal-mode and `overlay:detail` hint strings |
| `src/board/components/help-overlay.tsx` | Add `C` to Actions category |
| `src/cli.ts` | Add `hog launch <issueRef>` command with `--dry-run` and `--json` |
