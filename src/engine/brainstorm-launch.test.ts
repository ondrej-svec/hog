/**
 * Tests for brainstorm pipeline context — verifies the prompt and env vars
 * that get passed to brainstorm sessions contain stories path, arch path,
 * feature ID, and the hog pipeline done command.
 *
 * Brainstorm is launched from the cockpit (Z-key or P:new auto-launch),
 * not by the conductor tick. These tests verify the context construction
 * logic that both launch paths use.
 */
import { describe, expect, it } from "vitest";
import { buildBrainstormLaunchContext } from "./brainstorm-context.js";

/** Alias for test readability. */
const buildBrainstormPrompt = buildBrainstormLaunchContext;

describe("brainstorm prompt construction", () => {
  const DEFAULT_OPTS = {
    title: "Add user authentication",
    description: "Build OAuth login with Google and GitHub providers",
    featureId: "feat-abc123",
  };

  it("includes exact stories path based on slug", () => {
    const { prompt, storiesPath } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(storiesPath).toBe("docs/stories/add-user-authentication.md");
    expect(prompt).toContain(storiesPath);
  });

  it("includes exact architecture doc path based on slug", () => {
    const { prompt, archPath } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(archPath).toBe("docs/stories/add-user-authentication.architecture.md");
    expect(prompt).toContain(archPath);
  });

  it("includes hog pipeline done command with feature ID", () => {
    const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(prompt).toContain("hog pipeline done feat-abc123");
  });

  it("includes user description", () => {
    const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(prompt).toContain("Build OAuth login with Google and GitHub providers");
  });

  it("includes story format guidance", () => {
    const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(prompt).toContain("STORY-001");
    expect(prompt).toContain("acceptance criteria");
    expect(prompt).toContain("edge cases");
  });

  it("includes architecture doc format guidance", () => {
    const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(prompt).toContain("ADRs");
    expect(prompt).toContain("Dependencies");
    expect(prompt).toContain("File Structure");
  });

  it("wraps pipeline context in XML tags", () => {
    const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(prompt).toContain("<hog_pipeline_context>");
    expect(prompt).toContain("</hog_pipeline_context>");
  });

  it("warns about exact file paths", () => {
    const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(prompt).toContain("These file paths are EXACT");
  });

  it("warns that pipeline cannot advance without step 3", () => {
    const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
    expect(prompt).toContain("Do NOT skip step 3");
  });

  describe("env vars", () => {
    it("sets HOG_PIPELINE=1", () => {
      const { env } = buildBrainstormPrompt(DEFAULT_OPTS);
      expect(env["HOG_PIPELINE"]).toBe("1");
    });

    it("sets FEATURE_ID from pipeline", () => {
      const { env } = buildBrainstormPrompt(DEFAULT_OPTS);
      expect(env["FEATURE_ID"]).toBe("feat-abc123");
    });

    it("sets HOG_SLUG from title", () => {
      const { env } = buildBrainstormPrompt(DEFAULT_OPTS);
      expect(env["HOG_SLUG"]).toBe("add-user-authentication");
    });

    it("sets STORIES_PATH to exact path", () => {
      const { env } = buildBrainstormPrompt(DEFAULT_OPTS);
      expect(env["STORIES_PATH"]).toBe("docs/stories/add-user-authentication.md");
    });

    it("sets ARCH_PATH to exact path", () => {
      const { env } = buildBrainstormPrompt(DEFAULT_OPTS);
      expect(env["ARCH_PATH"]).toBe("docs/stories/add-user-authentication.architecture.md");
    });
  });

  describe("slug generation", () => {
    it("converts title to kebab-case", () => {
      const { slug } = buildBrainstormPrompt({ ...DEFAULT_OPTS, title: "Add User Auth" });
      expect(slug).toBe("add-user-auth");
    });

    it("strips special characters", () => {
      const { slug } = buildBrainstormPrompt({ ...DEFAULT_OPTS, title: "Fix bug #42: login!" });
      expect(slug).toBe("fix-bug-42-login");
    });

    it("strips leading/trailing hyphens", () => {
      const { slug } = buildBrainstormPrompt({ ...DEFAULT_OPTS, title: "---test---" });
      expect(slug).toBe("test");
    });
  });

  describe("prompt ordering (skill path)", () => {
    it("skill invocation comes before description", () => {
      const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
      // In skill mode, prompt starts with slash command or fallback prompt
      // Either way, description should come after the initial prompt
      const descIdx = prompt.indexOf("Build OAuth login");
      const contextIdx = prompt.indexOf("<hog_pipeline_context>");
      expect(descIdx).toBeGreaterThan(-1);
      expect(contextIdx).toBeGreaterThan(descIdx);
    });

    it("pipeline context comes last", () => {
      const { prompt } = buildBrainstormPrompt(DEFAULT_OPTS);
      const descIdx = prompt.indexOf("Build OAuth login");
      const contextIdx = prompt.indexOf("<hog_pipeline_context>");
      expect(contextIdx).toBeGreaterThan(descIdx);
    });
  });
});
