import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ──

export interface RedVerificationResult {
  readonly passed: boolean;
  readonly failingTests: number;
  readonly passingTests: number;
  readonly detail: string;
}

export interface TraceabilityReport {
  readonly stories: string[];
  readonly coveredStories: string[];
  readonly uncoveredStories: string[];
  readonly orphanTests: string[];
  readonly complete: boolean;
}

export interface MutationResult {
  readonly score: number;
  readonly killed: number;
  readonly survived: number;
  readonly total: number;
  readonly passed: boolean;
  readonly detail: string;
}

export interface TddConfig {
  readonly enforceRedFirst: boolean;
  readonly mutationThreshold: number;
  readonly specTraceability: boolean;
  readonly testCommand?: string;
  readonly mutationCommand?: string;
}

const DEFAULT_CONFIG: TddConfig = {
  enforceRedFirst: true,
  mutationThreshold: 70,
  specTraceability: true,
};

// ── RED Verification ──

/**
 * Verify that tests are in RED state (failing) before implementation begins.
 * This is the most important TDD enforcement — it proves tests are genuine,
 * not reverse-engineered from implementation.
 */
export interface VerifyRedOptions {
  /** Specific test files to check (scoped RED). If omitted, runs full suite. */
  readonly testFiles?: string[];
  /** Override the auto-detected test command. */
  readonly testCommand?: string;
}

export async function verifyRedState(
  cwd: string,
  options?: string | VerifyRedOptions,
): Promise<RedVerificationResult> {
  // Backward compat: string arg is a testCommand
  const opts: VerifyRedOptions =
    typeof options === "string" ? { testCommand: options } : (options ?? {});

  const baseCmd = opts.testCommand ?? detectTestCommand(cwd);
  if (!baseCmd) {
    return {
      passed: false,
      failingTests: 0,
      passingTests: 0,
      detail: "No test command detected. Configure testCommand in quality settings.",
    };
  }

  // Scope to specific test files if provided (Farley: RED should check new tests only)
  const cmd = opts.testFiles?.length ? scopeTestCommand(baseCmd, opts.testFiles) : baseCmd;

  const [bin, ...args] = cmd.split(" ");
  if (!bin) {
    return { passed: false, failingTests: 0, passingTests: 0, detail: "Empty test command" };
  }

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      encoding: "utf-8",
      timeout: 120_000,
    });
    // Tests passed — this means RED state is NOT verified
    const output = stdout + stderr;
    return {
      passed: false,
      failingTests: 0,
      passingTests: countTests(output),
      detail:
        "Tests pass without implementation — they may be trivial or testing existing code. RED state NOT verified.",
    };
  } catch (err: unknown) {
    // Tests failed — RED state verified!
    const output = getErrorOutput(err);
    const failing = countFailingTests(output);
    return {
      passed: failing > 0,
      failingTests: failing,
      passingTests: 0,
      detail:
        failing > 0
          ? `RED state verified: ${failing} test(s) failing as expected.`
          : "Test command failed but couldn't parse failure count.",
    };
  }
}

/**
 * Capture a baseline of currently failing tests BEFORE implementation.
 * Returns a set of failing test names/counts for later comparison.
 */
export async function captureTestBaseline(
  cwd: string,
  testCommand?: string,
): Promise<TestBaseline> {
  const cmd = testCommand ?? detectTestCommand(cwd);
  if (!cmd) return { totalFailing: 0, failingFiles: new Set(), output: "" };

  const [bin, ...args] = cmd.split(" ");
  if (!bin) return { totalFailing: 0, failingFiles: new Set(), output: "" };

  try {
    await execFileAsync(bin, args, { cwd, encoding: "utf-8", timeout: 120_000 });
    return { totalFailing: 0, failingFiles: new Set(), output: "" };
  } catch (err: unknown) {
    const output = getErrorOutput(err);
    return {
      totalFailing: countFailingTests(output),
      failingFiles: extractFailingFiles(output),
      output,
    };
  }
}

export interface TestBaseline {
  readonly totalFailing: number;
  readonly failingFiles: Set<string>;
  readonly output: string;
}

/**
 * Verify GREEN state by comparing against a pre-impl baseline.
 *
 * Smart verification:
 * 1. If baseline exists: only NEW failures count (pre-existing failures are ignored)
 * 2. If scoped test files provided: only check those specific tests
 * 3. Falls back to full suite check if no baseline
 */
