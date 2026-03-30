import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeTestQuality } from "./tdd-enforcement.js";

const TEST_DIR = join(tmpdir(), `hog-test-quality-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeTestFile(name: string, content: string): string {
  const path = join(TEST_DIR, name);
  writeFileSync(path, content);
  return name;
}

describe("analyzeTestQuality", () => {
  it("classifies behavioral test (JS/TS import + call)", () => {
    const file = writeTestFile(
      "behavioral.test.ts",
      `import { handleOnboarding } from "../src/coaching/engine";
      import { describe, it, expect } from "vitest";
      describe("onboarding", () => {
        it("handles new user", () => {
          const result = handleOnboarding({ message: "hi" });
          expect(result.state).toBe("discovery");
        });
      });`,
    );
    const report = analyzeTestQuality([file], TEST_DIR);
    expect(report.behavioral).toContain(file);
    expect(report.stringMatching).toHaveLength(0);
    expect(report.ratio).toBe(1);
  });

  it("classifies string-matching test (readFileSync + toMatch)", () => {
    const file = writeTestFile(
      "stringmatch.test.ts",
      `import { readFileSync } from "node:fs";
      import { describe, it, expect } from "vitest";
      describe("engine", () => {
        it("has handleOnboarding", () => {
          const content = readFileSync("src/coaching/engine.ts", "utf-8");
          expect(content).toMatch(/handleOnboarding/);
        });
      });`,
    );
    const report = analyzeTestQuality([file], TEST_DIR);
    expect(report.stringMatching).toContain(file);
    expect(report.behavioral).toHaveLength(0);
    expect(report.ratio).toBe(0);
  });

  it("classifies mixed file as behavioral (imports trump string-matching)", () => {
    const file = writeTestFile(
      "mixed.test.ts",
      `import { readFileSync } from "node:fs";
      import { createGoal } from "../src/goals/service";
      import { describe, it, expect } from "vitest";
      describe("goals", () => {
        it("creates goal", () => {
          const goal = createGoal({ title: "test" });
          expect(goal.id).toBeDefined();
        });
        it("has goal file", () => {
          const content = readFileSync("src/goals/service.ts", "utf-8");
          expect(content).toMatch(/createGoal/);
        });
      });`,
    );
    const report = analyzeTestQuality([file], TEST_DIR);
    expect(report.behavioral).toContain(file);
    expect(report.stringMatching).toHaveLength(0);
  });

  it("handles Python test files", () => {
    const file = writeTestFile(
      "test_engine.py",
      `from coaching.engine import handle_onboarding
      def test_onboarding():
          result = handle_onboarding({"message": "hi"})
          assert result["state"] == "discovery"`,
    );
    const report = analyzeTestQuality([file], TEST_DIR);
    expect(report.behavioral).toContain(file);
  });

  it("flags Python string-matching test", () => {
    const file = writeTestFile(
      "test_structure.py",
      `import re
      def test_has_function():
          with open("src/engine.py", "r") as f:
              content = f.read()
          assert re.search(r"def handle_onboarding", content)`,
    );
    const report = analyzeTestQuality([file], TEST_DIR);
    expect(report.stringMatching).toContain(file);
  });

  it("handles Rust test files", () => {
    const file = writeTestFile(
      "test_engine.rs",
      `use coaching::engine::handle_onboarding;
      #[test]
      fn test_onboarding() {
          let result = handle_onboarding("hi");
          assert_eq!(result.state, "discovery");
      }`,
    );
    const report = analyzeTestQuality([file], TEST_DIR);
    expect(report.behavioral).toContain(file);
  });

  it("returns ratio=1 when no test files exist", () => {
    const report = analyzeTestQuality([], TEST_DIR);
    expect(report.ratio).toBe(1);
    expect(report.behavioral).toHaveLength(0);
    expect(report.stringMatching).toHaveLength(0);
  });

  it("skips nonexistent files", () => {
    const report = analyzeTestQuality(["nonexistent.test.ts"], TEST_DIR);
    expect(report.ratio).toBe(1);
  });

  it("ignores vitest/jest imports when classifying as behavioral", () => {
    const file = writeTestFile(
      "only-vitest.test.ts",
      `import { describe, it, expect } from "vitest";
      describe("basic", () => {
        it("adds numbers", () => {
          expect(1 + 1).toBe(2);
        });
      });`,
    );
    const report = analyzeTestQuality([file], TEST_DIR);
    // Only has vitest import, no source imports — should be unknown, not behavioral
    expect(report.behavioral).toHaveLength(0);
    expect(report.stringMatching).toHaveLength(0);
  });

  it("computes correct ratio with multiple files", () => {
    const b1 = writeTestFile(
      "b1.test.ts",
      `import { foo } from "../src/foo"; expect(foo()).toBe(1);`,
    );
    const b2 = writeTestFile(
      "b2.test.ts",
      `import { bar } from "../src/bar"; expect(bar()).toBe(2);`,
    );
    const sm = writeTestFile(
      "sm1.test.ts",
      `import { readFileSync } from "node:fs";
      const c = readFileSync("src/foo.ts", "utf-8");
      expect(c).toMatch(/export/);`,
    );
    const report = analyzeTestQuality([b1, b2, sm], TEST_DIR);
    expect(report.behavioral).toHaveLength(2);
    expect(report.stringMatching).toHaveLength(1);
    expect(report.ratio).toBeCloseTo(2 / 3, 2);
  });
});
