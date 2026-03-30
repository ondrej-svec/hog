/**
 * BEADS DAG INTEGRATION TEST
 *
 * Tests the real Beads/Dolt server with actual bd CLI commands.
 * Verifies: flexible beadIds, DAG creation, ready/claim/close cycle,
 * feedback loops via status mutation.
 *
 * Requires: bd CLI installed, Dolt available.
 * Skips automatically if bd is not found.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BeadsClient } from "./beads.js";

// Check if bd is available before running
let bdAvailable = false;
try {
  execSync("bd --version", { stdio: "pipe" });
  bdAvailable = true;
} catch {
  // bd not installed
}

const TEST_DIR = join(tmpdir(), `hog-beads-dag-${Date.now()}`);

describe.skipIf(!bdAvailable)("Beads DAG integration", () => {
  const client = new BeadsClient("integration-test");

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Init git repo (required by bd)
    execSync("git init -q", { cwd: TEST_DIR });
    execSync("git commit --allow-empty -m init -q", { cwd: TEST_DIR });
    // Init bd
    execSync("bd init", { cwd: TEST_DIR, stdio: "pipe" });
    // Start Dolt server
    await client.ensureDoltRunning(TEST_DIR);
  }, 30_000);

  afterAll(() => {
    // Stop Dolt server
    try {
      execSync("bd dolt stop", { cwd: TEST_DIR, stdio: "pipe" });
    } catch {
      // best-effort
    }
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates a standard 7-node DAG", async () => {
    const dag = await client.createFeatureDAG(
      TEST_DIR,
      "Test Feature",
      "Integration test feature",
    );

    // All 7 beads created
    expect(dag["brainstorm"]!.id).toBeDefined();
    expect(dag["stories"]!.id).toBeDefined();
    expect(dag["scaffold"]!.id).toBeDefined();
    expect(dag["tests"]!.id).toBeDefined();
    expect(dag["impl"]!.id).toBeDefined();
    expect(dag["redteam"]!.id).toBeDefined();
    expect(dag["merge"]!.id).toBeDefined();

    // Store as Record<string, string> — flexible format
    const beadIds: Record<string, string> = {
      brainstorm: dag["brainstorm"]!.id,
      stories: dag["stories"]!.id,
      scaffold: dag["scaffold"]!.id,
      tests: dag["tests"]!.id,
      impl: dag["impl"]!.id,
      redteam: dag["redteam"]!.id,
      merge: dag["merge"]!.id,
    };

    // Verify only brainstorm is ready (head of the chain)
    const ready = await client.ready(TEST_DIR);
    const readyIds = new Set(ready.map((b) => b.id));
    expect(readyIds.has(beadIds["brainstorm"]!)).toBe(true);
    expect(readyIds.has(beadIds["stories"]!)).toBe(false);
  }, 30_000);

  it("advances through DAG by closing beads", async () => {
    const dag = await client.createFeatureDAG(
      TEST_DIR,
      "Advance Test",
      "Test advancing through phases",
    );

    const beadIds: Record<string, string> = {
      brainstorm: dag["brainstorm"]!.id,
      stories: dag["stories"]!.id,
      scaffold: dag["scaffold"]!.id,
      tests: dag["tests"]!.id,
      impl: dag["impl"]!.id,
      redteam: dag["redteam"]!.id,
      merge: dag["merge"]!.id,
    };

    // Close brainstorm → stories becomes ready
    await client.close(TEST_DIR, beadIds["brainstorm"]!, "Done");
    let ready = await client.ready(TEST_DIR);
    let readyIds = new Set(ready.map((b) => b.id));
    expect(readyIds.has(beadIds["stories"]!)).toBe(true);

    // Close stories → scaffold becomes ready
    await client.close(TEST_DIR, beadIds["stories"]!, "Done");
    ready = await client.ready(TEST_DIR);
    readyIds = new Set(ready.map((b) => b.id));
    expect(readyIds.has(beadIds["scaffold"]!)).toBe(true);
  }, 30_000);

  it("supports feedback loop via status mutation", async () => {
    const dag = await client.createFeatureDAG(
      TEST_DIR,
      "Feedback Loop Test",
      "Test reopening beads for retry",
    );

    // Advance to impl by closing brainstorm → stories → scaffold → tests
    await client.close(TEST_DIR, dag["brainstorm"]!.id, "Done");
    await client.close(TEST_DIR, dag["stories"]!.id, "Done");
    await client.close(TEST_DIR, dag["scaffold"]!.id, "Done");
    await client.close(TEST_DIR, dag["tests"]!.id, "Done");

    // Impl should be ready
    let ready = await client.ready(TEST_DIR);
    let readyIds = new Set(ready.map((b) => b.id));
    expect(readyIds.has(dag["impl"]!.id)).toBe(true);

    // Claim and close impl
    await client.claim(TEST_DIR, dag["impl"]!.id);
    await client.close(TEST_DIR, dag["impl"]!.id, "Implemented");

    // Redteam should now be ready
    ready = await client.ready(TEST_DIR);
    readyIds = new Set(ready.map((b) => b.id));
    expect(readyIds.has(dag["redteam"]!.id)).toBe(true);

    // Simulate conform failure → reopen impl (status mutation feedback loop)
    await client.updateStatus(TEST_DIR, dag["impl"]!.id, "open");

    // Impl should be ready again (its parent deps are all still closed)
    ready = await client.ready(TEST_DIR);
    readyIds = new Set(ready.map((b) => b.id));
    expect(readyIds.has(dag["impl"]!.id)).toBe(true);
  }, 30_000);

  it("iterates over beadIds as Record<string, string>", () => {
    // Verify the flexible type works for conductor iteration patterns
    const beadIds: Record<string, string> = {
      brainstorm: "id-1",
      stories: "id-2",
      scaffold: "id-3",
      tests: "id-4",
      impl: "id-5",
      redteam: "id-6",
      merge: "id-7",
    };

    // Data-driven reverse lookup (used in healPipeline and tickPipeline)
    const beadIdToRole: Record<string, string> = {};
    for (const [key, id] of Object.entries(beadIds)) {
      beadIdToRole[id] = key === "tests" ? "test" : key;
    }

    expect(beadIdToRole["id-4"]).toBe("test");
    expect(beadIdToRole["id-5"]).toBe("impl");
    expect(Object.keys(beadIdToRole)).toHaveLength(7);

    // roleToBeadId lookup (used in conductor)
    const roleToBeadId = (role: string): string | undefined => {
      const key = role === "test" ? "tests" : role;
      return beadIds[key];
    };

    expect(roleToBeadId("test")).toBe("id-4");
    expect(roleToBeadId("impl")).toBe("id-5");
    expect(roleToBeadId("nonexistent")).toBeUndefined();
  });
});
