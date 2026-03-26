/**
 * Tests for the role-audit quality gate (Amodei recommendation).
 * Verifies each pipeline role stays within its allowed file scope.
 */
import { describe, expect, it } from "vitest";
import { createRoleAuditGate } from "./quality-gates.js";

describe("roleAuditGate", () => {
	describe("test role", () => {
		const gate = createRoleAuditGate("test");

		it("passes when only test files are modified", async () => {
			const result = await gate.check("/tmp", [
				"src/auth.test.ts",
				"tests/integration/login.spec.ts",
				"__tests__/utils.test.tsx",
			]);
			expect(result.passed).toBe(true);
			expect(result.issues).toHaveLength(0);
		});

		it("fails when source files are modified", async () => {
			const result = await gate.check("/tmp", [
				"src/auth.test.ts",
				"src/auth.ts", // violation!
			]);
			expect(result.passed).toBe(false);
			expect(result.issues).toHaveLength(1);
			expect(result.issues[0]?.file).toBe("src/auth.ts");
		});

		it("fails when config files are modified", async () => {
			const result = await gate.check("/tmp", ["package.json"]);
			expect(result.passed).toBe(false);
		});
	});

	describe("impl role", () => {
		const gate = createRoleAuditGate("impl");

		it("passes when only source files are modified", async () => {
			const result = await gate.check("/tmp", [
				"src/auth.ts",
				"src/utils/hash.ts",
			]);
			expect(result.passed).toBe(true);
		});

		it("fails when test files are modified", async () => {
			const result = await gate.check("/tmp", [
				"src/auth.ts",
				"src/auth.test.ts", // violation!
			]);
			expect(result.passed).toBe(false);
			expect(result.issues).toHaveLength(1);
			expect(result.issues[0]?.file).toBe("src/auth.test.ts");
		});
	});

	describe("stories role", () => {
		const gate = createRoleAuditGate("stories");

		it("passes when only docs/stories files are modified", async () => {
			const result = await gate.check("/tmp", [
				"docs/stories.md",
				"tests/stories/auth.md",
			]);
			expect(result.passed).toBe(true);
		});

		it("fails when source files are modified", async () => {
			const result = await gate.check("/tmp", ["src/auth.ts"]);
			expect(result.passed).toBe(false);
		});
	});

	describe("redteam role", () => {
		const gate = createRoleAuditGate("redteam");

		it("passes when only test files are modified", async () => {
			const result = await gate.check("/tmp", ["src/auth.test.ts"]);
			expect(result.passed).toBe(true);
		});

		it("fails when implementation files are modified", async () => {
			const result = await gate.check("/tmp", ["src/auth.ts"]);
			expect(result.passed).toBe(false);
		});
	});

	describe("merge role", () => {
		const gate = createRoleAuditGate("merge");

		it("passes for any files (merge has no restrictions)", async () => {
			const result = await gate.check("/tmp", [
				"src/auth.ts",
				"src/auth.test.ts",
				"package.json",
			]);
			expect(result.passed).toBe(true);
		});
	});

	describe("brainstorm role", () => {
		const gate = createRoleAuditGate("brainstorm");

		it("passes for any files (brainstorm has no restrictions)", async () => {
			const result = await gate.check("/tmp", ["src/anything.ts"]);
			expect(result.passed).toBe(true);
		});
	});

	it("is always available (no external tools needed)", () => {
		const gate = createRoleAuditGate("test");
		expect(gate.isAvailable("/tmp")).toBe(true);
	});

	it("has error severity", () => {
		const gate = createRoleAuditGate("test");
		expect(gate.severity).toBe("error");
	});
});
