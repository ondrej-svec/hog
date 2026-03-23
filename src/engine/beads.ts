import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
    const args = ["ready"];
    if (limit) {
      args.push("--limit", String(limit));
    }
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
   * Creates: stories → tests → impl → redteam → merge beads
   * with blocking dependencies between each phase.
   */
  async createFeatureDAG(
    cwd: string,
    featureTitle: string,
    featureDescription: string,
  ): Promise<{ stories: Bead; tests: Bead; impl: Bead; redteam: Bead; merge: Bead }> {
    // Truncate title for bead names (bd doesn't handle very long titles well)
    const shortTitle =
      featureTitle.length > 60 ? `${featureTitle.slice(0, 57)}...` : featureTitle;

    const stories = await this.create(cwd, {
      title: `[hog:stories] ${shortTitle}`,
      description: featureDescription,
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

    // Set up blocking dependencies: stories → tests → impl → redteam → merge
    await this.addDependency(cwd, tests.id, stories.id, "blocks");
    await this.addDependency(cwd, impl.id, tests.id, "blocks");
    await this.addDependency(cwd, redteam.id, impl.id, "blocks");
    await this.addDependency(cwd, merge.id, redteam.id, "blocks");

    return { stories, tests, impl, redteam, merge };
  }
}
