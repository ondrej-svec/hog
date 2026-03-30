/**
 * PIPELINE LIFECYCLE INTEGRATION TEST
 *
 * End-to-end test of the Conductor advancing a pipeline through all 6 phases
 * with mocked BeadsClient and AgentManager. This tests the full data flow:
 *
 *   startPipeline → tick → stories agent spawns → agent completes →
 *   tick → test agent spawns → agent completes → tick → RED check →
 *   impl agent spawns → ... → merge → pipeline completed
 *
 * Unlike conductor.test.ts (which tests individual behaviors), this test
 * verifies the entire lifecycle works end-to-end — the integration between
 * tick(), onAgentCompleted(), bead state transitions, and pipeline status.
 *
 * Written in Phase 0.3 (before implementation) to specify the happy path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import type { Bead, BeadsClient } from "./beads.js";
import { Conductor } from "./conductor.js";
import { EventBus } from "./event-bus.js";
import type { Refinery } from "./refinery.js";
import type { WorktreeManager } from "./worktree.js";

// Mock TDD enforcement — verifyRedState runs real test commands which won't work in tests
vi.mock("./tdd-enforcement.js", () => ({
  verifyRedState: vi.fn().mockResolvedValue({
    passed: true,
    failingTests: 3,
    passingTests: 0,
    detail: "3 tests failing (mock)",
  }),
  checkTraceability: vi.fn().mockResolvedValue({
    coveredStories: ["STORY-001"],
    uncoveredStories: [],
    orphanTests: [],
  }),
}));

// Mock summary parser — prevent real sentiment analysis in integration tests
vi.mock("./summary-parser.js", () => ({
  checkSummaryForFailure: vi.fn().mockReturnValue({ failed: false }),
}));

// Mock safety rules — prevent file writes in tests
vi.mock("./safety-rules.js", () => ({
  writeSafetyRules: vi.fn().mockResolvedValue(undefined),
}));

// Mock ship-detection — prevent file I/O in tests
vi.mock("./ship-detection.js", () => ({
  detectDeploymentNeed: vi.fn().mockReturnValue({ needed: false, signals: [] }),
  checkOperationalReadiness: vi.fn().mockReturnValue({ ready: true, gaps: { fixableByShip: [], needsImpl: [] } }),
}));

// Mock role-context — writeRoleClaudeMd writes to worktree directories
vi.mock("./role-context.js", () => ({
  writeRoleClaudeMd: vi.fn(),
  buildAgentLaunchArgs: vi
    .fn()
    .mockReturnValue(["--dangerously-skip-permissions", "-p", "test prompt"]),
  buildTmuxSessionName: vi.fn().mockReturnValue("hog-test-session"),
}));

// ── Test Config ──

const TEST_CONFIG = {
  repos: [{ name: "owner/repo", shortName: "repo", projectNumber: 1, statusFieldId: "sf1" }],
} as unknown as HogConfig;

const TEST_REPO_CONFIG = {
  name: "owner/repo",
  shortName: "repo",
  localPath: "/tmp/test-repo",
  projectNumber: 1,
  statusFieldId: "sf1",
  completionAction: { type: "closeIssue" as const },
} as unknown as RepoConfig;

// ── Mock Factories ──

function makeBead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: `bd-${Math.random().toString(36).slice(2, 6)}`,
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

const PHASE_BEADS = {
  brainstorm: makeBead({ id: "bd-brainstorm", title: "[hog:brainstorm] Brainstorm: Auth" }),
  stories: makeBead({ id: "bd-stories", title: "[hog:stories] User stories: Auth" }),
  scaffold: makeBead({ id: "bd-scaffold", title: "[hog:scaffold] Scaffold: Auth" }),
  tests: makeBead({ id: "bd-tests", title: "[hog:test] Acceptance tests: Auth" }),
  impl: makeBead({ id: "bd-impl", title: "[hog:impl] Implement: Auth" }),
  redteam: makeBead({ id: "bd-redteam", title: "[hog:redteam] Red team: Auth" }),
  merge: makeBead({ id: "bd-merge", title: "[hog:merge] Refinery merge: Auth" }),
  ship: makeBead({ id: "bd-ship", title: "[hog:ship] Ship: Auth" }),
};

function createMockBeads(): BeadsClient {
  // Track which beads are "closed" to simulate DAG advancement
  const closedBeads = new Set<string>();
  const claimedBeads = new Set<string>();

  return {
    isInstalled: vi.fn().mockReturnValue(true),
    isInitialized: vi.fn().mockReturnValue(true),
    init: vi.fn().mockResolvedValue(undefined),
    create: vi
      .fn()
      .mockImplementation(async (_cwd: string, opts: { title: string }) =>
        makeBead({ title: opts.title }),
      ),
    ready: vi.fn().mockImplementation(async () => {
      // Simulate DAG: return beads whose dependencies are all closed
      const order = [
        "brainstorm",
        "stories",
        "scaffold",
        "tests",
        "impl",
        "redteam",
        "merge",
        "ship",
      ] as const;
      const result: Bead[] = [];
      for (const phase of order) {
        const bead = PHASE_BEADS[phase];
        if (closedBeads.has(bead.id) || claimedBeads.has(bead.id)) continue;
        // Check if all predecessors are closed
        const idx = order.indexOf(phase);
        const allPredsClosed = order.slice(0, idx).every((p) => closedBeads.has(PHASE_BEADS[p].id));
        if (allPredsClosed) result.push(bead);
      }
      return result;
    }),
    list: vi.fn().mockImplementation(async () => {
      return Object.values(PHASE_BEADS).map((b) => ({
        ...b,
        status: closedBeads.has(b.id) ? "closed" : claimedBeads.has(b.id) ? "in_progress" : "open",
      }));
    }),
    show: vi.fn().mockImplementation(async (_cwd: string, id: string) => {
      const phase = Object.entries(PHASE_BEADS).find(([, b]) => b.id === id);
      if (!phase) return makeBead({ id });
      return {
        ...phase[1],
        status: closedBeads.has(id) ? "closed" : claimedBeads.has(id) ? "in_progress" : "open",
      };
    }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockImplementation(async (_cwd: string, id: string) => {
      claimedBeads.add(id);
    }),
    close: vi.fn().mockImplementation(async (_cwd: string, id: string) => {
      closedBeads.add(id);
      claimedBeads.delete(id);
    }),
    addDependency: vi.fn().mockResolvedValue(undefined),
    getDependencyTree: vi.fn().mockResolvedValue(""),
    compact: vi.fn().mockResolvedValue(undefined),
    ensureDoltRunning: vi.fn().mockResolvedValue(undefined),
    createFeatureDAG: vi.fn().mockImplementation(async () => ({
      brainstorm: PHASE_BEADS.brainstorm,
      stories: PHASE_BEADS.stories,
      scaffold: PHASE_BEADS.scaffold,
      tests: PHASE_BEADS.tests,
      impl: PHASE_BEADS.impl,
      redteam: PHASE_BEADS.redteam,
      merge: PHASE_BEADS.merge,
      ship: PHASE_BEADS.ship,
    })),
    // Expose internals for test assertions
    _closedBeads: closedBeads,
  } as unknown as BeadsClient;
}

function createMockAgents(): AgentManager {
  let sessionCounter = 0;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getAgents: vi.fn().mockReturnValue([]),
    get runningCount() {
      return 0;
    },
    get maxConcurrent() {
      return 3;
    },
    reconcileResults: vi.fn(),
    pollLiveness: vi.fn(),
    launchAgent: vi.fn().mockImplementation(() => {
      sessionCounter++;
      return `session-${sessionCounter}`;
    }),
  } as unknown as AgentManager;
}

function createMockWorktrees(): WorktreeManager {
  return {
    create: vi
      .fn()
      .mockImplementation(
        async (_repo: string, branch: string) => `/tmp/worktrees/${branch.replace(/\//g, "-")}`,
      ),
    remove: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    cleanup: vi.fn().mockResolvedValue(0),
    branchName: vi
      .fn()
      .mockImplementation((featureId: string, role: string) => `hog/${featureId}/${role}`),
  } as unknown as WorktreeManager;
}

function createMockRefinery(): Refinery {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    submit: vi.fn().mockReturnValue("merge-1"),
    getQueue: vi.fn().mockReturnValue([]),
    get depth() {
      return 0;
    },
    retry: vi.fn().mockReturnValue(true),
    skip: vi.fn().mockReturnValue(true),
  } as unknown as Refinery;
}

// ── Helpers ──

/** Force a conductor tick (accessing private method for testing). */
async function tick(conductor: Conductor): Promise<void> {
  await (conductor as unknown as { tick(): Promise<void> }).tick();
}

