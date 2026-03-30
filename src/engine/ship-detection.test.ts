import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkOperationalReadiness, detectDeploymentNeed } from "./ship-detection.js";

describe("detectDeploymentNeed", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ship-detect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects vercel.json", () => {
    writeFileSync(join(dir, "vercel.json"), "{}");
    const result = detectDeploymentNeed(dir);
    expect(result.needed).toBe(true);
    expect(result.signals.some((s) => s.includes("vercel.json"))).toBe(true);
  });

  it("detects Dockerfile", () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node:22");
    const result = detectDeploymentNeed(dir);
    expect(result.needed).toBe(true);
    expect(result.signals.some((s) => s.includes("Dockerfile"))).toBe(true);
  });

  it("detects terraform directory", () => {
    mkdirSync(join(dir, "terraform"));
    const result = detectDeploymentNeed(dir);
    expect(result.needed).toBe(true);
    expect(result.signals.some((s) => s.includes("terraform"))).toBe(true);
  });

  it("detects .tf files", () => {
    writeFileSync(join(dir, "main.tf"), 'provider "aws" {}');
    const result = detectDeploymentNeed(dir);
    expect(result.needed).toBe(true);
    expect(result.signals.some((s) => s.includes("main.tf"))).toBe(true);
  });

  it("detects architecture doc deployment section", () => {
    const archDoc = "# Architecture\n\n## Deployment\n\nDeploy to Vercel.";
    const result = detectDeploymentNeed(dir, archDoc);
    expect(result.needed).toBe(true);
    expect(result.signals.some((s) => s.includes("deployment"))).toBe(true);
  });

  it("detects architecture doc infrastructure section", () => {
    const archDoc = "# Arch\n\n## Infrastructure\n\nUses AWS.";
    const result = detectDeploymentNeed(dir, archDoc);
    expect(result.needed).toBe(true);
  });

  it("detects cloud SDK in package.json", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@vercel/analytics": "^1.0" } }),
    );
    const result = detectDeploymentNeed(dir);
    expect(result.needed).toBe(true);
    expect(result.signals.some((s) => s.includes("@vercel"))).toBe(true);
  });

  it("returns not needed when no signals present", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app" }));
    const result = detectDeploymentNeed(dir);
    expect(result.needed).toBe(false);
    expect(result.signals).toHaveLength(0);
  });

  it("detects multiple signals", () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node:22");
    writeFileSync(join(dir, "docker-compose.yml"), "version: '3'");
    const result = detectDeploymentNeed(dir);
    expect(result.needed).toBe(true);
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
  });
});

describe("checkOperationalReadiness", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ship-readiness-"));
    mkdirSync(join(dir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports ready when no gaps found", () => {
    writeFileSync(join(dir, "src", "app.ts"), "console.log('hello')");
    writeFileSync(join(dir, ".env.example"), "# no env vars");
    const result = checkOperationalReadiness(dir);
    expect(result.ready).toBe(true);
    expect(result.gaps.fixableByShip).toHaveLength(0);
    expect(result.gaps.needsImpl).toHaveLength(0);
  });

  it("flags missing .env.example when process.env is used", () => {
    writeFileSync(join(dir, "src", "config.ts"), 'const key = process.env.API_KEY;');
    const result = checkOperationalReadiness(dir, {
      sourceFiles: ["src/config.ts"],
    });
    expect(result.ready).toBe(false);
    expect(result.gaps.fixableByShip.length).toBeGreaterThan(0);
    expect(result.gaps.fixableByShip[0]).toContain(".env.example");
  });

  it("does not flag .env.example when it exists", () => {
    writeFileSync(join(dir, "src", "config.ts"), 'const key = process.env.API_KEY;');
    writeFileSync(join(dir, ".env.example"), "API_KEY=");
    const result = checkOperationalReadiness(dir, {
      sourceFiles: ["src/config.ts"],
    });
    expect(result.gaps.fixableByShip).toHaveLength(0);
  });

  it("flags hardcoded secrets as needing impl", () => {
    writeFileSync(
      join(dir, "src", "api.ts"),
      'const api_key = "FAKE_TEST_SECRET_value_1234567890abcdef";\n',
    );
    const result = checkOperationalReadiness(dir, {
      sourceFiles: ["src/api.ts"],
    });
    expect(result.gaps.needsImpl.length).toBeGreaterThan(0);
    expect(result.gaps.needsImpl[0]).toContain("secret");
  });

  it("flags missing health check when deployment config exists", () => {
    writeFileSync(join(dir, "src", "app.ts"), 'app.get("/", handler);');
    const result = checkOperationalReadiness(dir, {
      hasDeploymentConfig: true,
      sourceFiles: ["src/app.ts"],
    });
    expect(result.gaps.needsImpl.some((g) => g.includes("health check"))).toBe(true);
  });

  it("does not flag health check when one exists", () => {
    writeFileSync(join(dir, "src", "app.ts"), 'app.get("/health", (req, res) => res.ok());');
    const result = checkOperationalReadiness(dir, {
      hasDeploymentConfig: true,
      sourceFiles: ["src/app.ts"],
    });
    expect(result.gaps.needsImpl.every((g) => !g.includes("health check"))).toBe(true);
  });

  it("splits gaps correctly between fixableByShip and needsImpl", () => {
    writeFileSync(join(dir, "src", "config.ts"), 'const key = process.env.DB_URL;');
    writeFileSync(
      join(dir, "src", "api.ts"),
      'const token = "FAKE_TEST_TOKEN_value_abcdefghijklmnopq";\n',
    );
    const result = checkOperationalReadiness(dir, {
      sourceFiles: ["src/config.ts", "src/api.ts"],
    });
    expect(result.ready).toBe(false);
    expect(result.gaps.fixableByShip.length).toBeGreaterThan(0); // .env.example
    expect(result.gaps.needsImpl.length).toBeGreaterThan(0); // hardcoded secret
  });
});
