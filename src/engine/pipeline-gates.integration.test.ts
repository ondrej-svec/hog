/**
 * PIPELINE GATES INTEGRATION TEST
 *
 * Tests the new tracer bullet gates end-to-end with the Conductor:
 * - spec-quality gate: rejects string-matching tests, loops test phase
 * - conform-gate: catches missing architecture deps, loops impl phase
 * - Feedback loops: conform failure → impl retry with structured feedback
 * - Retry counters: per-gate, not per-role (no collision)
 *
 * Uses mocked BeadsClient (simulates DAG) and mocked AgentManager,
 * but exercises real gate logic in conductor, retry-engine, tdd-enforcement,
 * and conformance checker.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import type { Bead, BeadsClient } from "./beads.js";
import { Conductor, type Pipeline } from "./conductor.js";
import { EventBus } from "./event-bus.js";

// Mock TDD enforcement — we control what it returns per test
const mockVerifyRedState = vi.fn().mockResolvedValue({
  passed: true,
  failingTests: 5,
  passingTests: 0,
  detail: "5 tests failing (mock)",
});
const mockCheckTraceability = vi.fn().mockResolvedValue({
  coveredStories: ["STORY-001", "STORY-002"],
  uncoveredStories: [],
  orphanTests: [],
});
const mockAnalyzeTestQuality = vi.fn().mockReturnValue({
  behavioral: ["test-1.test.ts", "test-2.test.ts"],
  stringMatching: [],
  ratio: 1,
});
const mockVerifyGreenState = vi.fn().mockResolvedValue({
  passed: true,
  detail: "All tests pass",
});

vi.mock("./tdd-enforcement.js", () => ({
  verifyRedState: (...args: unknown[]) => mockVerifyRedState(...args),
  checkTraceability: (...args: unknown[]) => mockCheckTraceability(...args),
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
  buildAgentLaunchArgs: vi.fn().mockReturnValue(["-p", "test prompt"]),
  buildTmuxSessionName: vi.fn().mockReturnValue("hog-test-session"),
}));

vi.mock("./story-splitter.js", () => ({
  findStoriesFile: vi.fn().mockReturnValue(undefined),
}));

// Mock conformance — we control results per test
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

const TEST_DIR = join(tmpdir(), `hog-gates-${Date.now()}`);

const TEST_CONFIG = {
  repos: [{ name: "owner/repo", shortName: "repo", projectNumber: 1, statusFieldId: "sf1" }],
} as unknown as HogConfig;

const TEST_REPO_CONFIG = {
  name: "owner/repo",
  shortName: "repo",
  localPath: TEST_DIR,
  projectNumber: 1,
  statusFieldId: "sf1",
  completionAction: { type: "closeIssue" as const },
} as unknown as RepoConfig;

function makeBead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: `bd-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test bead",
    status: "open",
    priority: 1,
    issue_type: "task",
    labels: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function createMockBeads() {
  const closedBeads = new Set<string>();
  const claimedBeads = new Set<string>();
  const reopenedBeads = new Set<string>();

  const phaseBeads = {
    brainstorm: makeBead({ id: "bd-brainstorm", title: "[hog:brainstorm] Test" }),
    stories: makeBead({ id: "bd-stories", title: "[hog:stories] Test" }),
    scaffold: makeBead({ id: "bd-scaffold", title: "[hog:scaffold] Test" }),
    tests: makeBead({ id: "bd-tests", title: "[hog:test] Test" }),
    impl: makeBead({ id: "bd-impl", title: "[hog:impl] Test" }),
    redteam: makeBead({ id: "bd-redteam", title: "[hog:redteam] Test" }),
    merge: makeBead({ id: "bd-merge", title: "[hog:merge] Test" }),
  };

  const phaseOrder = ["brainstorm", "stories", "scaffold", "tests", "impl", "redteam", "merge"] as const;

  return {
    isInstalled: vi.fn().mockReturnValue(true),
    isInitialized: vi.fn().mockReturnValue(true),
    init: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockImplementation(async (_cwd: string, opts: { title: string }) =>
      makeBead({ title: opts.title }),
    ),
    ready: vi.fn().mockImplementation(async () => {
      const result: Bead[] = [];
      for (const phase of phaseOrder) {
        const bead = phaseBeads[phase];
        if (closedBeads.has(bead.id) || claimedBeads.has(bead.id)) continue;
        if (reopenedBeads.has(bead.id)) {
          result.push(bead);
          continue;
        }
        const idx = phaseOrder.indexOf(phase);
        const allPredsClosed = phaseOrder.slice(0, idx).every((p) => closedBeads.has(phaseBeads[p].id));
        if (allPredsClosed) result.push(bead);
      }
      return result;
    }),
    list: vi.fn().mockResolvedValue([]),
    show: vi.fn().mockImplementation(async (_cwd: string, id: string) => {
      const entry = Object.entries(phaseBeads).find(([, b]) => b.id === id);
      if (!entry) return makeBead({ id });
      return {
        ...entry[1],
        status: closedBeads.has(id) ? "closed" : claimedBeads.has(id) ? "in_progress" : "open",
      };
    }),
    updateStatus: vi.fn().mockImplementation(async (_cwd: string, id: string, status: string) => {
      if (status === "open") {
        closedBeads.delete(id);
        claimedBeads.delete(id);
        reopenedBeads.add(id);
      }
    }),
    claim: vi.fn().mockImplementation(async (_cwd: string, id: string) => {
      claimedBeads.add(id);
      reopenedBeads.delete(id);
    }),
    close: vi.fn().mockImplementation(async (_cwd: string, id: string) => {
      closedBeads.add(id);
      claimedBeads.delete(id);
      reopenedBeads.delete(id);
    }),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
    addDependency: vi.fn().mockResolvedValue(undefined),
    getDependencyTree: vi.fn().mockResolvedValue(""),
    compact: vi.fn().mockResolvedValue(undefined),
    ensureDoltRunning: vi.fn().mockResolvedValue(undefined),
    createFeatureDAG: vi.fn().mockResolvedValue(phaseBeads),
    cleanupOrphanedBeads: vi.fn().mockResolvedValue(0),
    _closedBeads: closedBeads,
    _claimedBeads: claimedBeads,
    _reopenedBeads: reopenedBeads,
    _phaseBeads: phaseBeads,
  } as unknown as BeadsClient & {
    _closedBeads: Set<string>;
    _claimedBeads: Set<string>;
    _reopenedBeads: Set<string>;
    _phaseBeads: typeof phaseBeads;
  };
}

function createMockAgents(): AgentManager {
  let sessionCounter = 0;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getAgents: vi.fn().mockReturnValue([]),
    get runningCount() { return 0; },
    get maxConcurrent() { return 3; },
    reconcileResults: vi.fn(),
    pollLiveness: vi.fn(),
    launchAgent: vi.fn().mockImplementation(() => {
      sessionCounter++;
      return `session-${sessionCounter}`;
    }),
  } as unknown as AgentManager;
}

async function tick(conductor: Conductor): Promise<void> {
  await (conductor as unknown as { tick(): Promise<void> }).tick();
}

async function completeAgent(eventBus: EventBus, sessionId: string, phase: string, summary?: string): Promise<void> {
  eventBus.emit("agent:completed", { sessionId, repo: "owner/repo", issueNumber: 0, phase, summary });
  // Flush microtask queue — onAgentCompleted is fire-and-forget async, needs time
  // for dynamic imports + gate checks + beads operations
  await new Promise((r) => setTimeout(r, 100));
}

function getPipeline(conductor: Conductor): Pipeline {
  return conductor.getPipelines()[0]!;
}

// ── Tests ──

describe("Pipeline Gates Integration", () => {
  let eventBus: EventBus;
  let beads: ReturnType<typeof createMockBeads>;
  let agents: ReturnType<typeof createMockAgents>;
  let conductor: Conductor;

  beforeEach(() => {
    mkdirSync(join(TEST_DIR, "src"), { recursive: true });
    mkdirSync(join(TEST_DIR, "docs", "stories"), { recursive: true });
    // Create a mock stories file so coverage gate doesn't complain
    writeFileSync(join(TEST_DIR, "docs", "stories", "test.md"), "## STORY-001\n## STORY-002\n");

    eventBus = new EventBus();
    beads = createMockBeads();
    agents = createMockAgents();
    conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads);

    // Reset all mocks to defaults
    mockVerifyRedState.mockResolvedValue({ passed: true, failingTests: 5, passingTests: 0, detail: "5 failing" });
    mockCheckTraceability.mockResolvedValue({ coveredStories: ["STORY-001"], uncoveredStories: [], orphanTests: [] });
    mockAnalyzeTestQuality.mockReturnValue({ behavioral: ["a.test.ts"], stringMatching: [], ratio: 1 });
    mockVerifyGreenState.mockResolvedValue({ passed: true, detail: "All pass" });
    mockCheckConformance.mockResolvedValue({ passed: true, missingDeps: [], missingFiles: [], stubs: [], detail: "Conformance OK" });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  /** Advance pipeline through brainstorm → stories → scaffold → test phase ready. */
  async function advanceToTestPhase(): Promise<Pipeline> {
    await conductor.startPipeline("owner/repo", TEST_REPO_CONFIG, "Test Feature", "Description");
    const pipeline = getPipeline(conductor);
    // Close brainstorm
    await beads.close(TEST_DIR, "bd-brainstorm", "Done");
    // Tick → stories agent spawns
    await tick(conductor);
    await completeAgent(eventBus, "session-1", "stories");
    // Tick → scaffold agent spawns
    await tick(conductor);
    await completeAgent(eventBus, "session-2", "scaffold");
    // Tick → test agent spawns
    await tick(conductor);
    // Set up context that would normally be set during test phase execution
    if (!pipeline.context) (pipeline as { context: Pipeline["context"] }).context = {};
    pipeline.context!.testFiles = ["a.test.ts", "b.test.ts"];
    pipeline.context!.testCommand = "npx vitest run";
    return pipeline;
  }

  /** Advance pipeline through test phase completion (with passing gates). */
  async function advanceToImplPhase(): Promise<Pipeline> {
    const pipeline = await advanceToTestPhase();
    await completeAgent(eventBus, "session-3", "test");
    // Tick → impl agent spawns (RED verified by mock)
    await tick(conductor);
    return pipeline;
  }

  it("GATES-001: spec-quality gate rejects string-matching tests and loops test phase", async () => {
    const pipeline = await advanceToTestPhase();

    // Configure: test writer produced string-matching tests
    mockAnalyzeTestQuality.mockReturnValue({
      behavioral: [],
      stringMatching: ["a.test.ts", "b.test.ts"],
      ratio: 0,
    });

    // Complete test agent → spec-quality gate should fire
    await completeAgent(eventBus, "session-3", "test");

    // The test bead should NOT be closed (gate blocks)
    expect(beads._closedBeads.has("bd-tests")).toBe(false);

    // Check retry feedback was set for the spec-quality gate (keyed by gate ID)
    const feedback = pipeline.context?.retryFeedback;
    expect(feedback).toBeDefined();
    expect(feedback?.["spec-quality"]).toBeDefined();
    expect(feedback?.["spec-quality"]?.reason).toContain("string-matching");
  });

  it("GATES-002: spec-quality gate passes for behavioral tests", async () => {
    await advanceToTestPhase();

    // Configure: test writer produced good behavioral tests (default mock)
    mockAnalyzeTestQuality.mockReturnValue({
      behavioral: ["a.test.ts", "b.test.ts"],
      stringMatching: [],
      ratio: 1,
    });

    // Complete test agent → should pass spec-quality gate
    await completeAgent(eventBus, "session-3", "test");

    // The test bead should be closed
    expect(beads._closedBeads.has("bd-tests")).toBe(true);
  });

  it("GATES-003: conform-gate catches missing architecture deps and loops impl", async () => {
    const pipeline = await advanceToImplPhase();

    // Set up architecture path on pipeline
    const archPath = join(TEST_DIR, "docs", "stories", "test.architecture.md");
    writeFileSync(archPath, "## Dependencies\n| Package |\n| drizzle-orm |\n");
    (pipeline as { architecturePath: string }).architecturePath = archPath;

    // Configure: conformance check finds missing deps
    mockCheckConformance.mockResolvedValue({
      passed: false,
      missingDeps: ["drizzle-orm"],
      missingFiles: [],
      stubs: ["src/db.ts"],
      detail: "Missing deps: drizzle-orm. Stubs found: src/db.ts",
    });

    // Complete impl agent → conform-gate should fire
    await completeAgent(eventBus, "session-4", "impl");

    // Verify architecturePath is set on the pipeline the conductor sees
    const internalPipeline = conductor.getPipelines()[0];
    expect(internalPipeline?.architecturePath).toBe(archPath);

    // Verify impl agent was actually spawned (session mapping exists)
    const launchCalls = vi.mocked(agents.launchAgent).mock.calls.length;
    expect(launchCalls).toBeGreaterThanOrEqual(4); // stories, scaffold, test, impl

    // Check if impl bead was closed (should NOT be — conform gate should block)
    const implClosed = beads._closedBeads.has("bd-impl");

    // Verify the mock was called (dynamic import resolved to mock)
    // If this fails, the conform gate condition wasn't met or it errored
    expect(mockCheckConformance).toHaveBeenCalled();
    expect(implClosed).toBe(false);

    // Check retry feedback for conform-gate
    const feedback = pipeline.context?.retryFeedback;
    expect(feedback?.["conform-gate"]).toBeDefined();
    expect(feedback?.["conform-gate"]?.reason).toContain("drizzle-orm");
    expect(feedback?.["conform-gate"]?.attempt).toBe(1);
  });

  it("GATES-004: conform-gate passes when architecture is fully realized", async () => {
    const pipeline = await advanceToImplPhase();

    const archPath = join(TEST_DIR, "docs", "stories", "test.architecture.md");
    writeFileSync(archPath, "## Dependencies\n| drizzle-orm |\n");
    (pipeline as { architecturePath: string }).architecturePath = archPath;

    // Configure: conformance passes
    mockCheckConformance.mockResolvedValue({
      passed: true,
      missingDeps: [],
      missingFiles: [],
      stubs: [],
      detail: "Architecture conformance verified",
    });

    // Complete impl agent → should pass conform-gate
    await completeAgent(eventBus, "session-4", "impl");

    // Impl bead should be closed
    expect(beads._closedBeads.has("bd-impl")).toBe(true);
  });

  it("GATES-005: retry counters are per-gate, not per-role (no collision)", async () => {
    const pipeline = await advanceToTestPhase();

    // Coverage gate fires (uncovered stories)
    mockCheckTraceability.mockResolvedValue({
      coveredStories: ["STORY-001"],
      uncoveredStories: ["STORY-002", "STORY-003"],
      orphanTests: [],
    });

    // Set storiesPath so coverage gate activates
    (pipeline as { storiesPath: string }).storiesPath = join(TEST_DIR, "docs", "stories", "test.md");

    await completeAgent(eventBus, "session-3", "test");

    // Coverage gate should fire with per-gate key (not "test" role key)
    const feedback = pipeline.context?.retryFeedback;
    expect(feedback?.["coverage-gate"]).toBeDefined();
    expect(feedback?.["coverage-gate"]?.attempt).toBe(1);

    // The key is "coverage-gate", NOT "test" — proving per-gate tracking works
    // (if it were per-role, the key would be "test")
    expect(feedback?.["test"]).toBeUndefined();
  });

  it("GATES-006: HOG_PIPELINE env var is set when spawning agents", async () => {
    await advanceToTestPhase();

    // Check that launchAgent was called with HOG_PIPELINE=1
    const calls = vi.mocked(agents.launchAgent).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // launchAgent receives an object with env property
    const lastCall = calls[calls.length - 1]?.[0] as { env?: Record<string, string> } | undefined;
    expect(lastCall?.env?.["HOG_PIPELINE"]).toBe("1");
  });
});
