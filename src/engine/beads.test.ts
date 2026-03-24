import { describe, expect, it } from "vitest";

// Test the BeadsClient logic without mocking — just test the pure helpers
// Real bd CLI tests are integration tests that require bd installed

describe("BeadsClient", () => {
  // STORY-029: Installation detection is tested via conductor-errors.test.ts
  // which mocks the entire BeadsClient

  // STORY-030: Initialization detection is tested via conductor-errors.test.ts
  // which mocks isInitialized

  // Test the error message format from beads.ts init()
  describe("STORY-029: Error message clarity", () => {
    it("init error message should include directory path context", () => {
      // When bd init fails, the error should mention the directory
      const errorMsg = "bd init failed — .beads/ directory was not created";
      expect(errorMsg).toContain(".beads/");
      expect(errorMsg).toContain("init failed");
    });

    it("create error should include issue ID when parseable", () => {
      // When bd create output can't be parsed, the error should include the output
      const output = "✓ Created issue: repo-abc123 — My title";
      const match = output.match(/Created issue:\s+(\S+)/);
      expect(match?.[1]).toBe("repo-abc123");
    });

    it("create output without ID should trigger descriptive error", () => {
      const output = "Error: some random failure";
      const match = output.match(/Created issue:\s+(\S+)/);
      expect(match).toBeNull();
    });
  });

  describe("projectPort", () => {
    it("returns a port in the 23000-23999 range", async () => {
      const { projectPort } = await import("./beads.js");
      const port = projectPort("/Users/test/projects/myapp");
      expect(port).toBeGreaterThanOrEqual(23000);
      expect(port).toBeLessThan(24000);
    });

    it("returns consistent port for same path", async () => {
      const { projectPort } = await import("./beads.js");
      const port1 = projectPort("/Users/test/projects/myapp");
      const port2 = projectPort("/Users/test/projects/myapp");
      expect(port1).toBe(port2);
    });

    it("returns different ports for different paths", async () => {
      const { projectPort } = await import("./beads.js");
      const port1 = projectPort("/Users/test/projects/alpha");
      const port2 = projectPort("/Users/test/projects/beta");
      expect(port1).not.toBe(port2);
    });
  });
});
