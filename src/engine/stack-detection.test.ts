import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectMonorepo,
  detectStack,
  runBuildValidation,
} from "./stack-detection.js";

describe("detectStack", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stack-detect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("config file detection", () => {
    it("detects Expo from app.json with expo key", () => {
      writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { name: "app" } }));
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("expo");
      expect(stack?.runtime).toBe("node");
    });

    it("detects Expo from app.config.ts", () => {
      writeFileSync(join(dir, "app.config.ts"), "export default {}");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("expo");
    });

    it("detects Next.js from next.config.js", () => {
      writeFileSync(join(dir, "next.config.js"), "module.exports = {}");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("nextjs");
    });

    it("detects Next.js from next.config.mjs", () => {
      writeFileSync(join(dir, "next.config.mjs"), "export default {}");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("nextjs");
    });

    it("detects Angular from angular.json", () => {
      writeFileSync(join(dir, "angular.json"), "{}");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("angular");
    });

    it("detects SvelteKit from svelte.config.js", () => {
      writeFileSync(join(dir, "svelte.config.js"), "export default {}");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("sveltekit");
    });
  });

  describe("dependency detection", () => {
    it("detects Expo from package.json dependency", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { expo: "~50.0.0" } }),
      );
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("expo");
    });

    it("detects Next.js from package.json dependency", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      );
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("nextjs");
    });
  });

  describe("language detection", () => {
    it("detects Rust from Cargo.toml", () => {
      writeFileSync(join(dir, "Cargo.toml"), "[package]\nname = 'test'");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("rust");
      expect(stack?.runtime).toBe("rust");
    });

    it("detects Go from go.mod", () => {
      writeFileSync(join(dir, "go.mod"), "module example.com/test");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("go");
      expect(stack?.runtime).toBe("go");
    });

    it("detects Rails from Gemfile", () => {
      writeFileSync(join(dir, "Gemfile"), "gem 'rails', '~> 7.0'");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("rails");
      expect(stack?.runtime).toBe("ruby");
    });

    it("detects Python from pyproject.toml", () => {
      writeFileSync(join(dir, "pyproject.toml"), "[tool.pytest]");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("python");
    });

    it("detects generic TypeScript from tsconfig.json", () => {
      writeFileSync(join(dir, "tsconfig.json"), "{}");
      const stack = detectStack(dir);
      expect(stack?.framework).toBe("generic-ts");
    });
  });

  describe("fallback", () => {
    it("returns undefined for empty directory", () => {
      expect(detectStack(dir)).toBeUndefined();
    });
  });

  describe("script overrides", () => {
    it("uses package.json build script over framework default", () => {
      writeFileSync(join(dir, "next.config.js"), "module.exports = {}");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { build: "turbo run build" } }),
      );
      const stack = detectStack(dir);
      expect(stack?.buildCommands).toEqual(["npm run build"]);
    });

    it("uses package.json typecheck script over framework default", () => {
      writeFileSync(join(dir, "tsconfig.json"), "{}");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
      );
      const stack = detectStack(dir);
      expect(stack?.typecheckCommand).toBe("npm run typecheck");
    });
  });

  describe("convention checks", () => {
    it("expo preset includes default export check for app/", () => {
      writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: {} }));
      const stack = detectStack(dir);
      expect(stack?.conventionChecks.length).toBeGreaterThan(0);
      expect(stack?.conventionChecks.some((c) => c.name.includes("default-export"))).toBe(true);
    });

    it("nextjs preset includes default export check for app/ and pages/", () => {
      writeFileSync(join(dir, "next.config.js"), "module.exports = {}");
      const stack = detectStack(dir);
      expect(stack?.conventionChecks.length).toBe(2);
    });
  });

  describe("testing guidance", () => {
    it("expo guidance mentions react-native", () => {
      writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: {} }));
      const stack = detectStack(dir);
      expect(stack?.testingGuidance).toContain("react-native");
    });

    it("nextjs guidance mentions testing-library", () => {
      writeFileSync(join(dir, "next.config.js"), "module.exports = {}");
      const stack = detectStack(dir);
      expect(stack?.testingGuidance).toContain("testing-library");
    });
  });
});

