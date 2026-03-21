import { execFile, execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ──

export interface Worktree {
  readonly path: string;
  readonly branch: string;
  readonly head: string;
  readonly bare: boolean;
}

// ── Worktree Manager ──

/**
 * Manages git worktrees for agent isolation.
 * Each agent gets its own worktree so there's no file contention.
 */
export class WorktreeManager {
  private readonly maxWorktrees: number;

  constructor(maxWorktrees: number = 10) {
    this.maxWorktrees = maxWorktrees;
  }

  /** Create a new worktree for an agent. Returns the worktree path. */
  async create(repoPath: string, branchName: string): Promise<string> {
    const worktrees = await this.list(repoPath);
    const agentWorktrees = worktrees.filter((w) => w.branch.startsWith("hog/"));
    if (agentWorktrees.length >= this.maxWorktrees) {
      throw new Error(
        `Max worktrees (${this.maxWorktrees}) reached. Clean up old worktrees first.`,
      );
    }

    const worktreePath = `${repoPath}/.hog-worktrees/${branchName.replace(/\//g, "-")}`;

    // Create the branch if it doesn't exist
    try {
      await execFileAsync("git", ["branch", branchName], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    } catch {
      // Branch may already exist — that's fine
    }

    await execFileAsync("git", ["worktree", "add", worktreePath, branchName], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 30_000,
    });

    return worktreePath;
  }

  /** Remove a worktree. */
  async remove(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    } catch {
      // If git worktree remove fails, clean up manually
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      // Prune to clean up the worktree reference
      try {
        await execFileAsync("git", ["worktree", "prune"], {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 10_000,
        });
      } catch {
        // best-effort
      }
    }
  }

  /** List all worktrees for a repo. */
  async list(repoPath: string): Promise<Worktree[]> {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    return parseWorktreeList(stdout);
  }

  /** Clean up all hog-managed worktrees. */
  async cleanup(repoPath: string): Promise<number> {
    const worktrees = await this.list(repoPath);
    const hogWorktrees = worktrees.filter(
      (w) => w.branch.startsWith("hog/") || w.path.includes(".hog-worktrees"),
    );

    let removed = 0;
    for (const wt of hogWorktrees) {
      try {
        await this.remove(repoPath, wt.path);
        removed++;
      } catch {
        // skip failures
      }
    }
    return removed;
  }

  /** Generate a branch name for a pipeline agent. */
  branchName(featureId: string, role: string): string {
    return `hog/${featureId}/${role}`;
  }
}

// ── Parse Helpers ──

function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  const blocks = output.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    let path = "";
    let head = "";
    let branch = "";
    let bare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice(9);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice(5);
      } else if (line.startsWith("branch ")) {
        // "branch refs/heads/main" → "main"
        branch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "bare") {
        bare = true;
      }
    }

    if (path) {
      worktrees.push({ path, branch, head, bare });
    }
  }

  return worktrees;
}

// ── Sync helper (used by Refinery) ──

/** Get the current HEAD commit of a branch. */
export function getBranchHead(repoPath: string, branch: string): string {
  return execFileSync("git", ["rev-parse", branch], {
    cwd: repoPath,
    encoding: "utf-8",
    timeout: 5_000,
  }).trim();
}

/** Check if a branch has diverged from main. */
export async function hasDiverged(
  repoPath: string,
  branch: string,
  base: string = "main",
): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", base, branch], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5_000,
    });
    return false; // base is ancestor of branch — not diverged
  } catch {
    return true; // diverged or error
  }
}