export async function verifyGreenState(
  cwd: string,
  options?: {
    testCommand?: string | undefined;
    baseline?: TestBaseline | undefined;
    scopedTestFiles?: string[] | undefined;
  },
): Promise<{ passed: boolean; detail: string }> {
  const cmd = options?.testCommand ?? detectTestCommand(cwd);
  if (!cmd) {
    return { passed: true, detail: "No test command detected — skipping GREEN verification." };
  }

  // If we have scoped test files (from the pipeline's test agent), check only those
  if (options?.scopedTestFiles?.length) {
    const scopedCmd = scopeTestCommand(cmd, options.scopedTestFiles);
    const scopedResult = await runTestCommand(cwd, scopedCmd);
    if (scopedResult.passed) {
      return {
        passed: true,
        detail: `GREEN verified: all ${scopedResult.passingTests} scoped tests pass.`,
      };
    }
    return {
      passed: false,
      detail: `GREEN failed: ${scopedResult.failingTests} scoped test(s) still failing.`,
    };
  }

  // Run full suite
  const result = await runTestCommand(cwd, cmd);

  if (result.passed) {
    return { passed: true, detail: "GREEN verified: all tests pass." };
  }

  // Compare against baseline — only NEW failures matter
  const baseline = options?.baseline;
  if (baseline) {
    const newFailures = result.failingTests - baseline.totalFailing;
    const newFailingFiles = [...result.failingFiles].filter(
      (f) => !baseline.failingFiles.has(f),
    );

    if (newFailures <= 0 && newFailingFiles.length === 0) {
      return {
        passed: true,
        detail: `GREEN verified: ${result.failingTests} pre-existing failures (unchanged from baseline of ${baseline.totalFailing}). No new failures introduced.`,
      };
    }

    return {
      passed: false,
      detail: `GREEN failed: ${newFailingFiles.length} new failing test file(s) after implementation: ${newFailingFiles.slice(0, 5).join(", ")}${newFailingFiles.length > 5 ? ` (+${newFailingFiles.length - 5} more)` : ""}`,
    };
  }

  // No baseline — report raw failures
  return {
    passed: false,
    detail: `GREEN failed: ${result.failingTests} test(s) still failing (no baseline to compare against).`,
  };
}

async function runTestCommand(
  cwd: string,
  cmd: string,
): Promise<{
  passed: boolean;
  failingTests: number;
  passingTests: number;
  failingFiles: Set<string>;
}> {
  const [bin, ...args] = cmd.split(" ");
  if (!bin) {
    return { passed: true, failingTests: 0, passingTests: 0, failingFiles: new Set() };
  }

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      encoding: "utf-8",
      timeout: 120_000,
    });
    const output = stdout + stderr;
    return {
      passed: true,
      failingTests: 0,
      passingTests: countTests(output),
      failingFiles: new Set(),
    };
  } catch (err: unknown) {
    const output = getErrorOutput(err);
    return {
      passed: false,
      failingTests: countFailingTests(output),
      passingTests: countTests(output),
      failingFiles: extractFailingFiles(output),
    };
  }
}

/** Scope a test command to specific files (runner-dependent). */
function scopeTestCommand(baseCmd: string, testFiles: string[]): string {
  const files = testFiles.join(" ");
  if (baseCmd.includes("vitest")) return `${baseCmd} ${files}`;
  if (baseCmd.includes("jest")) return `${baseCmd} --testPathPattern="${testFiles.join("|")}"`;
  if (baseCmd.includes("pytest")) return `${baseCmd} ${files}`;
  if (baseCmd.includes("cargo test")) return `${baseCmd} ${files}`;
  if (baseCmd.includes("go test")) return `${baseCmd} -run "${testFiles.join("|")}"`;
  // Fallback: append files
  return `${baseCmd} ${files}`;
}

// ── Spec Traceability ──

/**
 * Check that every user story has tests and every test traces to a story.
 * Stories are identified by STORY-XXX IDs in the stories file.
 * Tests reference story IDs via test names or comments.
 */
