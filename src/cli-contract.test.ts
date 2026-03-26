/**
 * CLI CONTRACT TESTS — defines the v2 command surface.
 *
 * Tests Commander.js command registration, not execution.
 * Written BEFORE implementation (Phase 0.2) to specify what v2 must look like.
 *
 * Commands split into three categories:
 * 1. KEEP: commands that exist in v2
 * 2. TOMBSTONE: removed commands that print migration messages (Story B)
 * 3. GONE: commands that should not exist at all
 */
import { describe, expect, it } from "vitest";

/**
 * Helper: parse the program to get registered command names.
 * We import the Commander program directly and inspect its commands.
 */
async function getProgram() {
  // Dynamic import to avoid side effects at module level
  // cli.ts registers commands on import, but also has a Node version check
  // We'll test command registration by checking what Commander has
  const { Command } = await import("commander");

  // We can't easily import the program without triggering side effects,
  // so we test by running the CLI with --help and parsing output.
  // This is a more realistic test anyway — it tests what users see.
  const { execFileSync } = await import("node:child_process");
  const result = execFileSync("node", ["--import", "tsx", "src/cli.ts", "--help"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 10_000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return result;
}

async function getSubcommandHelp(command: string) {
  const { execFileSync } = await import("node:child_process");
  try {
    return execFileSync("node", ["--import", "tsx", "src/cli.ts", command, "--help"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 10_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
  } catch (err: unknown) {
    // Commander exits with code 0 for --help but sometimes 1 for unknown commands
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
}

describe("CLI Contract: v2 command surface", () => {
  describe("Commands that MUST exist in v2", () => {
    it("top-level help lists pipeline, beads, decisions, config, init", async () => {
      const help = await getProgram();
      expect(help).toContain("pipeline");
      expect(help).toContain("beads");
      expect(help).toContain("decisions");
      expect(help).toContain("config");
      expect(help).toContain("init");
    });

    it("pipeline subcommand has create, list, status, pause, resume, cancel, done, clear", async () => {
      const help = await getSubcommandHelp("pipeline");
      expect(help).toContain("create");
      expect(help).toContain("list");
      expect(help).toContain("status");
      expect(help).toContain("pause");
      expect(help).toContain("resume");
      expect(help).toContain("cancel");
      expect(help).toContain("done");
      expect(help).toContain("clear");
    });

    it("beads subcommand has status, start, stop", async () => {
      const help = await getSubcommandHelp("beads");
      expect(help).toContain("status");
      expect(help).toContain("start");
      expect(help).toContain("stop");
    });

    it("config subcommand has show, set", async () => {
      const help = await getSubcommandHelp("config");
      expect(help).toContain("show");
      expect(help).toContain("set");
    });
  });

  describe("Tombstoned commands: print migration message, not 'unknown command' (Story B)", () => {
    // These tests define what Story B users see after upgrading.
    // They will FAIL until Phase 2.0 adds the tombstones.

    it.todo("hog board prints migration message suggesting hog cockpit");
    // Expected: "hog board was removed in v2.0. Use: hog cockpit"
    // NOT: "error: unknown command 'board'"

    it.todo("hog pick prints migration message suggesting hog pipeline create --issue");
    // Expected: "hog pick was removed in v2.0. Start pipelines: hog pipeline create --issue <ref>"

    it.todo("hog issue prints migration message");
    // Expected: "hog issue was removed in v2.0. GitHub integration: see hog init --help"

    it.todo("hog task prints migration message");
    // Expected: "hog task was removed in v2.0."

    it.todo("hog sync prints migration message");
    // Expected: "hog sync was removed in v2.0."
  });

  describe("v2 cockpit command", () => {
    // This will FAIL until Phase 2.1 creates the cockpit command
    it.todo("hog cockpit is a registered command");
    // Expected: `hog cockpit --help` exits 0 and shows help text
  });
});
