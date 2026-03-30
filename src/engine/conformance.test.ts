import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkArchitectureConformance,
  parseDependencies,
  parseFileStructure,
} from "./conformance.js";

const TEST_DIR = join(tmpdir(), `hog-conformance-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(TEST_DIR, "src"), { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("parseDependencies", () => {
  it("extracts package names from dependencies table", () => {
    const content = `## Dependencies

| Package | Purpose |
|---------|---------|
| drizzle-orm | Database ORM |
| @clerk/nextjs | Authentication |
| zod | Validation |

## Next Section`;
    const deps = parseDependencies(content);
    expect(deps).toEqual(["drizzle-orm", "@clerk/nextjs", "zod"]);
  });

  it("handles backtick-wrapped package names", () => {
    const content = `## Dependencies

| Package | Purpose |
|---------|---------|
| \`express\` | Web framework |`;
    expect(parseDependencies(content)).toEqual(["express"]);
  });

  it("returns empty for missing section", () => {
    expect(parseDependencies("# Architecture\n\nNo deps section")).toEqual([]);
  });

  it("skips header row markers", () => {
    const content = `## Dependencies

| Package | Purpose |
|---------|---------|
| react | UI |`;
    const deps = parseDependencies(content);
    expect(deps).not.toContain("---");
    expect(deps).toContain("react");
  });
});

describe("parseFileStructure", () => {
  it("extracts backtick-wrapped file paths", () => {
    const content = `## File Structure

- \`src/engine.ts\` — main engine
- \`src/db/schema.ts\` — database schema
- \`app/api/goals/route.ts\` — goals API

## Next Section`;
    const files = parseFileStructure(content);
    expect(files).toEqual(["src/engine.ts", "src/db/schema.ts", "app/api/goals/route.ts"]);
  });

  it("returns empty for missing section", () => {
    expect(parseFileStructure("# Architecture\n\nNo files")).toEqual([]);
  });
});

describe("checkArchitectureConformance", () => {
  it("passes when arch doc not found", async () => {
    const result = await checkArchitectureConformance(TEST_DIR, "/nonexistent.md");
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("not found");
  });

  it("passes when no violations detected", async () => {
    const archPath = join(TEST_DIR, "arch.md");
    writeFileSync(archPath, "# Architecture\n\nNo deps or files sections.");

    const result = await checkArchitectureConformance(TEST_DIR, archPath);
    expect(result.passed).toBe(true);
  });

  it("detects missing files", async () => {
    const archPath = join(TEST_DIR, "arch-files.md");
    writeFileSync(
      archPath,
      `## File Structure

- \`src/nonexistent-file.ts\` — should exist but doesn't`,
    );

    const result = await checkArchitectureConformance(TEST_DIR, archPath);
    expect(result.passed).toBe(false);
    expect(result.missingFiles).toContain("src/nonexistent-file.ts");
  });

  it("passes when specified files exist", async () => {
    const archPath = join(TEST_DIR, "arch-exists.md");
    // Create the file that arch doc expects
    writeFileSync(join(TEST_DIR, "src", "exists.ts"), "export const x = 1;");
    writeFileSync(
      archPath,
      `## File Structure

- \`src/exists.ts\` — should exist`,
    );

    const result = await checkArchitectureConformance(TEST_DIR, archPath);
    expect(result.missingFiles).not.toContain("src/exists.ts");
  });

  it("detects stub patterns in source files", async () => {
    writeFileSync(join(TEST_DIR, "src", "stubby.ts"), "// TODO: implement this properly\nexport function foo() { return []; }");

    const archPath = join(TEST_DIR, "arch-clean.md");
    writeFileSync(archPath, "# Architecture\n\n## File Structure\n\n- `src/stubby.ts`");

    const result = await checkArchitectureConformance(TEST_DIR, archPath);
    expect(result.stubs.length).toBeGreaterThan(0);
  });
});
