import { describe, expect, it } from "vitest";
import { PIPELINE_ROLES, beadLabelToRole } from "./roles.js";

describe("roles", () => {
  it("maps hog:stories label to stories role", () => {
    expect(beadLabelToRole(["hog:stories"])).toBe("stories");
  });

  it("maps hog:test label to test role", () => {
    expect(beadLabelToRole(["hog:test"])).toBe("test");
  });

  it("maps hog:impl label to impl role", () => {
    expect(beadLabelToRole(["hog:impl"])).toBe("impl");
  });

  it("maps hog:redteam label to redteam role", () => {
    expect(beadLabelToRole(["hog:redteam"])).toBe("redteam");
  });

  it("maps hog:merge label to merge role", () => {
    expect(beadLabelToRole(["hog:merge"])).toBe("merge");
  });

  it("returns undefined for unknown labels", () => {
    expect(beadLabelToRole(["bug", "feature"])).toBeUndefined();
  });

  it("finds role among mixed labels", () => {
    expect(beadLabelToRole(["critical", "hog:impl", "auth"])).toBe("impl");
  });

  it("all 5 pipeline roles have prompts", () => {
    const roles = Object.keys(PIPELINE_ROLES);
    expect(roles).toHaveLength(5);
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
});
