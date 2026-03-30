import { describe, expect, it } from "vitest";
import { MemoryBeadsClient } from "./beads-memory.js";

describe("MemoryBeadsClient", () => {
  it("reports as installed and initialized", () => {
    const client = new MemoryBeadsClient();
    expect(client.isInstalled()).toBe(true);
    expect(client.isInitialized("/any")).toBe(true);
  });

  it("creates a feature DAG with 8 beads", async () => {
    const client = new MemoryBeadsClient();
    const dag = await client.createFeatureDAG("/tmp", "Test feature", "A test");
    expect(dag["brainstorm"]!.id).toBeDefined();
    expect(dag["stories"]!.id).toBeDefined();
    expect(dag["scaffold"]!.id).toBeDefined();
    expect(dag["tests"]!.id).toBeDefined();
    expect(dag["impl"]!.id).toBeDefined();
    expect(dag["redteam"]!.id).toBeDefined();
    expect(dag["merge"]!.id).toBeDefined();
    expect(dag["ship"]!.id).toBeDefined();
  });

  it("only brainstorm is ready initially (dependencies block others)", async () => {
    const client = new MemoryBeadsClient();
    const dag = await client.createFeatureDAG("/tmp", "Test", "");
    const ready = await client.ready("");
    const readyIds = ready.map((b) => b.id);
    expect(readyIds).toContain(dag["brainstorm"]!.id);
    expect(readyIds).not.toContain(dag["stories"]!.id);
    expect(readyIds).not.toContain(dag["tests"]!.id);
  });

  it("closing brainstorm unblocks stories", async () => {
    const client = new MemoryBeadsClient();
    const dag = await client.createFeatureDAG("/tmp", "Test", "");
    await client.close("", dag["brainstorm"]!.id, "done");

    const ready = await client.ready("");
    const readyIds = ready.map((b) => b.id);
    expect(readyIds).toContain(dag["stories"]!.id);
    expect(readyIds).not.toContain(dag["tests"]!.id);
  });

  it("claim sets status to in_progress", async () => {
    const client = new MemoryBeadsClient();
    const dag = await client.createFeatureDAG("/tmp", "Test", "");
    await client.claim("", dag["brainstorm"]!.id);
    const bead = await client.show("", dag["brainstorm"]!.id);
    expect(bead.status).toBe("in_progress");
  });

  it("walks the entire DAG sequentially", async () => {
    const client = new MemoryBeadsClient();
    const dag = await client.createFeatureDAG("/tmp", "Test", "");
    const order = [
      dag["brainstorm"]!,
      dag["stories"]!,
      dag["scaffold"]!,
      dag["tests"]!,
      dag["impl"]!,
      dag["redteam"]!,
      dag["merge"]!,
      dag["ship"]!,
    ];

    for (const bead of order) {
      const ready = await client.ready("");
      expect(ready.map((b) => b.id)).toContain(bead.id);
      await client.claim("", bead.id);
      await client.close("", bead.id, "done");
    }

    // All closed — nothing ready
    const ready = await client.ready("");
    expect(ready).toHaveLength(0);
  });
});
