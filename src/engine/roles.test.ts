import { describe, expect, it } from "vitest";
import { beadToRole, PIPELINE_ROLES } from "./roles.js";

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

  it("title prefix takes precedence over labels", () => {
    expect(beadToRole({ title: "[hog:test] Tests", labels: ["hog:impl"] })).toBe("test");
  });

  it("all 6 pipeline roles have prompts", () => {
    const roles = Object.keys(PIPELINE_ROLES);
    expect(roles).toHaveLength(6);
    for (const role of roles) {
      const config = PIPELINE_ROLES[role as keyof typeof PIPELINE_ROLES];
      expect(config.promptTemplate.length).toBeGreaterThan(50);
      expect(config.envRole).toContain("HOG_ROLE=");
    }
  });

  it("impl prompt explicitly excludes spec access", () => {
    const implPrompt = PIPELINE_ROLES.impl.promptTemplate;
    expect(implPrompt).toContain("do NOT have");
    expect(implPrompt).toContain("ONLY see the failing tests");
  });

  it("test prompt explicitly excludes spec access", () => {
    const testPrompt = PIPELINE_ROLES.test.promptTemplate;
    expect(testPrompt).toContain("do NOT have the original spec");
  });

  it("brainstorm prompt encourages collaboration", () => {
    const prompt = PIPELINE_ROLES.brainstorm.promptTemplate;
    expect(prompt).toContain("brainstorm");
    expect(prompt).toContain("hog pipeline create");
    expect(prompt).toContain("--brainstorm-done");
  });

  it("brainstorm role detected from label fallback", () => {
    expect(beadToRole({ title: "Some task", labels: ["hog:brainstorm"] })).toBe("brainstorm");
  });
});
