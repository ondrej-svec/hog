/**
 * In-memory Beads driver — simulates the Beads CLI for demo mode.
 *
 * Implements the same public API as BeadsClient but stores everything
 * in memory. No Dolt dependency, no filesystem.
 */

import type { Bead, CreateBeadOptions } from "./beads.js";

let nextId = 1;

function makeBead(opts: CreateBeadOptions): Bead {
  const id = `mem-${nextId++}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    title: opts.title,
    description: opts.description ?? "",
    status: "open",
    priority: opts.priority ?? 1,
    issue_type: opts.type ?? "task",
    labels: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
  };
}

export class MemoryBeadsClient {
  private readonly beads = new Map<string, Bead>();
  /** Maps bead ID → set of IDs it is blocked by. */
  private readonly dependencies = new Map<string, Set<string>>();

  isInstalled(): boolean {
    return true;
  }

  isInitialized(_cwd: string): boolean {
    return true;
  }

  async init(_cwd: string): Promise<void> {
    // no-op
  }

  async ensureDoltRunning(_cwd: string): Promise<void> {
    // no-op
  }

  async stopDolt(_cwd: string): Promise<boolean> {
    return true;
  }

  async ready(_cwd: string): Promise<Bead[]> {
    const result: Bead[] = [];
    for (const bead of this.beads.values()) {
      if (bead.status !== "open") continue;
      // Check if all dependencies are closed
      const deps = this.dependencies.get(bead.id);
      if (deps) {
        let allClosed = true;
        for (const depId of deps) {
          const dep = this.beads.get(depId);
          if (dep && dep.status !== "closed") {
            allClosed = false;
            break;
          }
        }
        if (!allClosed) continue;
      }
      result.push(bead);
    }
    return result;
  }

  async show(_cwd: string, beadId: string): Promise<Bead> {
    const bead = this.beads.get(beadId);
    if (!bead) throw new Error(`Bead not found: ${beadId}`);
    return bead;
  }

  async updateStatus(_cwd: string, beadId: string, status: string): Promise<void> {
    const bead = this.beads.get(beadId);
    if (!bead) throw new Error(`Bead not found: ${beadId}`);
    (bead as Record<string, unknown>)["status"] = status;
    (bead as Record<string, unknown>)["updated_at"] = new Date().toISOString();
  }

  async claim(_cwd: string, beadId: string): Promise<void> {
    await this.updateStatus("", beadId, "in_progress");
  }

  async close(_cwd: string, beadId: string, _reason: string): Promise<void> {
    await this.updateStatus("", beadId, "closed");
  }

  async create(_cwd: string, opts: CreateBeadOptions): Promise<Bead> {
    const bead = makeBead(opts);
    this.beads.set(bead.id, bead);
    return bead;
  }

  async addDependency(
    _cwd: string,
    beadId: string,
    dependsOnId: string,
    _type: string,
  ): Promise<void> {
    if (!this.dependencies.has(beadId)) {
      this.dependencies.set(beadId, new Set());
    }
    this.dependencies.get(beadId)!.add(dependsOnId);
  }

  async createFeatureDAG(
    _cwd: string,
    featureTitle: string,
    featureDescription: string,
  ): Promise<Record<string, Bead>> {
    const shortTitle = featureTitle.length > 60 ? `${featureTitle.slice(0, 57)}...` : featureTitle;

    const brainstorm = await this.create("", {
      title: `[hog:brainstorm] ${shortTitle}`,
      description: featureDescription,
      type: "task",
      priority: 1,
    });
    const stories = await this.create("", {
      title: `[hog:stories] ${shortTitle}`,
      description: featureDescription,
      type: "task",
      priority: 1,
    });
    const scaffold = await this.create("", {
      title: `[hog:scaffold] ${shortTitle}`,
      type: "task",
      priority: 1,
    });
    const tests = await this.create("", {
      title: `[hog:test] ${shortTitle}`,
      type: "task",
      priority: 1,
    });
    const impl = await this.create("", {
      title: `[hog:impl] ${shortTitle}`,
      type: "task",
      priority: 1,
    });
    const redteam = await this.create("", {
      title: `[hog:redteam] ${shortTitle}`,
      type: "task",
      priority: 2,
    });
    const merge = await this.create("", {
      title: `[hog:merge] ${shortTitle}`,
      type: "task",
      priority: 1,
    });
    const ship = await this.create("", {
      title: `[hog:ship] ${shortTitle}`,
      type: "task",
      priority: 1,
    });

    // Set up blocking dependencies: brainstorm → stories → scaffold → tests → impl → redteam → merge → ship
    await this.addDependency("", stories.id, brainstorm.id, "blocks");
    await this.addDependency("", scaffold.id, stories.id, "blocks");
    await this.addDependency("", tests.id, scaffold.id, "blocks");
    await this.addDependency("", impl.id, tests.id, "blocks");
    await this.addDependency("", redteam.id, impl.id, "blocks");
    await this.addDependency("", merge.id, redteam.id, "blocks");
    await this.addDependency("", ship.id, merge.id, "blocks");

    return { brainstorm, stories, scaffold, tests, impl, redteam, merge, ship };
  }
}
