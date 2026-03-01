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
  readonly promptVariables?: PromptVariables | undefined;
}

// ── Phase Prompt Templates ──

export const DEFAULT_PHASE_PROMPTS: Record<string, string> = {
  research: [
    "Research context for Issue #{number}: {title}",
    "URL: {url}",
    "",
    "Explore the codebase and gather context that would help brainstorm this issue.",
    "Write a short research summary to docs/research/{slug}.md.",
    "Do NOT implement anything. Just gather information.",
  ].join("\n"),

  brainstorm: ["Let's brainstorm Issue #{number}: {title}", "URL: {url}", "", "{body}"].join("\n"),

  plan: [
    "Create an implementation plan for Issue #{number}: {title}",
    "URL: {url}",
    "",
    "If a brainstorm doc exists in docs/brainstorms/, use it as context.",
    "Write the plan to docs/plans/.",
  ].join("\n"),

  implement: [
    "Implement Issue #{number}: {title}",
    "URL: {url}",
    "",
    "If a plan exists in docs/plans/, follow it.",
    "Commit frequently. Create a PR when done.",
  ].join("\n"),

  review: [
    "Review the changes for Issue #{number}: {title}",
    "URL: {url}",
    "",
    "Check the current branch diff against main.",
    "Run tests and linting.",
    "Write a review summary.",
  ].join("\n"),

  compound: [
    "Document the solution for Issue #{number}: {title}",
    "URL: {url}",
    "",
    "Write a solution document to docs/solutions/.",
    "Include: symptoms, root cause, solution, prevention.",
  ].join("\n"),

  "completion-check": [
    "Check the status of Issue #{number}: {title}",
    "URL: {url}",
    "",
    "Read the plan doc if it exists in docs/plans/.",
    "Run `git diff main...HEAD --stat` to see what's changed.",
    "Run the project's test suite.",
    "Report: what's done, what's remaining, what's blocking.",
  ].join("\n"),
};

// ── Helpers ──

/** Extra variables for prompt template interpolation beyond the base issue fields. */
export interface PromptVariables {
  readonly body?: string | undefined;
  readonly slug?: string | undefined;
  readonly phase?: string | undefined;
  readonly repo?: string | undefined;
}

export function buildPrompt(
  issue: Pick<BoardIssue, "number" | "title" | "url">,
  template?: string | undefined,
  variables?: PromptVariables | undefined,
): string {
  if (!template) {
    return `Issue #${issue.number}: ${issue.title}\nURL: ${issue.url}`;
  }
  return template
    .replace(/\{number\}/g, String(issue.number))
    .replace(/\{title\}/g, issue.title)
    .replace(/\{url\}/g, issue.url)
    .replace(/\{body\}/g, variables?.body ?? "")
    .replace(/\{slug\}/g, variables?.slug ?? "")
    .replace(/\{phase\}/g, variables?.phase ?? "")
    .replace(/\{repo\}/g, variables?.repo ?? "");
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
  const prompt = buildPrompt(issue, opts.promptTemplate, opts.promptVariables);

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

/** Shell-quote a single argument (POSIX single-quote wrapping). */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function launchViaTerminalApp(terminalApp: string, opts: LaunchClaudeOptions): LaunchResult {
  const { localPath, issue } = opts;
  const { command, extraArgs } = resolveCommand(opts);
  const prompt = buildPrompt(issue, opts.promptTemplate, opts.promptVariables);

  switch (terminalApp) {
    case "iTerm": {
      // iTerm2: use AppleScript to create window, then send properly-quoted command
      // Each argument is individually shell-quoted to prevent injection.
      const quotedArgs = [command, ...extraArgs, "--", prompt].map(shellQuote).join(" ");
      const script = `tell application "iTerm"
  create window with default profile
  tell current session of current window
    write text "cd " & ${JSON.stringify(shellQuote(localPath))} & " && " & ${JSON.stringify(quotedArgs)}
  end tell
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
      // Alacritty: use --working-directory for cwd, pass command as separate argv elements
      const child = spawn(
        "alacritty",
        ["--working-directory", localPath, "--command", command, ...extraArgs, "--", prompt],
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

  // Linux: try xdg-terminal-exec with cwd via spawn option + safe argv
  const { localPath, issue } = opts;
  const { command, extraArgs } = resolveCommand(opts);
  const prompt = buildPrompt(issue, opts.promptTemplate, opts.promptVariables);

  const child = spawn("xdg-terminal-exec", [command, ...extraArgs, "--", prompt], {
    stdio: "ignore",
    detached: true,
    cwd: localPath,
  });
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
