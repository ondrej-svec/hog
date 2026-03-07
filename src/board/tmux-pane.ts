import { execFileSync } from "node:child_process";

/** Get the tmux window name for an agent session (e.g. "claude-42"). */
export function agentWindowName(issueNumber: number): string {
  return `claude-${issueNumber}`;
}

/** Check if a named tmux window exists in the current session. */
export function windowExists(windowName: string): boolean {
  try {
    const output = execFileSync("tmux", ["list-windows", "-F", "#{window_name}"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split("\n").some((line) => line.trim() === windowName);
  } catch {
    return false;
  }
}

/**
 * Pull an agent's pane from its tmux window into the current window as a right split.
 * Returns the pane ID (e.g. "%5") or null on failure.
 */
export function joinAgentPane(windowName: string, widthPercent: number): string | null {
  try {
    const paneId = execFileSync(
      "tmux",
      [
        "join-pane",
        "-h",
        "-s",
        `${windowName}.0`,
        "-t",
        ".",
        "-l",
        `${widthPercent}%`,
        "-P",
        "-F",
        "#{pane_id}",
      ],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return paneId.trim() || null;
  } catch {
    return null;
  }
}

/** Send a pane back to its own tmux window (restores the agent's original window). */
export function breakPane(paneId: string): void {
  try {
    execFileSync("tmux", ["break-pane", "-d", "-s", paneId], {
      stdio: "ignore",
    });
  } catch {
    // Pane may already be gone — ignore
  }
}

/** Check if a tmux pane is still alive. */
export function isPaneAlive(paneId: string): boolean {
  try {
    const output = execFileSync("tmux", ["list-panes", "-a", "-F", "#{pane_id}"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split("\n").some((line) => line.trim() === paneId);
  } catch {
    return false;
  }
}

/**
 * Show issue info in a new right split pane (for issues without an agent).
 * Returns the pane ID or null on failure.
 */
export function splitWithInfo(
  info: { title: string; url: string },
  widthPercent: number,
): string | null {
  try {
    const infoText = `Issue: ${info.title}\n\nURL: ${info.url}\n\nNo Claude Code session active.\nPress C to launch one.`;
    const paneId = execFileSync(
      "tmux",
      [
        "split-window",
        "-h",
        "-l",
        `${widthPercent}%`,
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "echo",
        infoText,
        "&&",
        "read",
      ],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return paneId.trim() || null;
  } catch {
    return null;
  }
}

/** Kill a tmux pane by ID. No-op if pane is already closed. */
export function killPane(paneId: string): void {
  try {
    execFileSync("tmux", ["kill-pane", "-t", paneId], {
      stdio: "ignore",
    });
  } catch {
    // Pane may already be gone — ignore
  }
}
