import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAgentLaunchArgs, buildTmuxSessionName, writeRoleClaudeMd } from "./role-context.js";
import type { PipelineRole } from "./roles.js";

describe("role-context", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hog-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // STORY-008: As a pipeline operator, each worktree gets a role-specific CLAUDE.md
  // that restricts what the agent can do
  describe("STORY-008: Role-specific CLAUDE.md generation", () => {
    const roles: PipelineRole[] = ["brainstorm", "stories", "test", "impl", "redteam", "merge"];

    for (const role of roles) {
      it(`writes CLAUDE.md for ${role} role`, () => {
        writeRoleClaudeMd(tempDir, role);

        const claudeMdPath = join(tempDir, "CLAUDE.md");
        expect(existsSync(claudeMdPath)).toBe(true);

        const content = readFileSync(claudeMdPath, "utf-8");
        expect(content.length).toBeGreaterThan(100);
        // Brainstorm is an "Interactive Session", all others are "Agent Role"
        if (role === "brainstorm") {
          expect(content).toContain("Interactive Session:");
        } else {
          expect(content).toContain("Agent Role:");
        }
      });
    }

    it("impl CLAUDE.md allows stories but forbids spec documents", () => {
      writeRoleClaudeMd(tempDir, "impl");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Read user stories");
      expect(content).toContain("Read architecture docs");
      expect(content).toContain("REAL, production-quality code");
      expect(content).toContain("Do NOT read `docs/brainstorms/`");
    });

    it("test CLAUDE.md allows stories and architecture", () => {
      writeRoleClaudeMd(tempDir, "test");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("User stories");
      expect(content).toContain("Architecture doc");
      expect(content).toContain("catch scaffolding");
    });

    it("stories CLAUDE.md forbids writing code", () => {
      writeRoleClaudeMd(tempDir, "stories");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Do NOT write any code");
      expect(content).toContain("Do NOT modify any source files");
    });

    it("redteam CLAUDE.md forbids modifying implementation", () => {
      writeRoleClaudeMd(tempDir, "redteam");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Do NOT modify implementation code");
      expect(content).toContain("only expose them with failing tests");
    });

    it("brainstorm CLAUDE.md allows reading anything but restricts writing", () => {
      writeRoleClaudeMd(tempDir, "brainstorm");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Read any file");
      expect(content).toContain("Do NOT write implementation code");
      expect(content).toContain("hog pipeline create");
    });

    it("merge CLAUDE.md forbids modifying source and tests", () => {
      writeRoleClaudeMd(tempDir, "merge");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Do NOT modify source files");
      expect(content).toContain("Do NOT skip failing tests");
    });
  });

  // STORY-009: As a pipeline operator, agents launch with --dangerously-skip-permissions
  // for autonomy, with CLAUDE.md as the behavioral guardrail
  describe("STORY-009: Agent launch args include skip-permissions", () => {
    it("includes --dangerously-skip-permissions flag", () => {
      const args = buildAgentLaunchArgs("test prompt");
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("includes -p flag with prompt", () => {
      const args = buildAgentLaunchArgs("implement the feature");
      const pIdx = args.indexOf("-p");
      expect(pIdx).toBeGreaterThan(-1);
      expect(args[pIdx + 1]).toBe("implement the feature");
    });

    it("includes stream-json output format", () => {
      const args = buildAgentLaunchArgs("prompt");
      expect(args).toContain("stream-json");
    });

    it("prepends extra args before the flags", () => {
      const args = buildAgentLaunchArgs("prompt", ["--model", "sonnet"]);
      expect(args[0]).toBe("--model");
      expect(args[1]).toBe("sonnet");
    });
  });

  describe("tmux session naming", () => {
    it("generates deterministic session names", () => {
      const name = buildTmuxSessionName("feat-123", "impl");
      expect(name).toBe("hog-feat-123-impl");
    });
  });
});