export async function checkTraceability(
  cwd: string,
  storiesPath: string,
  testGlob: string = "**/*.test.{ts,tsx,js,jsx}",
): Promise<TraceabilityReport> {
  // Extract story IDs from the stories file
  const stories = extractStoryIds(cwd, storiesPath);

  // Find all test files and extract story references
  const testStoryRefs = await findTestStoryReferences(cwd, testGlob);

  const coveredStories = stories.filter((s) => testStoryRefs.has(s));
  const uncoveredStories = stories.filter((s) => !testStoryRefs.has(s));

  // Orphan tests reference story IDs that don't exist
  const validStoryIds = new Set(stories);
  const orphanTests: string[] = [];
  for (const [ref, files] of testStoryRefs) {
    if (!validStoryIds.has(ref)) {
      for (const f of files) {
        orphanTests.push(`${f} references unknown ${ref}`);
      }
    }
  }

  return {
    stories,
    coveredStories,
    uncoveredStories,
    orphanTests,
    complete: uncoveredStories.length === 0 && orphanTests.length === 0,
  };
}

// ── Mutation Testing ──

/**
 * Run mutation testing on changed files to verify test quality.
 * Uses the project's mutation testing tool (auto-detected or configured).
 */
export async function runMutationTesting(
  cwd: string,
  config: TddConfig = DEFAULT_CONFIG,
): Promise<MutationResult> {
  const cmd = config.mutationCommand ?? detectMutationCommand(cwd);
  if (!cmd) {
    return {
      score: 0,
      killed: 0,
      survived: 0,
      total: 0,
      passed: false,
      detail:
        "No mutation testing tool detected. Install stryker (JS/TS), mutmut (Python), or cargo-mutants (Rust).",
    };
  }

  const [bin, ...args] = cmd.split(" ");
  if (!bin) {
    return {
      score: 0,
      killed: 0,
      survived: 0,
      total: 0,
      passed: false,
      detail: "Empty mutation command",
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      encoding: "utf-8",
      timeout: 600_000, // Mutation testing can be slow
    });
    const output = stdout + stderr;
    const result = parseMutationOutput(output);
    return {
      ...result,
      passed: result.score >= config.mutationThreshold,
      detail:
        result.score >= config.mutationThreshold
          ? `Mutation score ${result.score}% meets threshold (${config.mutationThreshold}%).`
          : `Mutation score ${result.score}% below threshold (${config.mutationThreshold}%). Tests need strengthening.`,
    };
  } catch (err: unknown) {
    const output = getErrorOutput(err);
    return {
      score: 0,
      killed: 0,
      survived: 0,
      total: 0,
      passed: false,
      detail: `Mutation testing failed: ${output.slice(0, 200)}`,
    };
  }
}

// ── Detection Helpers ──

function detectTestCommand(cwd: string): string | undefined {
  if (existsSync(join(cwd, "vitest.config.ts")) || existsSync(join(cwd, "vitest.config.js"))) {
    return "npx vitest run";
  }
  if (existsSync(join(cwd, "jest.config.ts")) || existsSync(join(cwd, "jest.config.js"))) {
    return "npx jest";
  }
  if (existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "pyproject.toml"))) {
    return "python -m pytest";
  }
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return "cargo test";
  }
  if (existsSync(join(cwd, "go.mod"))) {
    return "go test ./...";
  }
  // Fallback: check package.json for test script
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    if (pkg.scripts?.["test"]) {
      return "npm test";
    }
  } catch {
    // no package.json
  }
  return undefined;
}

function detectMutationCommand(cwd: string): string | undefined {
  if (existsSync(join(cwd, "stryker.config.mjs")) || existsSync(join(cwd, "stryker.config.js"))) {
    return "npx stryker run";
  }
  if (existsSync(join(cwd, "setup.cfg")) || existsSync(join(cwd, "pyproject.toml"))) {
    // Check if mutmut is configured
    try {
      const content = readFileSync(join(cwd, "setup.cfg"), "utf-8");
      if (content.includes("[mutmut]")) return "mutmut run";
    } catch {
      // not configured
    }
  }
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return "cargo mutants";
  }
  return undefined;
}

// ── Parse Helpers ──

const STORY_ID_RE = /STORY-\d{3,}/g;