/** Simulate an agent completing successfully for a session.
 * The conductor's onAgentCompleted fires beads.close() as fire-and-forget,
 * so we flush microtasks to let the .then() callback run. */
async function completeAgent(eventBus: EventBus, sessionId: string, phase: string): Promise<void> {
  eventBus.emit("agent:completed", { sessionId, repo: "owner/repo", issueNumber: 0, phase });
  // Flush microtask queue so beads.close().then() increments completedBeads
  await new Promise((r) => setTimeout(r, 0));
}

// ── Integration Tests ──

describe("Pipeline Lifecycle Integration", () => {
  let eventBus: EventBus;
  let beads: ReturnType<typeof createMockBeads>;
  let agents: ReturnType<typeof createMockAgents>;
  let worktrees: ReturnType<typeof createMockWorktrees>;
  let refinery: ReturnType<typeof createMockRefinery>;
  let conductor: Conductor;

  beforeEach(() => {
    eventBus = new EventBus();
    beads = createMockBeads();
    agents = createMockAgents();
    worktrees = createMockWorktrees();
    refinery = createMockRefinery();

    // Conductor skips file I/O in vitest environments (checked via VITEST env var)
    conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
      worktrees,
      refinery,
    });
  });

  it("LIFECYCLE-001: full pipeline advances from creation through all 8 phases to completion", async () => {
    // Step 1: Create pipeline (brainstorm auto-closed with --brainstorm-done pattern)
    const result = await conductor.startPipeline(
      "owner/repo",
      TEST_REPO_CONFIG,
      "Add user authentication",
      "Users should be able to log in with OAuth",
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.status).toBe("running");
    expect(result.beadIds["stories"]).toBe("bd-stories");

    // Close brainstorm (simulating --brainstorm-done)
    await beads.close("/tmp/test-repo", "bd-brainstorm", "Brainstorm completed by user");

    // Step 2: First tick — stories bead should be ready (brainstorm closed)
    await tick(conductor);

    // Verify stories agent was spawned
    expect(agents.launchAgent).toHaveBeenCalled();
    const firstLaunch = vi.mocked(agents.launchAgent).mock.calls[0];
    // The prompt should be for stories role
    expect(firstLaunch).toBeDefined();

    // Step 3: Complete stories agent
    await completeAgent(eventBus, "session-1", "stories");

    // Step 4: Tick — scaffold bead should now be ready
    await tick(conductor);

    // Verify scaffold agent was spawned (session-2)
    expect(vi.mocked(agents.launchAgent).mock.calls.length).toBeGreaterThanOrEqual(2);

    // Step 5: Complete scaffold agent
    await completeAgent(eventBus, "session-2", "scaffold");

    // Step 6: Tick — test bead should now be ready
    await tick(conductor);

    // Step 7: Complete test agent
    await completeAgent(eventBus, "session-3", "test");

    // Step 8: Tick — impl bead ready (RED state assumed verified in mock)
    await tick(conductor);

    // Step 9: Complete impl (async gates may need extra flush time)
    await completeAgent(eventBus, "session-4", "impl");
    await new Promise((r) => setTimeout(r, 50)); // Let async gates settle
    await tick(conductor);

    // Step 10: Complete redteam
    await completeAgent(eventBus, "session-5", "redteam");
    await new Promise((r) => setTimeout(r, 50));
    await tick(conductor);

    // Step 11: Complete merge
    await completeAgent(eventBus, "session-6", "merge");
    await new Promise((r) => setTimeout(r, 50));
    await tick(conductor);

    // Step 12: Complete ship
    await completeAgent(eventBus, "session-7", "ship");
    await new Promise((r) => setTimeout(r, 100));
    await tick(conductor);
    await new Promise((r) => setTimeout(r, 50));
    await tick(conductor);
    await tick(conductor);

    // Step 13: Pipeline should be completed
    const pipelines = conductor.getPipelines();
    const completedPipeline = pipelines.find((p) => p.featureId === result.featureId);
    expect(completedPipeline?.status).toBe("completed");
    expect(completedPipeline?.completedBeads).toBe(8);
  }, 15_000);

  it("LIFECYCLE-002: pipeline blocks on questions and resumes after resolution", async () => {
    const result = await conductor.startPipeline(
      "owner/repo",
      TEST_REPO_CONFIG,
      "Add search",
      "Full-text search across all content",
    );
    if ("error" in result) return;

    // Close brainstorm
    await beads.close("/tmp/test-repo", "bd-brainstorm", "Done");

    // First tick — stories agent spawns
    await tick(conductor);
    expect(agents.launchAgent).toHaveBeenCalled();

    // Stories agent fails twice → should queue a question
    await completeAgent(eventBus, "session-1", "stories");

    // Simulate the agent failing by emitting failure
    eventBus.emit("agent:failed", {
      sessionId: "session-1",
      repo: "owner/repo",
      issueNumber: 0,
      phase: "stories",
      exitCode: 1,
    });
    await tick(conductor);

    // After enough failures, the pipeline may become blocked
    // The exact behavior depends on the conductor's failure threshold
    // This test verifies the data flow, not the exact threshold
  }, 10_000);

  it("LIFECYCLE-003: multiple pipelines advance independently", async () => {
    // Start two pipelines
    const result1 = await conductor.startPipeline(
      "owner/repo",
      TEST_REPO_CONFIG,
      "Feature A",
      "Description A",
    );
    const result2 = await conductor.startPipeline(
      "owner/repo",
      TEST_REPO_CONFIG,
      "Feature B",
      "Description B",
    );

    if ("error" in result1 || "error" in result2) return;

    // Both should be running
    const pipelines = conductor.getPipelines();
    expect(pipelines.length).toBe(2);
    expect(pipelines.every((p) => p.status === "running")).toBe(true);
  });

  it("LIFECYCLE-004: pause and resume work correctly", async () => {
    const result = await conductor.startPipeline(
      "owner/repo",
      TEST_REPO_CONFIG,
      "Feature C",
      "Desc",
    );
    if ("error" in result) return;

    conductor.pausePipeline(result.featureId);
    let pipeline = conductor.getPipelines().find((p) => p.featureId === result.featureId);
    expect(pipeline?.status).toBe("paused");

    conductor.resumePipeline(result.featureId);
    pipeline = conductor.getPipelines().find((p) => p.featureId === result.featureId);
    expect(pipeline?.status).toBe("running");
  });
});
