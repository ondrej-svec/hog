import { describe, expect, it } from "vitest";
import { beadToRole, loadFallbackPrompt, PIPELINE_ROLES, resolvePromptForRole } from "./roles.js";

describe("roles", () => {
  it("maps [hog:brainstorm] title prefix to brainstorm role", () => {
    expect(beadToRole({ title: "[hog:brainstorm] Brainstorm: Auth" })).toBe("brainstorm");
  });

  it("maps [hog:stories] title prefix to stories role", () => {
    expect(beadToRole({ title: "[hog:stories] User stories: Auth" })).toBe("stories");
  });

  it("maps [hog:test] title prefix to test role", () => {
    expect(beadToRole({ title: "[hog:test] Acceptance tests: Auth" })).toBe("test");
  });

  it("maps [hog:impl] title prefix to impl role", () => {
    expect(beadToRole({ title: "[hog:impl] Implement: Auth" })).toBe("impl");
  });

  it("maps [hog:redteam] title prefix to redteam role", () => {
    expect(beadToRole({ title: "[hog:redteam] Red team: Auth" })).toBe("redteam");
  });

  it("maps [hog:merge] title prefix to merge role", () => {
    expect(beadToRole({ title: "[hog:merge] Refinery merge: Auth" })).toBe("merge");
  });

  it("returns undefined for titles without role prefix", () => {
    expect(beadToRole({ title: "Fix login bug" })).toBeUndefined();
  });

  it("falls back to labels when title has no prefix", () => {
    expect(beadToRole({ title: "Some task", labels: ["hog:impl"] })).toBe("impl");
  });

  it("scaffold role detected from label fallback", () => {
    expect(beadToRole({ title: "Some task", labels: ["hog:scaffold"] })).toBe("scaffold");
  });

  it("title prefix takes precedence over labels", () => {
    expect(beadToRole({ title: "[hog:test] Tests", labels: ["hog:impl"] })).toBe("test");
  });

  it("all 7 pipeline roles have skill names and fallback prompts", () => {
    const roles = Object.keys(PIPELINE_ROLES);
    expect(roles).toHaveLength(7);
    for (const role of roles) {
      const config = PIPELINE_ROLES[role as keyof typeof PIPELINE_ROLES];
      expect(config.skill).toBeTruthy();
      expect(config.skill).toContain(":");
      expect(config.fallbackPromptFile).toBeTruthy();
      expect(config.envRole).toContain("HOG_ROLE=");
    }
  });

  it("maps roles to correct toolkit skills", () => {
    expect(PIPELINE_ROLES.brainstorm.skill).toBe("deep-thought:brainstorm");
    expect(PIPELINE_ROLES.stories.skill).toBe("deep-thought:architect");
    expect(PIPELINE_ROLES.scaffold.skill).toBe("marvin:scaffold");
    expect(PIPELINE_ROLES.test.skill).toBe("marvin:test-writer");
    expect(PIPELINE_ROLES.impl.skill).toBe("marvin:work");
    expect(PIPELINE_ROLES.redteam.skill).toBe("marvin:redteam");
    expect(PIPELINE_ROLES.merge.skill).toBe("marvin:review");
  });

  it("loads fallback prompts from bundled files", () => {
    for (const role of Object.values(PIPELINE_ROLES)) {
      const prompt = loadFallbackPrompt(role.fallbackPromptFile);
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  it("impl fallback prompt treats architecture as binding", () => {
    const prompt = loadFallbackPrompt("work");
    expect(prompt).toContain("architecture doc is BINDING");
    expect(prompt).toContain("executable_self_check");
  });

  it("test-writer fallback prompt references stories and architecture", () => {
    const prompt = loadFallbackPrompt("test-writer");
    expect(prompt).toContain("{storiesPath}");
    expect(prompt).toContain("{archPath}");
  });

  it("brainstorm fallback prompt references pipeline done", () => {
    const prompt = loadFallbackPrompt("brainstorm");
    expect(prompt).toContain("brainstorm");
    expect(prompt).toContain("hog pipeline done");
  });

  it("resolvePromptForRole returns a valid prompt", () => {
    const { prompt, usingSkill } = resolvePromptForRole("test");
    if (usingSkill) {
      // Toolkit installed: prompt is the skill slash command
      expect(prompt).toBe("/marvin:test-writer");
    } else {
      // Toolkit not installed: prompt is the fallback content
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  it("brainstorm role detected from label fallback", () => {
    expect(beadToRole({ title: "Some task", labels: ["hog:brainstorm"] })).toBe("brainstorm");
  });
});
