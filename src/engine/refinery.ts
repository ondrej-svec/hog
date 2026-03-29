import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EventBus } from "./event-bus.js";
import type { QualityGate, QualityReport } from "./quality-gates.js";
import { ALL_GATES, createRoleAuditGate, runQualityGates } from "./quality-gates.js";
import type { WorktreeManager } from "./worktree.js";

const execFileAsync = promisify(execFile);

// ── Types ──

export type MergeStatus =
  | "pending"
  | "rebasing"
  | "testing"
  | "gating"
  | "merged"
  | "failed"
  | "conflict";

export interface MergeQueueEntry {
  readonly id: string;
  readonly featureId: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly repoPath: string;
  readonly role?: string;
  readonly submittedAt: string;
  status: MergeStatus;
  result?: MergeResult | undefined;
}

export interface MergeResult {
  readonly rebaseOk: boolean;
  readonly testsOk: boolean;
  readonly gatesReport?: QualityReport;
  readonly mergedAt?: string;
  readonly error?: string;
}

// ── Refinery ──

/**
 * The Refinery is the single merge gatekeeper.
 *
 * It processes a FIFO queue of completed agent branches:
 * 1. Rebase onto current main
 * 2. Run full test suite
 * 3. Run all quality gates
 * 4. If all pass → fast-forward main
 * 5. If anything fails → report and block
 *
 * Serial processing — one merge at a time.
 */
export class Refinery {
  private readonly eventBus: EventBus;
  private readonly worktrees: WorktreeManager;
  private readonly queue: MergeQueueEntry[] = [];
  private processing = false;
  private paused = false;
  private processTimer: ReturnType<typeof setInterval> | null = null;
  private readonly testCommand: string | undefined;
  private readonly baseBranch: string;

  constructor(
    eventBus: EventBus,
    worktrees: WorktreeManager,
    options: { testCommand?: string; baseBranch?: string; pollIntervalMs?: number } = {},
  ) {
    this.eventBus = eventBus;
    this.worktrees = worktrees;
    this.testCommand = options.testCommand;
    this.baseBranch = options.baseBranch ?? "main";
  }

  /** Start processing the merge queue. */
  start(pollIntervalMs: number = 5_000): void {
    this.processTimer = setInterval(() => {
      this.processNext().catch(() => {
        // error handling inside processNext
      });
    }, pollIntervalMs);
  }

  /** Stop processing. */
  stop(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
  }

  /** Pause processing (queue still accepts entries). */
  pause(): void {
    this.paused = true;
  }

  /** Resume processing. */
  resume(): void {
    this.paused = false;
  }

  /** Submit a completed branch to the merge queue. */
  submit(
    featureId: string,
    branch: string,
    worktreePath: string,
    repoPath: string,
    role?: string,
  ): string {
    const id = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entry: MergeQueueEntry = {
      id,
      featureId,
      branch,
      worktreePath,
      repoPath,
      submittedAt: new Date().toISOString(),
      status: "pending",
    };
    if (role !== undefined) {
      (entry as { role?: string }).role = role;
    }
    this.queue.push(entry);
    return id;
  }

  /** Get the current queue. */
  getQueue(): readonly MergeQueueEntry[] {
    return this.queue;
  }

  /** Get queue depth. */
  get depth(): number {
    return this.queue.filter((e) => e.status === "pending").length;
  }

  /** Retry a failed entry. */
  retry(entryId: string): boolean {
    const entry = this.queue.find((e) => e.id === entryId);
    if (!entry || entry.status !== "failed") return false;
    entry.status = "pending";
    entry.result = undefined;
    return true;
  }

