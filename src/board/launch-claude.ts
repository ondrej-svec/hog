import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { BoardIssue, Result } from "../types.js";

// ── Types ──

export type LaunchFailureReason =
  | "no-local-path"
  | "directory-not-found"
  | "claude-not-found"
  | "tmux-failed"
  | "terminal-failed"
  | "terminal-app-not-found"
  | "ssh-no-tmux";

export interface LaunchError {
  readonly kind: LaunchFailureReason;
  readonly message: string;
  readonly cause?: Error;
}

export type LaunchResult = Result<void, LaunchError>;

export interface LaunchClaudeOptions {
  readonly localPath: string;
  readonly issue: Pick<BoardIssue, "number" | "title" | "url">;
  readonly startCommand?: { command: string; extraArgs: readonly string[] } | undefined;
  readonly launchMode?: "auto" | "tmux" | "terminal" | undefined;
  readonly terminalApp?: string | undefined;
  readonly repoFullName?: string | undefined;
  readonly promptTemplate?: string | undefined;
}

// ── Helpers ──

export function buildPrompt(
  issue: Pick<BoardIssue, "number" | "title" | "url">,
  template?: string | undefined,
): string {
  if (!template) {
    return `Issue #${issue.number}: ${issue.title}\nURL: ${issue.url}`;
  }
  return template
    .replace(/\{number\}/g, String(issue.number))
    .replace(/\{title\}/g, issue.title)
    .replace(/\{url\}/g, issue.url);
}

function isClaudeInPath(): boolean {
  const result = spawnSync("which", ["claude"], { stdio: "pipe" });
  return result.status === 0;
}

function isInTmux(): boolean {
  return !!process.env["TMUX"];
}

function isInSsh(): boolean {
  return !!(process.env["SSH_CLIENT"] ?? process.env["SSH_TTY"]);
}

function detectTerminalApp(): string | undefined {
  return process.env["TERM_PROGRAM"];
}

function resolveCommand(opts: LaunchClaudeOptions): {
  command: string;
  extraArgs: readonly string[];
} {
  if (opts.startCommand) return opts.startCommand;
  return { command: "claude", extraArgs: [] };
}

function launchViaTmux(opts: LaunchClaudeOptions): LaunchResult {
  const { localPath, issue, repoFullName } = opts;
  const { command, extraArgs } = resolveCommand(opts);
  const prompt = buildPrompt(issue, opts.promptTemplate);

  const windowName = `claude-${issue.number}`;
  const tmuxArgs = [
    "new-window",
    "-d", // don't steal focus from hog board
    "-c",
    localPath,
    "-n",
    windowName,
  ];

  if (repoFullName) {
    tmuxArgs.push("-e", `HOG_REPO=${repoFullName}`);
  }
  tmuxArgs.push("-e", `HOG_ISSUE=${issue.number}`);

  // Build the shell command: command [extraArgs...] -- prompt
  tmuxArgs.push(command, ...extraArgs, "--", prompt);

  const child = spawn("tmux", tmuxArgs, { stdio: "ignore", detached: true });
  child.unref();

  return { ok: true, value: undefined };
}