describe("convention checks execution", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "conv-check-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds route files missing default export", () => {
    writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: {} }));
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "index.tsx"), "export function Home() { return null; }");
    writeFileSync(join(dir, "app", "about.tsx"), "export default function About() { return null; }");

    const stack = detectStack(dir)!;
    const check = stack.conventionChecks.find((c) => c.name.includes("default-export"))!;
    const violations = check.check(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("index.tsx");
  });

  it("reports no violations when all files have default export", () => {
    writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: {} }));
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "index.tsx"), "export default function Home() { return null; }");

    const stack = detectStack(dir)!;
    const check = stack.conventionChecks.find((c) => c.name.includes("default-export"))!;
    expect(check.check(dir)).toHaveLength(0);
  });

  it("skips _layout and hidden files", () => {
    writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: {} }));
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "_layout.tsx"), "export function Layout() {}");
    writeFileSync(join(dir, "app", ".hidden.tsx"), "no export");

    const stack = detectStack(dir)!;
    const check = stack.conventionChecks.find((c) => c.name.includes("default-export"))!;
    expect(check.check(dir)).toHaveLength(0);
  });
});

describe("detectMonorepo", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "monorepo-detect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects Turborepo from turbo.json", () => {
    writeFileSync(join(dir, "turbo.json"), "{}");
    expect(detectMonorepo(dir).type).toBe("turbo");
  });

  it("detects Nx from nx.json", () => {
    writeFileSync(join(dir, "nx.json"), "{}");
    expect(detectMonorepo(dir).type).toBe("nx");
  });

  it("detects pnpm workspaces", () => {
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages: ['packages/*']");
    expect(detectMonorepo(dir).type).toBe("pnpm");
  });

  it("detects npm workspaces from package.json", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    expect(detectMonorepo(dir).type).toBe("npm-workspaces");
  });

  it("returns none when no monorepo signals", () => {
    expect(detectMonorepo(dir).type).toBe("none");
  });
});

describe("runBuildValidation", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "build-val-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes when no build commands and no convention violations", () => {
    const stack = detectStack(dir); // undefined — no stack
    // Simulate a stack with no commands
    const result = runBuildValidation(dir, {
      framework: "test",
      runtime: "node",
      buildCommands: [],
      conventionChecks: [],
      testingGuidance: "",
    });
    expect(result.passed).toBe(true);
  });

  it("fails when convention check finds violations", () => {
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "bad.tsx"), "export function Bad() {}");

    const result = runBuildValidation(dir, {
      framework: "expo",
      runtime: "node",
      buildCommands: [],
      conventionChecks: [
        {
          name: "test-check",
          description: "Must have default export",
          check: () => ["app/bad.tsx"],
        },
      ],
      testingGuidance: "",
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("test-check");
    expect(result.context).toContain("app/bad.tsx");
  });

  it("fails when typecheck command fails", () => {
    const result = runBuildValidation(dir, {
      framework: "test",
      runtime: "node",
      buildCommands: [],
      typecheckCommand: "false", // always fails
      conventionChecks: [],
      testingGuidance: "",
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Typecheck failed");
  });

  it("skips build commands when typecheck already failed (fast feedback)", () => {
    let buildRan = false;
    const result = runBuildValidation(dir, {
      framework: "test",
      runtime: "node",
      buildCommands: ["echo build-should-not-run"],
      typecheckCommand: "false",
      conventionChecks: [],
      testingGuidance: "",
    });
    expect(result.passed).toBe(false);
    // Build was skipped because typecheck failed first
    expect(result.reason).not.toContain("Build failed");
  });
});
