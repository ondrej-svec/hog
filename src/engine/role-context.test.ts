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
    const roles: PipelineRole[] = ["brainstorm", "stories", "scaffold", "test", "impl", "redteam", "merge"];

    for (const role of roles) {
      it(`writes CLAUDE.md for ${role} role (fallback mode)`, () => {
        writeRoleClaudeMd(tempDir, role);

        const claudeMdPath = join(tempDir, "CLAUDE.md");
        expect(existsSync(claudeMdPath)).toBe(true);

        const content = readFileSync(claudeMdPath, "utf-8");
        expect(content.length).toBeGreaterThan(50);
      });
    }

    it("impl CLAUDE.md has binding architecture and forbids test modification", () => {
      writeRoleClaudeMd(tempDir, "impl");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("REAL, production-quality code");
      expect(content).toContain("architecture doc is BINDING");
      expect(content).toContain("Do NOT modify test files");
    });

    it("test CLAUDE.md enforces RED state", () => {
      writeRoleClaudeMd(tempDir, "test");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Stories");
      expect(content).toContain("Architecture doc");
      expect(content).toContain("RED state");
    });

    it("stories CLAUDE.md forbids writing code and mentions architecture doc", () => {
      writeRoleClaudeMd(tempDir, "stories");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Do NOT write any code");
      expect(content).toContain("architecture doc");
    });

    it("redteam CLAUDE.md forbids modifying implementation", () => {
      writeRoleClaudeMd(tempDir, "redteam");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Do NOT modify implementation code");
      expect(content).toContain("failing tests");
    });

    it("brainstorm CLAUDE.md is about thinking before coding", () => {
      writeRoleClaudeMd(tempDir, "brainstorm");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Brainstorm");
      expect(content).toContain("hog pipeline done");
    });

    it("merge CLAUDE.md forbids modifying source and tests", () => {
      writeRoleClaudeMd(tempDir, "merge");
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("Do NOT fix implementation");
      expect(content).toContain("MERGE or BLOCK");
    });

    it("skill mode produces minimal scope-only CLAUDE.md", () => {
      writeRoleClaudeMd(tempDir, "impl", undefined, true);
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("primary instructions come from the skill");
      expect(content).toContain("Scope");
      // Should NOT contain detailed prose
      expect(content).not.toContain("REAL, production-quality code");
    });

    it("skill mode CLAUDE.md is shorter than fallback mode", () => {
      const skillDir = mkdtempSync(join(tmpdir(), "hog-skill-"));
      const fallbackDir = mkdtempSync(join(tmpdir(), "hog-fallback-"));

      writeRoleClaudeMd(skillDir, "impl", undefined, true);
      writeRoleClaudeMd(fallbackDir, "impl", undefined, false);

      const skillContent = readFileSync(join(skillDir, "CLAUDE.md"), "utf-8");
      const fallbackContent = readFileSync(join(fallbackDir, "CLAUDE.md"), "utf-8");

      expect(skillContent.length).toBeLessThan(fallbackContent.length);

      rmSync(skillDir, { recursive: true, force: true });
      rmSync(fallbackDir, { recursive: true, force: true });
    });

    it("injects file paths when variables are provided", () => {
      writeRoleClaudeMd(tempDir, "impl", {
        storiesPath: "docs/stories/auth.md",
        archPath: "docs/stories/auth.architecture.md",
      });
      const content = readFileSync(join(tempDir, "CLAUDE.md"), "utf-8");

      expect(content).toContain("docs/stories/auth.md");
      expect(content).toContain("docs/stories/auth.architecture.md");
    });
  });

  // STORY-009: As a pipeline operator, agents launch with --dangerously-skip-permissions
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