function launchViaTerminalApp(terminalApp: string, opts: LaunchClaudeOptions): LaunchResult {
  const { localPath, issue } = opts;
  const { command, extraArgs } = resolveCommand(opts);
  const prompt = buildPrompt(issue, opts.promptTemplate);

  const fullCmd = [command, ...extraArgs, "--", prompt].join(" ");

  switch (terminalApp) {
    case "iTerm": {
      // iTerm2: use AppleScript to open a new window with the correct cwd
      const script = `tell application "iTerm"
  create window with default profile command "bash -c 'cd ${localPath} && ${fullCmd}'"
end tell`;
      const result = spawnSync("osascript", ["-e", script], { stdio: "ignore" });
      if (result.status !== 0) {
        return {
          ok: false,
          error: {
            kind: "terminal-failed",
            message: `iTerm2 launch failed. Is iTerm2 installed and running?`,
          },
        };
      }
      return { ok: true, value: undefined };
    }

    case "Terminal": {
      const child = spawn("open", ["-a", "Terminal", localPath], {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      return { ok: true, value: undefined };
    }

    case "Ghostty": {
      const child = spawn(
        "open",
        ["-na", "Ghostty", "--args", `--working-directory=${localPath}`],
        { stdio: "ignore", detached: true },
      );
      child.unref();
      return { ok: true, value: undefined };
    }

    case "WezTerm": {
      const child = spawn("wezterm", ["start", "--cwd", localPath], {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      return { ok: true, value: undefined };
    }

    case "Kitty": {
      const child = spawn(
        "kitty",
        ["--directory", localPath, command, ...extraArgs, "--", prompt],
        {
          stdio: "ignore",
          detached: true,
        },
      );
      child.unref();
      return { ok: true, value: undefined };
    }

    case "Alacritty": {
      const child = spawn(
        "alacritty",
        ["--command", "bash", "-c", `cd ${localPath} && ${fullCmd}`],
        { stdio: "ignore", detached: true },
      );
      child.unref();
      return { ok: true, value: undefined };
    }

    default:
      return {
        ok: false,
        error: {
          kind: "terminal-app-not-found",
          message: `Unknown terminal app: ${terminalApp}`,
        },
      };
  }
}

function launchViaDetectedTerminal(opts: LaunchClaudeOptions): LaunchResult {
  const { terminalApp } = opts;

  // Use configured terminal app if specified
  if (terminalApp) {
    return launchViaTerminalApp(terminalApp, opts);
  }

  // Detect terminal from environment
  const termProgram = detectTerminalApp();

  if (termProgram === "iTerm.app") {
    return launchViaTerminalApp("iTerm", opts);
  }

  if (termProgram === "Apple_Terminal") {
    return launchViaTerminalApp("Terminal", opts);
  }

  if (termProgram === "WezTerm") {
    return launchViaTerminalApp("WezTerm", opts);
  }

  if (termProgram === "ghostty") {
    return launchViaTerminalApp("Ghostty", opts);
  }

  // Check for kitty via env var (TERM_PROGRAM not set for kitty)
  if (process.env["KITTY_WINDOW_ID"]) {
    return launchViaTerminalApp("Kitty", opts);
  }

  // macOS fallback: Terminal.app is always present
  if (process.platform === "darwin") {
    return launchViaTerminalApp("Terminal", opts);
  }

  // Linux: try xdg-terminal-exec or gnome-terminal
  const { localPath, issue } = opts;
  const { command, extraArgs } = resolveCommand(opts);
  const prompt = buildPrompt(issue, opts.promptTemplate);

  const child = spawn(
    "xdg-terminal-exec",
    ["bash", "-c", `cd ${localPath} && ${[command, ...extraArgs, "--", prompt].join(" ")}`],
    { stdio: "ignore", detached: true },
  );
  child.unref();
  return { ok: true, value: undefined };
}

// ── Main export ──

export function launchClaude(opts: LaunchClaudeOptions): LaunchResult {
  const { localPath, launchMode = "auto" } = opts;

  // Guard: directory must exist
  if (!existsSync(localPath)) {
    return {
      ok: false,
      error: {
        kind: "directory-not-found",
        message: `Directory not found: ${localPath}. Check localPath config.`,
      },
    };
  }

  // Guard: claude binary must be in PATH
  if (!isClaudeInPath()) {
    return {
      ok: false,
      error: {
        kind: "claude-not-found",
        message: "claude binary not found in PATH. Install Claude Code first.",
      },
    };
  }

  // SSH without tmux: cannot open a local terminal window
  if (isInSsh() && !isInTmux() && launchMode !== "tmux") {
    return {
      ok: false,
      error: {
        kind: "ssh-no-tmux",
        message: "Running over SSH without tmux — start tmux to enable Claude Code launch.",
      },
    };
  }

  const useTmux = launchMode === "tmux" || (launchMode === "auto" && isInTmux());

  if (useTmux) {
    const result = launchViaTmux(opts);
    if (!result.ok) {
      // If forced tmux, no fallback
      if (launchMode === "tmux") {
        return {
          ok: false,
          error: {
            kind: "tmux-failed",
            message: "tmux launch failed. Is tmux running?",
          },
        };
      }
      // Auto mode: fall back to terminal
      return launchViaDetectedTerminal(opts);
    }
    return result;
  }

  // Force terminal or auto (not in tmux)
  return launchViaDetectedTerminal(opts);
}