  /** Skip an entry (remove from queue). */
  skip(entryId: string): boolean {
    const idx = this.queue.findIndex((e) => e.id === entryId);
    if (idx < 0) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  // ── Processing ──

  private async processNext(): Promise<void> {
    if (this.processing || this.paused) return;

    const next = this.queue.find((e) => e.status === "pending");
    if (!next) return;

    this.processing = true;

    try {
      // Step 1: Rebase onto base branch
      next.status = "rebasing";
      const rebaseOk = await this.rebase(next.repoPath, next.branch);
      if (!rebaseOk) {
        next.status = "conflict";
        next.result = { rebaseOk: false, testsOk: false, error: "Rebase conflicts" };
        this.eventBus.emit("mutation:failed", {
          description: `Merge failed: rebase conflicts on ${next.branch}`,
          error: "Rebase conflicts — needs manual resolution",
          featureId: next.featureId,
          ...(next.role ? { role: next.role } : {}),
        });
        return;
      }

      // Step 2: Run tests
      next.status = "testing";
      const testsOk = await this.runTests(next.repoPath);
      if (!testsOk) {
        next.status = "failed";
        next.result = { rebaseOk: true, testsOk: false, error: "Tests failed after rebase" };
        this.eventBus.emit("mutation:failed", {
          description: `Merge failed: tests on ${next.branch}`,
          error: "Tests failed after rebase",
          featureId: next.featureId,
          ...(next.role ? { role: next.role } : {}),
        });
        return;
      }

      // Step 3: Quality gates
      next.status = "gating";
      const changedFiles = await this.getChangedFiles(next.repoPath, next.branch);
      // Add role-audit gate if the entry has a role (Amodei: structural enforcement)
      const gates: QualityGate[] | undefined = next.role
        ? [...ALL_GATES, createRoleAuditGate(next.role)]
        : undefined;
      const gatesReport = await runQualityGates(next.repoPath, changedFiles, gates);
      if (!gatesReport.passed) {
        next.status = "failed";
        next.result = {
          rebaseOk: true,
          testsOk: true,
          gatesReport,
          error: `Quality gates failed: ${gatesReport.blockers.map((b) => b.gate).join(", ")}`,
        };
        this.eventBus.emit("mutation:failed", {
          description: `Merge failed: quality gates on ${next.branch}`,
          error: `Blockers: ${gatesReport.blockers.map((b) => b.gate).join(", ")}`,
          featureId: next.featureId,
          ...(next.role ? { role: next.role } : {}),
        });
        return;
      }

      // Step 4: Fast-forward merge
      await this.merge(next.repoPath, next.branch);
      next.status = "merged";
      next.result = {
        rebaseOk: true,
        testsOk: true,
        gatesReport,
        mergedAt: new Date().toISOString(),
      };

      this.eventBus.emit("mutation:completed", {
        description: `Merged ${next.branch} to ${this.baseBranch}`,
        featureId: next.featureId,
        ...(next.role ? { role: next.role } : {}),
      });

      // Step 5: Clean up worktree
      try {
        await this.worktrees.remove(next.repoPath, next.worktreePath);
      } catch {
        // best-effort cleanup
      }
    } finally {
      this.processing = false;
    }
  }

  // ── Git Operations ──

  private async rebase(repoPath: string, branch: string): Promise<boolean> {
    try {
      // Fetch latest
      await execFileAsync("git", ["fetch", "origin", this.baseBranch], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 30_000,
      });

      // Rebase
      await execFileAsync("git", ["rebase", `origin/${this.baseBranch}`, branch], {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 60_000,
      });
      return true;
    } catch {
      // Abort failed rebase
      try {
        await execFileAsync("git", ["rebase", "--abort"], {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 10_000,
        });
      } catch {
        // already clean
      }
      return false;
    }
  }

  private async runTests(repoPath: string): Promise<boolean> {
    const cmd = this.testCommand ?? "npm test";
    const [bin, ...args] = cmd.split(" ");
    if (!bin) return false;

    try {
      await execFileAsync(bin, args, {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 300_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async merge(repoPath: string, branch: string): Promise<void> {
    await execFileAsync("git", ["checkout", this.baseBranch], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    await execFileAsync("git", ["merge", "--ff-only", branch], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10_000,
    });
  }

  private async getChangedFiles(repoPath: string, branch: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--name-only", `${this.baseBranch}...${branch}`],
        { cwd: repoPath, encoding: "utf-8", timeout: 10_000 },
      );
      return stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
}
