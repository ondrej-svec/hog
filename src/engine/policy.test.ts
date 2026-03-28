import { describe, expect, it } from "vitest";
import {
  installPreset,
  loadPolicies,
  mergeWithBuiltinGates,
  policyToGate,
  PRESETS,
  type Policy,
} from "./policy.js";
import type { QualityGate } from "./quality-gates.js";

// ── Policy Schema Tests ──

describe("Policy-as-Code Engine", () => {
  describe("PRESETS", () => {
    it("has typescript, python, and rust presets", () => {
      expect(Object.keys(PRESETS)).toContain("typescript");
      expect(Object.keys(PRESETS)).toContain("python");
      expect(Object.keys(PRESETS)).toContain("rust");
    });

    it("typescript preset has biome-lint, typecheck, and dependency-audit", () => {
      const ts = PRESETS["typescript"]!;
      const names = ts.policies.map((p) => p.name);
      expect(names).toContain("biome-lint");
      expect(names).toContain("typecheck");
      expect(names).toContain("dependency-audit");
    });

    it("all preset policies have valid commands", () => {
      for (const preset of Object.values(PRESETS)) {
        for (const policy of preset.policies) {
          expect(policy.command.length).toBeGreaterThan(0);
          expect(policy.name.length).toBeGreaterThan(0);
          expect(policy.severity).toMatch(/^(error|warning)$/);
        }
      }
    });
  });

  describe("policyToGate", () => {
    it("converts a policy to a QualityGate with correct name and severity", () => {
      const policy: Policy = {
        name: "test-gate",
        severity: "error",
        command: "echo ok",
        on: ["merge"],
        message: "Test failed",
        timeout: 30,
      };

      const gate = policyToGate(policy);
      expect(gate.name).toBe("test-gate");
      expect(gate.severity).toBe("error");
      expect(gate.isAvailable("/tmp")).toBe(true);
    });

    it("gate passes when command exits 0", async () => {
      const policy: Policy = {
        name: "echo-pass",
        severity: "warning",
        command: "echo ok",
        on: ["merge"],
        message: "Should not appear",
        timeout: 10,
      };

      const gate = policyToGate(policy);
      const result = await gate.check("/tmp", ["file.ts"]);
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("gate fails when command exits non-zero", async () => {
      const policy: Policy = {
        name: "false-fail",
        severity: "error",
        command: "false",
        on: ["merge"],
        message: "Expected failure",
        timeout: 10,
      };

      const gate = policyToGate(policy);
      const result = await gate.check("/tmp", ["file.ts"]);
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]?.message).toContain("Expected failure");
    });

    it("passes HOG_CHANGED_FILES env to command", async () => {
      const policy: Policy = {
        name: "env-check",
        severity: "warning",
        command: "printenv HOG_CHANGED_FILES",
        on: ["merge"],
        message: "Env check",
        timeout: 10,
      };

      const gate = policyToGate(policy);
      // This should pass because printenv will find the env var
      const result = await gate.check("/tmp", ["src/a.ts", "src/b.ts"]);
      expect(result.passed).toBe(true);
    });
  });

  describe("mergeWithBuiltinGates", () => {
    it("returns built-in gates when no policies exist", () => {
      const builtins: QualityGate[] = [
        {
          name: "linting",
          severity: "warning",
          isAvailable: () => true,
          check: async () => ({ gate: "linting", severity: "warning" as const, passed: true, issues: [], detail: "ok" }),
        },
      ];

      // No .hog/policies/ directory
      const merged = mergeWithBuiltinGates("/nonexistent/path", builtins);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.name).toBe("linting");
    });
  });

  describe("loadPolicies", () => {
    it("returns empty array for nonexistent directory", () => {
      const policies = loadPolicies("/nonexistent/path");
      expect(policies).toEqual([]);
    });
  });

  describe("installPreset", () => {
    it("returns 0 for unknown preset", () => {
      const installed = installPreset("/tmp", "nonexistent-preset");
      expect(installed).toBe(0);
    });
  });
});
