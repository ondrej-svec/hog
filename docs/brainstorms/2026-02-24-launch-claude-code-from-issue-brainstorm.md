# Brainstorm: Launch Claude Code from Issue

**Date:** 2026-02-24
**Status:** Draft
**Topic:** Keyboard shortcut to jump from a hog issue directly into a Claude Code session in the corresponding repo

---

## What We're Building

A feature in hog's board TUI that lets users press `C` (uppercase) while an issue is selected to instantly open a Claude Code session — in the correct local repository folder, pre-loaded with a configurable Claude Code skill/command and the issue's context (title + URL) automatically appended.

**Example flow:**
1. User is on an issue in the `aimee-product` repo
2. Presses `C`
3. A new tmux window opens (or a new terminal window if not in tmux) running:
   `claude` in `/Users/me/code/aimee-product`, with:
   `/compound-engineering:workflows:brainstorm`
   `Issue: Fix login bug (#42)`
   `URL: https://github.com/ondrej-svec/aimee-product/issues/42`

The goal is to collapse the "I see this issue → I want to start working on it with Claude" friction to a single keypress.

---

## Why This Approach

### Launch method: tmux-first, terminal-window fallback
- Detect `$TMUX` environment variable at runtime
- If in tmux → `tmux new-window` running `claude` in the repo directory
- If not in tmux → open a new OS terminal window (macOS: `open -a Terminal`, configurable)
- User can override the detection via config (`claudeLaunchMode: "tmux" | "terminal" | "auto"`)
- SSH + tmux scenario works naturally (tmux is the right choice in remote environments)
- SSH without tmux is a known limitation — terminal window won't work remotely, tmux is the right answer there anyway

### Path resolution: explicit `localPath` per repo
- Add optional `localPath?: string` to `RepoConfig`
- Feature is silently unavailable (key doesn't activate, or shows a toast) if `localPath` is not set
- Reliable, no path-guessing conventions — correct 100% of the time

### Startup command: per-repo `claudeStartCommand`
- Optional field on `RepoConfig` — a Claude Code skill or text command
- hog auto-appends issue title + URL after the command
- Falls back to plain `claude` (no pre-loaded prompt) if not configured
- Different repos can have different workflows (brainstorm vs debug vs review)

### Key binding: `C` (uppercase)
- Active in both `normal` mode (issue selected in list) and `overlay:detail` mode (detail panel open)
- Mnemonic: **C** for **C**laude
- Currently completely unbound in hog — no conflicts

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Launch mechanism | tmux new-window OR new terminal window | tmux preferred in remote/headless; terminal window for local |
| tmux unit | New **window** (not split pane) | Full screen Claude experience, switch back with `ctrl-b n` |
| tmux detection | `$TMUX` env var | Standard, reliable |
| Path config | Per-repo `localPath` (explicit) | Always correct, no guessing |
| Startup prompt | Per-repo `claudeStartCommand`, falls back to board-level default | Different workflows per repo; global default for convenience |
| Issue context | Auto-appended title + URL after command | Saves typing, provides grounding |
| Key | `C` (uppercase) in normal + overlay:detail | Mnemonic, currently unbound |
| Missing `localPath` | Toast with setup hint | Clear actionable feedback |
| Terminal detection | `$TERM_PROGRAM` auto-detect + `claudeTerminalApp` config override | Smart default, power-user flexibility |
| Linux support | `$TERM_PROGRAM`-based (gnome-terminal, xterm, konsole, etc.) | Same mechanism as macOS |

---

## Open Questions

1. **Claude Code CLI invocation for startup prompt**: How does `claude` CLI accept a startup message to auto-send at session start?
   - Options: `claude --message "..."`, stdin pipe (`echo "prompt" | claude`), or other
   - **Action**: Check `claude --help` during implementation; may affect whether prompt is "auto-sent" or just shown as first input
   - If no clean mechanism: open claude normally in the cwd; user can manually type the command (still saves navigation time)

---

## Resolved Questions

2. **Missing `localPath` behavior**: Show a toast: `"Set localPath for <repo> in config to enable Claude Code launch"` — gives clear actionable feedback.

3. **Terminal app detection**: Auto-detect from `$TERM_PROGRAM` (matches user's current terminal: iTerm2, Ghostty, WezTerm, Terminal.app). Configurable override via `claudeTerminalApp` config field if user wants to force a specific app.

4. **Linux terminal support**: Support common Linux terminals (`gnome-terminal`, `xterm`, `konsole`, etc.) via `$TERM_PROGRAM` detection — same mechanism as macOS. Not Linux-only; the `$TERM_PROGRAM` approach works cross-platform.

5. **Global `claudeStartCommand`**: Yes — board-level `claudeStartCommand` as default, per-repo `claudeStartCommand` overrides it. If neither is set, open plain `claude` in the repo directory.

6. **hog board behavior after launch**: No state change needed. hog continues running in its own tmux window / terminal tab. After pressing `C`, focus shifts to the new Claude window and hog stays alive.

---

## Context

- **Codebase pattern**: The `$EDITOR` overlay (`edit-issue-overlay.tsx`) already demonstrates terminal handoff via `spawnSync` with `stdio: "inherit"`. However, since we're opening in a *new* window (not taking over the current terminal), the simpler `execFileSync("tmux", [...], { stdio: "ignore" })` pattern (like `openInBrowser`) applies instead.
- **No existing `localPath` concept**: `RepoConfig` currently has no local filesystem path. Adding `localPath?: string` requires a config schema update and migration bump (v3 → v4, or non-breaking as it's optional).
- **Key binding insertion point**: `use-keyboard.ts` + `dashboard.tsx` useKeyboard wiring + `hint-bar.tsx` display text.
