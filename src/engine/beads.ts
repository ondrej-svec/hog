import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// ── Types ──

const BEAD_SCHEMA = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "blocked", "closed", "deferred", "pinned", "hooked"]),
  priority: z.number().min(0).max(4),
  issue_type: z.string(),
  owner: z.string().optional(),
  created_by: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable().optional(),
  dependency_count: z.number().default(0),
  dependent_count: z.number().default(0),
  comment_count: z.number().default(0),
});

export type Bead = z.infer<typeof BEAD_SCHEMA>;

const BEAD_DEPENDENCY_SCHEMA = z.object({
  depends_on_id: z.string(),
  type: z.enum([
    "blocks",
    "parent-child",
    "waits-for",
    "conditional-blocks",
    "relates-to",
    "duplicates",
    "supersedes",
    "replies-to",
    "discovered-from",
  ]),
});

export type BeadDependency = z.infer<typeof BEAD_DEPENDENCY_SCHEMA>;

export interface CreateBeadOptions {
  readonly title: string;
  readonly description?: string;
  readonly type?: string;
  readonly priority?: number;
}

export interface BeadDAGNode {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly dependencies: BeadDependency[];
}

// ── CLI Helpers ──

const BD_TIMEOUT = 30_000;

function runBd(args: string[], cwd: string): string {
  return execFileSync("bd", args, {
    encoding: "utf-8",
    timeout: BD_TIMEOUT,
    cwd,
    stdio: "pipe",
  }).trim();
}

async function runBdAsync(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("bd", args, {
    encoding: "utf-8",
    timeout: BD_TIMEOUT,
    cwd,
  });
  return stdout.trim();
}

async function runBdJsonAsync<T>(args: string[], cwd: string): Promise<T> {
  const output = await runBdAsync([...args, "--json"], cwd);
  return JSON.parse(output) as T;
}

// ── Dolt Server Types ──

export interface DoltStatus {
  readonly running: boolean;
  readonly port?: number | undefined;
  readonly pid?: number | undefined;
}

export interface DoltServerInfo {
  readonly pid: number;
  readonly port?: number | undefined;
  readonly cwd?: string | undefined;
  readonly startTime?: string | undefined;
}

/**
 * Generate a deterministic port for a project based on its absolute path.
 * Returns a port in the range 23000–23999 to avoid conflicts between projects.
 */
export function projectPort(cwd: string): number {
  let hash = 0;
  for (const ch of cwd) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  return 23000 + (Math.abs(hash) % 1000);
}

// ── BeadsClient ──

/**
 * Client for the Beads (bd) CLI. Wraps bd commands with typed interfaces.
 * All operations require a `cwd` (the repo directory containing .beads/).
 */
export class BeadsClient {
  private readonly actorName: string;

  constructor(actorName: string) {
    this.actorName = actorName;
  }

