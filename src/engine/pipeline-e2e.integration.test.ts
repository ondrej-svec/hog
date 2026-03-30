/**
 * PIPELINE END-TO-END INTEGRATION TEST
 *
 * Real Conductor + Real BeadsClient + Real Dolt server.
 * Mocked: AgentManager (can't run Claude), TDD enforcement (no real test suite),
 * conformance (controlled outcomes), role-context (no file writes).
 *
 * Proves: the full tick loop advances through phases via real bd ready/claim/close,
 * gates fire on real bead state, feedback loops complete through real status mutations,
 * and the correct prompts/env reach agents.
 *
 * Requires: bd CLI installed, Dolt available.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import { BeadsClient } from "./beads.js";
import { Conductor, type Pipeline } from "./conductor.js";
import { EventBus } from "./event-bus.js";

// ── Check prerequisites ──

let bdAvailable = false;
try {
  execSync("bd --version", { stdio: "pipe" });
  bdAvailable = true;
} catch {
  // bd not installed — skip
}

// ── Mocks (only what can't run in test) ──

const mockVerifyRedState = vi.fn().mockResolvedValue({
  passed: true,
  failingTests: 3,
  passingTests: 0,
  detail: "3 tests failing (mock)",
});
const mockAnalyzeTestQuality = vi.fn().mockReturnValue({
  behavioral: ["spec.test.ts"],
  stringMatching: [],
  ratio: 1,
});
const mockVerifyGreenState = vi.fn().mockResolvedValue({
  passed: true,
  detail: "All tests pass",
});

vi.mock("./tdd-enforcement.js", () => ({
  verifyRedState: (...args: unknown[]) => mockVerifyRedState(...args),
  checkTraceability: vi.fn().mockResolvedValue({
    coveredStories: ["STORY-001"],
    uncoveredStories: [],
    orphanTests: [],
  }),
  analyzeTestQuality: (...args: unknown[]) => mockAnalyzeTestQuality(...args),
  verifyGreenState: (...args: unknown[]) => mockVerifyGreenState(...args),
}));

vi.mock("./summary-parser.js", () => ({
  checkSummaryForFailure: vi.fn().mockReturnValue({ failed: false }),
}));

vi.mock("./safety-rules.js", () => ({
  writeSafetyRules: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./role-context.js", () => ({
  writeRoleClaudeMd: vi.fn(),
  buildAgentLaunchArgs: vi.fn().mockReturnValue(["-p", "test"]),
  buildTmuxSessionName: vi.fn().mockReturnValue("hog-e2e"),
}));

vi.mock("./story-splitter.js", () => ({
  findStoriesFile: vi.fn().mockReturnValue(undefined),
}));

const mockCheckConformance = vi.fn().mockResolvedValue({
  passed: true,
  missingDeps: [],
  missingFiles: [],
  stubs: [],
  detail: "Architecture conformance verified",
});

vi.mock("./conformance.js", () => ({
  checkArchitectureConformance: (...args: unknown[]) => mockCheckConformance(...args),
}));

// ── Test Setup ──

const TEST_DIR = join(tmpdir(), `hog-e2e-${Date.now()}`);

function createMockAgents(): AgentManager & { _launches: Array<Record<string, unknown>> } {
  let sessionCounter = 0;
  const launches: Array<Record<string, unknown>> = [];
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getAgents: vi.fn().mockReturnValue([]),
    get runningCount() { return 0; },
    get maxConcurrent() { return 5; },
    reconcileResults: vi.fn(),
    pollLiveness: vi.fn(),
    launchAgent: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
      sessionCounter++;
      launches.push({ ...opts, sessionId: `e2e-session-${sessionCounter}` });
      return `e2e-session-${sessionCounter}`;
    }),
    _launches: launches,
  } as unknown as AgentManager & { _launches: Array<Record<string, unknown>> };
}

async function tick(conductor: Conductor): Promise<void> {
  await (conductor as unknown as { tick(): Promise<void> }).tick();
}

async function completeAgent(eventBus: EventBus, sessionId: string, phase: string, summary?: string): Promise<void> {
  eventBus.emit("agent:completed", { sessionId, repo: "owner/repo", issueNumber: 0, phase, summary });
  // onAgentCompleted is fire-and-forget async — wait for all gates to execute
  // Real Beads operations are slower than mocks, need more time
  await new Promise((r) => setTimeout(r, 500));
}

// ── Tests ──

describe.skipIf(!bdAvailable)("Pipeline E2E with real Beads", () => {
  const beads = new BeadsClient("e2e-test");
  let agents: ReturnType<typeof createMockAgents>;
  let eventBus: EventBus;
  let conductor: Conductor;

  const config = {
    repos: [{ name: "owner/repo", shortName: "repo" }],
  } as unknown as HogConfig;

  const repoConfig = {
    name: "owner/repo",
    shortName: "repo",
    localPath: TEST_DIR,
    completionAction: { type: "closeIssue" as const },
  } as unknown as RepoConfig;

  beforeAll(async () => {
    // Set up a real git repo with bd initialized
    mkdirSync(join(TEST_DIR, "src"), { recursive: true });
    mkdirSync(join(TEST_DIR, "docs", "stories"), { recursive: true });
    execSync("git init -q && git commit --allow-empty -m init -q", { cwd: TEST_DIR });
    execSync("bd init", { cwd: TEST_DIR, stdio: "pipe" });
    await beads.ensureDoltRunning(TEST_DIR);

    // Create architecture doc for conformance gate
    writeFileSync(
      join(TEST_DIR, "docs", "stories", "test-feature.architecture.md"),
      `# Architecture

## Dependencies

| Package | Purpose |
|---------|---------|
| zod | Validation |

## File Structure

- \`src/handler.ts\` — main handler
`,
    );
  }, 60_000);

  afterAll(() => {
    try {
      execSync("bd dolt stop", { cwd: TEST_DIR, stdio: "pipe" });
    } catch { /* best-effort */ }
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("E2E-001: full pipeline lifecycle — create → advance → gates → complete", async () => {
    eventBus = new EventBus();
    agents = createMockAgents();
    conductor = new Conductor(config, eventBus, agents, beads);

    const archPath = join(TEST_DIR, "docs", "stories", "test-feature.architecture.md");

    // ── Step 1: Create pipeline ──
    const result = await conductor.startPipeline(
      "owner/repo",
      repoConfig,
      "Test Feature",
      "E2E integration test",
      undefined,
      archPath,
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.status).toBe("running");
    expect(result.beadIds["brainstorm"]).toBeDefined();
    expect(result.beadIds["merge"]).toBeDefined();

    const pipeline = result;

    // ── Step 2: Close brainstorm (simulating user session) ──
    await beads.close(TEST_DIR, pipeline.beadIds["brainstorm"]!, "Brainstorm done");

    // ── Step 3: Tick → stories agent should spawn ──
    await tick(conductor);
    expect(agents._launches.length).toBe(1);
    expect(agents._launches[0]?.["phase"]).toBe("stories");

    // ── Step 4: Complete stories → tick → scaffold spawns ──
    await completeAgent(eventBus, "e2e-session-1", "stories");
    await tick(conductor);
    expect(agents._launches.length).toBe(2);
    expect(agents._launches[1]?.["phase"]).toBe("scaffold");

    // ── Step 5: Complete scaffold → tick → test spawns ──
    await completeAgent(eventBus, "e2e-session-2", "scaffold");
    await tick(conductor);
    expect(agents._launches.length).toBe(3);
    expect(agents._launches[2]?.["phase"]).toBe("test");

    // Create actual test file and commit — captureTestContext uses git diff
    writeFileSync(join(TEST_DIR, "spec.test.ts"), `import { handle } from "./src/handler";\nexpect(handle()).toBeDefined();`);
    execSync("git add spec.test.ts && git commit -q -m 'add spec test'", { cwd: TEST_DIR });

    // ── Step 6: Complete test → spec-quality gate should pass → tick → impl spawns ──
    mockAnalyzeTestQuality.mockReturnValue({ behavioral: ["spec.test.ts"], stringMatching: [], ratio: 1 });
    await completeAgent(eventBus, "e2e-session-3", "test");
    await tick(conductor);
    expect(agents._launches.length).toBe(4);
    expect(agents._launches[3]?.["phase"]).toBe("impl");

    // Verify impl agent got HOG_PIPELINE=1 and ARCH_PATH
    const implLaunch = agents._launches[3]!;
    const implEnv = implLaunch["env"] as Record<string, string>;
    expect(implEnv?.["HOG_PIPELINE"]).toBe("1");
    expect(implEnv?.["ARCH_PATH"]).toBeDefined();

    // Verify impl prompt includes plan-then-/work instructions (fallback prompt)
    const implPrompt = implLaunch["promptTemplate"] as string;
    expect(implPrompt).toContain("impl-plan.md");

    // ── Step 7: Complete impl → conform-gate FAILS → impl should NOT advance ──
    mockCheckConformance.mockResolvedValue({
      passed: false,
      missingDeps: ["zod"],
      missingFiles: ["src/handler.ts"],
      stubs: [],
      detail: "Missing deps: zod. Missing files: src/handler.ts",
    });
    await completeAgent(eventBus, "e2e-session-4", "impl");

    // Verify: impl bead was reopened (conform gate blocked close)
    // The bead should be "open" again, not "closed"
    const implBead = await beads.show(TEST_DIR, pipeline.beadIds["impl"]!);
    expect(implBead.status).toBe("open");

    // Verify: retry feedback set with conformance report
    expect(pipeline.context?.retryFeedback?.["conform-gate"]).toBeDefined();
    expect(pipeline.context?.retryFeedback?.["conform-gate"]?.reason).toContain("zod");
    expect(pipeline.context?.retryFeedback?.["conform-gate"]?.attempt).toBe(1);

    // ── Step 8: Tick → impl should re-spawn (bead is open + deps are closed) ──
    await tick(conductor);
    expect(agents._launches.length).toBe(5);
    expect(agents._launches[4]?.["phase"]).toBe("impl");

    // Verify retry context is in the re-spawned agent's prompt
    const retryPrompt = agents._launches[4]!["promptTemplate"] as string;
    expect(retryPrompt).toContain("Retry Context");

    // ── Step 9: Complete impl again → conform-gate PASSES this time ──
    mockCheckConformance.mockResolvedValue({
      passed: true,
      missingDeps: [],
      missingFiles: [],
      stubs: [],
      detail: "Architecture conformance verified",
    });
    // Also create the missing file so the real existsSync check passes
    writeFileSync(join(TEST_DIR, "src", "handler.ts"), "import { z } from 'zod';\nexport function handle() { return z.string().parse('ok'); }");

    await completeAgent(eventBus, "e2e-session-5", "impl");

    // Verify: impl bead is now closed
    const implBeadAfter = await beads.show(TEST_DIR, pipeline.beadIds["impl"]!);
    expect(implBeadAfter.status).toBe("closed");

    // ── Step 10: Tick → redteam spawns (impl closed, redteam unblocked) ──
    await tick(conductor);
    expect(agents._launches.length).toBe(6);
    expect(agents._launches[5]?.["phase"]).toBe("redteam");

    // ── Step 11: Complete redteam → merge spawns ──
    await completeAgent(eventBus, "e2e-session-6", "redteam");
    await tick(conductor);
    expect(agents._launches.length).toBe(7);
    expect(agents._launches[6]?.["phase"]).toBe("merge");

    // ── Step 12: Complete merge → pipeline done ──
    await completeAgent(eventBus, "e2e-session-7", "merge");

    // Verify all beads are closed
    for (const [key, beadId] of Object.entries(pipeline.beadIds)) {
      if (!beadId) continue;
      const bead = await beads.show(TEST_DIR, beadId);
      expect(bead.status).toBe("closed");
    }
  }, 120_000);

  it("E2E-002: spec-quality gate rejects string-matching tests via real bead state", async () => {
    eventBus = new EventBus();
    agents = createMockAgents();
    conductor = new Conductor(config, eventBus, agents, beads);

    const result = await conductor.startPipeline("owner/repo", repoConfig, "Spec Quality Test", "E2E test");
    if ("error" in result) throw new Error(result.error);
    const pipeline = result;

    // Advance to test phase
    await beads.close(TEST_DIR, pipeline.beadIds["brainstorm"]!, "Done");
    await tick(conductor); // stories
    await completeAgent(eventBus, agents._launches[agents._launches.length - 1]!["sessionId"] as string, "stories");
    await tick(conductor); // scaffold
    await completeAgent(eventBus, agents._launches[agents._launches.length - 1]!["sessionId"] as string, "scaffold");
    await tick(conductor); // test spawns

    // Create an actual test file and commit it
    writeFileSync(join(TEST_DIR, "bad.test.ts"), `import { readFileSync } from "fs";\nconst c = readFileSync("src/handler.ts","utf-8");\nexpect(c).toMatch(/handle/);`);
    execSync("git add bad.test.ts && git commit -q -m 'add test'", { cwd: TEST_DIR });

    // Pre-populate testFiles (captureTestContext preserves existing values)
    if (!pipeline.context) (pipeline as { context: Pipeline["context"] }).context = {};
    pipeline.context!.testFiles = ["bad.test.ts"];

    // Configure: string-matching tests
    mockAnalyzeTestQuality.mockReturnValue({
      behavioral: [],
      stringMatching: ["bad.test.ts"],
      ratio: 0,
    });

    const testSession = agents._launches[agents._launches.length - 1]!["sessionId"] as string;
    await completeAgent(eventBus, testSession, "test");

    // First check: did the gate actually fire? (retryFeedback should be set)
    expect(pipeline.context?.retryFeedback?.["spec-quality"]).toBeDefined();
    expect(pipeline.context?.retryFeedback?.["spec-quality"]?.reason).toContain("string-matching");

    // Test bead status — check what bd actually reports
    const testBead = await beads.show(TEST_DIR, pipeline.beadIds["tests"]!);
    // After close+reopen, bead should be "open"
    // If "closed" — the reopen failed. If "in_progress" — neither close nor reopen worked.
    expect(["open", "closed"]).toContain(testBead.status); // diagnostic: see which state we're in
    expect(testBead.status).toBe("open");
    expect(pipeline.context?.retryFeedback?.["spec-quality"]?.reason).toContain("string-matching");

    // Tick again → test agent should re-spawn (bead is open, deps satisfied)
    const launchCountBefore = agents._launches.length;
    // Wait for bd ready to reflect the reopened state
    await new Promise((r) => setTimeout(r, 200));
    await tick(conductor);
    // If this fails, bd ready didn't return the test bead despite it being "open"
    const readyBeads = await beads.ready(TEST_DIR);
    const testBeadReady = readyBeads.some((b) => b.id === pipeline.beadIds["tests"]);
    expect(testBeadReady || agents._launches.length > launchCountBefore).toBe(true);
    expect(agents._launches.length).toBe(launchCountBefore + 1);
    expect(agents._launches[agents._launches.length - 1]?.["phase"]).toBe("test");
  }, 120_000);
});