function extractStoryIds(cwd: string, storiesPath: string): string[] {
  try {
    const content = readFileSync(join(cwd, storiesPath), "utf-8");
    const matches = content.match(STORY_ID_RE);
    return [...new Set(matches ?? [])];
  } catch {
    return [];
  }
}

async function findTestStoryReferences(
  cwd: string,
  _testGlob: string,
): Promise<Map<string, string[]>> {
  const refs = new Map<string, string[]>();

  try {
    // Use grep to find STORY-XXX references in test files
    const { stdout } = await execFileAsync(
      "grep",
      ["-r", "--include=*.test.*", "-l", "STORY-", "."],
      { cwd, encoding: "utf-8", timeout: 10_000 },
    );

    for (const file of stdout.trim().split("\n").filter(Boolean)) {
      try {
        const content = readFileSync(join(cwd, file), "utf-8");
        const matches = content.match(STORY_ID_RE);
        if (matches) {
          for (const match of matches) {
            const existing = refs.get(match) ?? [];
            existing.push(file);
            refs.set(match, existing);
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // grep found nothing or failed
  }

  return refs;
}

/** Extract failing test file paths from test runner output. */
function extractFailingFiles(output: string): Set<string> {
  const files = new Set<string>();
  // Vitest: "FAIL src/foo.test.ts" or "❯ src/foo.test.ts"
  const vitestMatches = output.matchAll(/(?:FAIL|❯)\s+(\S+\.test\.\S+)/g);
  for (const m of vitestMatches) {
    if (m[1]) files.add(m[1]);
  }
  // Jest: "FAIL ./src/foo.test.ts"
  const jestMatches = output.matchAll(/FAIL\s+(\S+\.test\.\S+)/g);
  for (const m of jestMatches) {
    if (m[1]) files.add(m[1]);
  }
  // pytest: "FAILED tests/test_foo.py"
  const pytestMatches = output.matchAll(/FAILED\s+(\S+\.py)/g);
  for (const m of pytestMatches) {
    if (m[1]) files.add(m[1]);
  }
  return files;
}

function countTests(output: string): number {
  // Vitest/Jest: "X passed"
  const vitestMatch = output.match(/(\d+)\s+passed/);
  if (vitestMatch?.[1]) return parseInt(vitestMatch[1], 10);

  // pytest: "X passed"
  const pytestMatch = output.match(/(\d+)\s+passed/);
  if (pytestMatch?.[1]) return parseInt(pytestMatch[1], 10);

  return 0;
}

function countFailingTests(output: string): number {
  // Vitest/Jest: "X failed"
  const match = output.match(/(\d+)\s+failed/);
  if (match?.[1]) return parseInt(match[1], 10);

  // pytest: "X failed"
  const pyMatch = output.match(/(\d+)\s+failed/);
  if (pyMatch?.[1]) return parseInt(pyMatch[1], 10);

  // Generic: exit code indicates failure, assume at least 1
  return 1;
}

function parseMutationOutput(output: string): {
  score: number;
  killed: number;
  survived: number;
  total: number;
} {
  // Stryker: "Mutation score: 85.71%"
  const strykerMatch = output.match(/Mutation score:\s*([\d.]+)%/);
  if (strykerMatch?.[1]) {
    const score = parseFloat(strykerMatch[1]);
    const killedMatch = output.match(/Killed:\s*(\d+)/);
    const survivedMatch = output.match(/Survived:\s*(\d+)/);
    const killed = killedMatch?.[1] ? parseInt(killedMatch[1], 10) : 0;
    const survived = survivedMatch?.[1] ? parseInt(survivedMatch[1], 10) : 0;
    return { score, killed, survived, total: killed + survived };
  }

  // mutmut: "X/Y mutants killed"
  const mutmutMatch = output.match(/(\d+)\/(\d+)\s+mutants?\s+killed/);
  if (mutmutMatch?.[1] && mutmutMatch[2]) {
    const killed = parseInt(mutmutMatch[1], 10);
    const total = parseInt(mutmutMatch[2], 10);
    return {
      score: total > 0 ? (killed / total) * 100 : 0,
      killed,
      survived: total - killed,
      total,
    };
  }

  return { score: 0, killed: 0, survived: 0, total: 0 };
}

function getErrorOutput(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return (e.stdout ?? "") + (e.stderr ?? "") + (e.message ?? "");
  }
  return String(err);
}