  /** Check if the bd binary is available in PATH. */
  isInstalled(): boolean {
    try {
      execFileSync("bd", ["--version"], { encoding: "utf-8", timeout: 5_000, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /** Check if .beads/ is initialized in the given directory. */
  isInitialized(cwd: string): boolean {
    return existsSync(join(cwd, ".beads"));
  }

  /** Initialize .beads/ in a directory. */
  async init(cwd: string): Promise<void> {
    try {
      await runBdAsync(["init"], cwd);
    } catch {
      // bd init may exit non-zero due to Dolt server warnings
      // but still create .beads/ successfully. Check if it worked.
      if (!this.isInitialized(cwd)) {
        throw new Error("bd init failed — .beads/ directory was not created");
      }
    }
    // Ensure the Dolt server is running persistently
    await this.ensureDoltRunning(cwd);
  }

  /**
   * Ensure the Dolt server is running and properly configured.
   * This is the "zero-knowledge" setup — the user should never need
   * to know about Dolt, ports, or server management.
   */
  async ensureDoltRunning(cwd: string): Promise<void> {
    try {
      // Pin the Dolt port if not already pinned (prevents port cycling)
      await this.pinDoltPort(cwd);

      const status = await runBdAsync(["dolt", "status"], cwd);
      if (status.includes("not running")) {
        await this.startDoltWithConflictHandling(cwd);
      }
    } catch {
      // Try starting anyway — bd dolt start may work even if status failed
      try {
        await this.startDoltWithConflictHandling(cwd);
      } catch (err) {
        // Provide user-friendly error for port conflicts
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("port") && msg.includes("in use")) {
          const port = projectPort(cwd);
          throw new Error(
            `Dolt port ${port} is in use by another process.\n` +
              `Run \`hog beads stop --all\` to clean up, or \`hog beads status --all\` to see what's running.`,
          );
        }
        // Last resort: let bd auto-start handle it
      }
    }
  }

  /** Start Dolt, handling port conflicts by killing the blocking process. */
  private async startDoltWithConflictHandling(cwd: string): Promise<void> {
    try {
      await runBdAsync(["dolt", "start"], cwd);
      await new Promise((r) => setTimeout(r, 1_000));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Detect port conflict and try to auto-resolve
      if (msg.includes("port") && msg.includes("in use")) {
        const port = projectPort(cwd);
        try {
          // Find and kill the process using our port
          const lsofOut = execFileSync("lsof", ["-ti", `:${port}`], {
            encoding: "utf-8",
            timeout: 3_000,
            stdio: "pipe",
          }).trim();
          if (lsofOut) {
            const pid = parseInt(lsofOut.split("\n")[0] ?? "", 10);
            if (pid) {
              process.kill(pid, "SIGTERM");
              await new Promise((r) => setTimeout(r, 1_000));
              // Retry start
              await runBdAsync(["dolt", "start"], cwd);
              await new Promise((r) => setTimeout(r, 1_000));
              return;
            }
          }
        } catch {
          // Auto-resolve failed — re-throw with helpful message
        }
      }
      throw err;
    }
  }

  /** Get the Dolt server status for a project. */
  async doltStatus(cwd: string): Promise<DoltStatus> {
    try {
      const output = await runBdAsync(["dolt", "status"], cwd);
      const running = !output.includes("not running");
      const portMatch = output.match(/port[:\s]+(\d+)/i);
      const pidMatch = output.match(/PID[:\s]+(\d+)/i);
      return {
        running,
        port: portMatch ? parseInt(portMatch[1]!, 10) : undefined,
        pid: pidMatch ? parseInt(pidMatch[1]!, 10) : undefined,
      };
    } catch {
      return { running: false };
    }
  }

  /** Stop the Dolt server for a project. */
  async stopDolt(cwd: string): Promise<boolean> {
    try {
      await runBdAsync(["dolt", "stop"], cwd);
      return true;
    } catch {
      // bd dolt stop may not exist — try PID-based fallback
      try {
        const status = await this.doltStatus(cwd);
        if (status.pid) {
          process.kill(status.pid, "SIGTERM");
          return true;
        }
      } catch {
        // best-effort
      }
      return false;
    }
  }

  /**
   * Find all running Dolt server processes system-wide.
   * Parses ps output to extract PID, port, and working directory.
   */
  static findRunningDoltServers(): DoltServerInfo[] {
    try {
      const output = execFileSync("ps", ["aux"], {
        encoding: "utf-8",
        timeout: 5_000,
        stdio: "pipe",
      });
      const servers: DoltServerInfo[] = [];
      for (const line of output.split("\n")) {
        if (!(line.includes("dolt") && line.includes("sql-server"))) continue;
        if (line.includes("grep")) continue;

        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[1] ?? "", 10);
        if (!pid) continue;

        // Extract port from -P flag
        const portIdx = parts.indexOf("-P");
        const port = portIdx >= 0 ? parseInt(parts[portIdx + 1] ?? "", 10) : undefined;

        // Try to find cwd from /proc or lsof (best-effort)
        let cwd: string | undefined;
        try {
          const lsofOut = execFileSync("lsof", ["-p", String(pid), "-Fn"], {
            encoding: "utf-8",
            timeout: 3_000,
            stdio: "pipe",
          });
          const cwdMatch = lsofOut.match(/n(\/[^\n]+)\/\.beads/);
          if (cwdMatch) cwd = cwdMatch[1];
        } catch {
          // lsof may not be available
        }

        // Estimate uptime from process start time
        const startTime = parts[8]; // TIME column in ps aux

        servers.push({ pid, port, cwd, startTime });
      }
      return servers;
    } catch {
      return [];
    }
  }

  /** Pin the Dolt port in .beads/config.yaml — deterministic per project. */
  private async pinDoltPort(cwd: string): Promise<void> {
    const configPath = join(cwd, ".beads", "config.yaml");
    if (!existsSync(configPath)) return;

    try {
      const content = readFileSync(configPath, "utf-8");
      // Only add if no dolt port is already configured
      if (content.includes("dolt:") && content.includes("port:")) return;

      // Use deterministic port based on project path
      const port = projectPort(cwd);
      const portConfig = `\n# Auto-configured by hog — deterministic port for this project\ndolt:\n  port: ${port}\n`;
      writeFileSync(configPath, content + portConfig, "utf-8");
    } catch {
      // Non-critical — port cycling is annoying but not fatal
    }
  }

  /** Create a new bead. Returns the created bead (fetched via show after create). */
  async create(cwd: string, opts: CreateBeadOptions): Promise<Bead> {
    const args = ["create", opts.title];
    if (opts.type) {
      args.push("-t", opts.type);
    }
    if (opts.priority !== undefined) {
      args.push("-p", String(opts.priority));
    }
    if (opts.description) {
      args.push("-d", opts.description);
    }

    // bd create outputs text like "✓ Created issue: <id> — <title>"
    // We parse the ID from the output, then fetch the full bead via show
    const output = await runBdAsync(args, cwd);
    const idMatch = output.match(/Created issue:\s+(\S+)/);
    if (!idMatch?.[1]) {
      throw new Error(`Failed to parse bead ID from create output: ${output.slice(0, 200)}`);
    }

    const beadId = idMatch[1];
    return this.show(cwd, beadId);
  }

  /** Get all beads that are ready to work on (unblocked). */
  async ready(cwd: string, limit?: number): Promise<Bead[]> {
    const args = ["ready", "-n", String(limit ?? 999)];
    const raw = await runBdJsonAsync<unknown[]>(args, cwd);
    return raw.map((b) => BEAD_SCHEMA.parse(b));
  }

  /** List all beads (optionally filtered by status). */
  async list(cwd: string, status?: string): Promise<Bead[]> {
    const args = ["list"];
    if (status) {
      args.push("--status", status);
    }
    const raw = await runBdJsonAsync<unknown[]>(args, cwd);
    return raw.map((b) => BEAD_SCHEMA.parse(b));
  }

  /** Get a single bead by ID. */
  async show(cwd: string, beadId: string): Promise<Bead> {
    const raw = await runBdJsonAsync<unknown>(["show", beadId], cwd);
    // bd show returns an array with one element
    const item = Array.isArray(raw) ? raw[0] : raw;
    return BEAD_SCHEMA.parse(item);
  }

  /** Update a bead's status. */
  async updateStatus(cwd: string, beadId: string, status: string): Promise<void> {
    await runBdAsync(["update", beadId, "--status", status], cwd);
  }

  /** Claim a bead (atomically set assignee + in_progress). */
  async claim(cwd: string, beadId: string): Promise<void> {
    await runBdAsync(["update", beadId, "--claim"], cwd);
  }

  /** Close a bead with a reason. */
  async close(cwd: string, beadId: string, reason: string): Promise<void> {
    await runBdAsync(["close", beadId, "--reason", reason], cwd);
  }

  /** Store structured metadata on a bead (JSON). */
  async updateMetadata(cwd: string, beadId: string, metadata: Record<string, unknown>): Promise<void> {
    await runBdAsync(["update", beadId, "--notes", JSON.stringify(metadata)], cwd);
  }

  /** Read notes/metadata from a bead. */
  async readNotes(cwd: string, beadId: string): Promise<string | undefined> {
    const bead = await this.show(cwd, beadId);
    return (bead as Record<string, unknown>)["description"] as string | undefined;
  }

  /** Add a dependency between two beads. */
  async addDependency(
    cwd: string,
    childId: string,
    parentId: string,
    type: string = "blocks",
  ): Promise<void> {
    await runBdAsync(["dep", "add", childId, parentId, "--type", type], cwd);
  }

  /** Get the dependency tree for a bead. */
  async getDependencyTree(cwd: string, beadId: string): Promise<string> {
    return runBdAsync(["dep", "tree", beadId, "--direction=both"], cwd);
  }

  /** Run compact to shrink old closed issues. */
  async compact(cwd: string): Promise<void> {
    await runBdAsync(["compact"], cwd);
  }

  /**
   * Create a feature DAG: a standard bead dependency graph for a feature.
   *
   * Creates: brainstorm → stories → scaffold → tests → impl → redteam → merge beads
   * with blocking dependencies between each phase.
   */
  async createFeatureDAG(
    cwd: string,
    featureTitle: string,
    featureDescription: string,
  ): Promise<{
    brainstorm: Bead;
    stories: Bead;
    scaffold: Bead;
    tests: Bead;
    impl: Bead;
    redteam: Bead;
    merge: Bead;
  }> {
    // Truncate title for bead names (bd doesn't handle very long titles well)
    const shortTitle = featureTitle.length > 60 ? `${featureTitle.slice(0, 57)}...` : featureTitle;

    const brainstorm = await this.create(cwd, {
      title: `[hog:brainstorm] ${shortTitle}`,
      description: featureDescription,
      type: "task",
      priority: 1,
    });

    const stories = await this.create(cwd, {
      title: `[hog:stories] ${shortTitle}`,
      description: featureDescription,
      type: "task",
      priority: 1,
    });

    const scaffold = await this.create(cwd, {
      title: `[hog:scaffold] ${shortTitle}`,
      type: "task",
      priority: 1,
    });

    const tests = await this.create(cwd, {
      title: `[hog:test] ${shortTitle}`,
      type: "task",
      priority: 1,
    });

    const impl = await this.create(cwd, {
      title: `[hog:impl] ${shortTitle}`,
      type: "task",
      priority: 1,
    });

    const redteam = await this.create(cwd, {
      title: `[hog:redteam] ${shortTitle}`,
      type: "task",
      priority: 2,
    });

    const merge = await this.create(cwd, {
      title: `[hog:merge] ${shortTitle}`,
      type: "task",
      priority: 1,
    });

    // Set up blocking dependencies: brainstorm → stories → scaffold → tests → impl → redteam → merge
    await this.addDependency(cwd, stories.id, brainstorm.id, "blocks");
    await this.addDependency(cwd, scaffold.id, stories.id, "blocks");
    await this.addDependency(cwd, tests.id, scaffold.id, "blocks");
    await this.addDependency(cwd, impl.id, tests.id, "blocks");
    await this.addDependency(cwd, redteam.id, impl.id, "blocks");
    await this.addDependency(cwd, merge.id, redteam.id, "blocks");

    return { brainstorm, stories, scaffold, tests, impl, redteam, merge };
  }
}
