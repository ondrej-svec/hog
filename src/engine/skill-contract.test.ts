import { describe, expect, it } from "vitest";
import {
  getSkillContract,
  resolveOutputPaths,
  SKILL_CONTRACTS,
  validateContract,
  wirePhaseInputs,
} from "./skill-contract.js";

describe("skill-contract", () => {
  describe("validateContract", () => {
    it("returns valid when all required inputs are provided", () => {
      const contract = {
        inputs: { STORIES_PATH: { required: true, fallback: "search" as const } },
        outputs: {},
      };
      const result = validateContract(contract, { STORIES_PATH: "docs/stories/foo.md" });
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it("returns invalid when required inputs are missing", () => {
      const contract = {
        inputs: { STORIES_PATH: { required: true, fallback: "search" as const } },
        outputs: {},
      };
      const result = validateContract(contract, {});
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("STORIES_PATH");
    });

    it("returns warnings for optional missing inputs", () => {
      const contract = {
        inputs: { ARCH_PATH: { required: false, fallback: "search" as const } },
        outputs: {},
      };
      const result = validateContract(contract, {});
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("ARCH_PATH");
    });
  });

  describe("resolveOutputPaths", () => {
    it("substitutes {slug} in output templates", () => {
      const contract = {
        inputs: {},
        outputs: {
          stories: "docs/stories/{slug}.md",
          architecture: "docs/stories/{slug}.architecture.md",
        },
      };
      const resolved = resolveOutputPaths(contract, { slug: "my-feature" });
      expect(resolved["stories"]).toBe("docs/stories/my-feature.md");
      expect(resolved["architecture"]).toBe("docs/stories/my-feature.architecture.md");
    });
  });

  describe("wirePhaseInputs", () => {
    it("maps output names to input env vars", () => {
      const outputs = {
        stories: "docs/stories/auth.md",
        architecture: "docs/stories/auth.architecture.md",
      };
      const nextContract = {
        inputs: {
          STORIES_PATH: { required: false, fallback: "search" as const },
          ARCH_PATH: { required: false, fallback: "search" as const },
        },
        outputs: {},
      };
      const env = wirePhaseInputs(outputs, nextContract);
      expect(env["STORIES_PATH"]).toBe("docs/stories/auth.md");
      expect(env["ARCH_PATH"]).toBe("docs/stories/auth.architecture.md");
    });

    it("skips outputs that don't match any input", () => {
      const outputs = { context: "docs/stories/auth.context.md" };
      const nextContract = {
        inputs: { STORIES_PATH: { required: false, fallback: "search" as const } },
        outputs: {},
      };
      const env = wirePhaseInputs(outputs, nextContract);
      expect(Object.keys(env)).toHaveLength(0);
    });
  });

  describe("getSkillContract", () => {
    it("returns contract for known skills", () => {
      const contract = getSkillContract("marvin:test-writer");
      expect(contract).toBeDefined();
      expect(contract?.inputs["STORIES_PATH"]).toBeDefined();
    });

    it("returns undefined for unknown skills", () => {
      expect(getSkillContract("nonexistent:skill")).toBeUndefined();
    });
  });

  describe("SKILL_CONTRACTS", () => {
    it("defines contracts for all 7 pipeline skills", () => {
      const expected = [
        "deep-thought:brainstorm",
        "deep-thought:architect",
        "marvin:scaffold",
        "marvin:test-writer",
        "marvin:work",
        "marvin:redteam",
        "marvin:review",
      ];
      for (const skill of expected) {
        expect(SKILL_CONTRACTS[skill]).toBeDefined();
      }
    });
  });
});
