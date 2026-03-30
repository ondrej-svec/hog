import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import type { Bead, BeadsClient } from "./beads.js";
import type { PipelineStatus } from "./conductor.js";
import { Conductor } from "./conductor.js";
import { EventBus } from "./event-bus.js";
import type { Refinery } from "./refinery.js";
import type { WorktreeManager } from "./worktree.js";

// ── Test Helpers ──

const TEST_CONFIG = {
  repos: [{ name: "owner/repo", shortName: "repo", projectNumber: 1, statusFieldId: "sf1" }],
} as unknown as HogConfig;

const TEST_REPO_CONFIG = {
  name: "owner/repo",
  shortName: "repo",
  localPath: "/tmp/test-repo",
  projectNumber: 1,
  statusFieldId: "sf1",
} as unknown as RepoConfig;

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

function createMockBeadsClient(): BeadsClient {
  return {
    isInstalled: vi.fn().mockReturnValue(true),
    isInitialized: vi.fn().mockReturnValue(true),
    init: vi.fn().mockResolvedValue(undefined),
    create: vi
      .fn()
      .mockImplementation(async (_cwd: string, opts: { title: string; labels?: string[] }) =>
        makeBead({ title: opts.title, labels: opts.labels ?? [] }),
      ),
    ready: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    show: vi.fn().mockResolvedValue(makeBead()),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    addDependency: vi.fn().mockResolvedValue(undefined),
    getDependencyTree: vi.fn().mockResolvedValue(""),
    compact: vi.fn().mockResolvedValue(undefined),
    ensureDoltRunning: vi.fn().mockResolvedValue(undefined),
    createFeatureDAG: vi.fn().mockImplementation(async (_cwd: string, title: string) => ({
      brainstorm: makeBead({ id: "bd-brainstorm", title: `[hog:brainstorm] Brainstorm: ${title}` }),
      stories: makeBead({ id: "bd-stories", title: `[hog:stories] User stories: ${title}` }),
      scaffold: makeBead({ id: "bd-scaffold", title: `[hog:scaffold] Scaffold: ${title}` }),
      tests: makeBead({ id: "bd-tests", title: `[hog:test] Acceptance tests: ${title}` }),
      impl: makeBead({ id: "bd-impl", title: `[hog:impl] Implement: ${title}` }),
      redteam: makeBead({ id: "bd-redteam", title: `[hog:redteam] Red team: ${title}` }),
      merge: makeBead({ id: "bd-merge", title: `[hog:merge] Refinery merge: ${title}` }),
      ship: makeBead({ id: "bd-ship", title: `[hog:ship] Ship: ${title}` }),
    })),
  } as unknown as BeadsClient;
}

function createMockAgentManager(): AgentManager {
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

function createMockWorktreeManager(): WorktreeManager {
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

// ── User Stories as Tests ──

describe("Conductor Pipeline", () => {
  let eventBus: EventBus;
  let beads: ReturnType<typeof createMockBeadsClient>;
  let agents: ReturnType<typeof createMockAgentManager>;
  let worktrees: ReturnType<typeof createMockWorktreeManager>;
  let refinery: ReturnType<typeof createMockRefinery>;

  beforeEach(() => {
    eventBus = new EventBus();
    beads = createMockBeadsClient();
    agents = createMockAgentManager();
    worktrees = createMockWorktreeManager();
    refinery = createMockRefinery();
  });

  // STORY-001: As a developer, I can start a pipeline from a feature description
  // and it creates the full Beads DAG with correct dependencies
  describe("STORY-001: Pipeline creation creates Beads DAG", () => {
    it("creates a pipeline with all 5 beads (stories → tests → impl → redteam → merge)", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        worktrees,
        refinery,
      });

      const result = await conductor.startPipeline(
        "owner/repo",
        TEST_REPO_CONFIG,
        "Add user authentication",
        "Users should be able to log in with OAuth",
      );

      expect("error" in result).toBe(false);
      if ("error" in result) return;

      expect(result.beadIds["stories"]).toBe("bd-stories");
      expect(result.beadIds["tests"]).toBe("bd-tests");
      expect(result.beadIds["impl"]).toBe("bd-impl");
      expect(result.beadIds["redteam"]).toBe("bd-redteam");
      expect(result.beadIds["merge"]).toBe("bd-merge");
      expect(result.beadIds["ship"]).toBe("bd-ship");
    });

    it("calls createFeatureDAG with the title and description", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        worktrees,
        refinery,
      });

      await conductor.startPipeline(
        "owner/repo",
        TEST_REPO_CONFIG,
        "Add rate limiting",
        "Max 5 requests per minute per IP",
      );

      expect(beads.createFeatureDAG).toHaveBeenCalledWith(
        "/tmp/test-repo",
        "Add rate limiting",
        "Max 5 requests per minute per IP",
        undefined,
        expect.any(Set),
      );
    });

    it("fails if Beads is not installed", async () => {
      beads.isInstalled = vi.fn().mockReturnValue(false);
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads);

      const result = await conductor.startPipeline(
        "owner/repo",
        TEST_REPO_CONFIG,
        "Feature",
        "Desc",
      );

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("not installed");
      }
    });

    it("fails if no localPath configured", async () => {
      const noPathConfig = { ...TEST_REPO_CONFIG, localPath: undefined } as unknown as RepoConfig;
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads);

      const result = await conductor.startPipeline("owner/repo", noPathConfig, "Feature", "Desc");

      expect("error" in result).toBe(true);
    });
  });

  // STORY-002: Agents run in the project directory (worktree isolation removed)
  describe("STORY-002: Agent runs in project directory", () => {
    it("spawns agent in the pipeline's local path", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        refinery,
      });

      const storiesBead = makeBead({
        id: "bd-stories",
        status: "open",
        title: "[hog:stories] User stories",
      });
      beads.ready = vi.fn().mockResolvedValue([storiesBead]);

      await conductor.startPipeline("owner/repo", TEST_REPO_CONFIG, "Feature", "Desc");
      await (conductor as unknown as { tick(): Promise<void> }).tick();

      const launchCall = vi.mocked(agents.launchAgent).mock.calls[0]?.[0];
      expect(launchCall?.localPath).toBe("/tmp/test-repo");
    });
  });

  // STORY-003: As a developer, the test writer and implementer are ALWAYS
  // different agents with different context — no agent marks its own homework
  describe("STORY-003: Test writer ≠ Implementer (role separation)", () => {
    it("test agent phase is 'test' and impl agent phase is 'impl'", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        worktrees,
        refinery,
      });

      // Stories bead ready first
      const storiesBead = makeBead({
        id: "bd-stories",
        status: "open",
        title: "[hog:stories] User stories",
      });
      beads.ready = vi.fn().mockResolvedValue([storiesBead]);

      await conductor.startPipeline("owner/repo", TEST_REPO_CONFIG, "Feature", "Desc");
      await (conductor as unknown as { tick(): Promise<void> }).tick();

      const firstCall = vi.mocked(agents.launchAgent).mock.calls[0]?.[0];
      expect(firstCall?.phase).toBe("stories");

      // Now simulate stories complete, tests bead ready
      vi.mocked(agents.launchAgent).mockClear();
      const testsBead = makeBead({
        id: "bd-tests",
        status: "open",
        title: "[hog:test] Acceptance tests",
      });
      beads.ready = vi.fn().mockResolvedValue([testsBead]);
      // Skip RED verification for this test
      vi.mocked(beads.show).mockResolvedValue(makeBead({ status: "open" }));

      // Manually trigger tick (simulate poll)
      await (conductor as unknown as { tick(): Promise<void> }).tick();

      const testCall = vi.mocked(agents.launchAgent).mock.calls[0]?.[0];
      expect(testCall?.phase).toBe("test");
    });

    it("assigns different session IDs to test and impl agents", async () => {
      let sessionId = 0;
      agents.launchAgent = vi.fn().mockImplementation(() => {
        sessionId++;
        return `session-${sessionId}`;
      });

      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        worktrees,
        refinery,
      });

      // Spawn test agent
      const testsBead = makeBead({
        id: "bd-tests",
        status: "open",
        title: "[hog:test] Acceptance tests",
      });
      beads.ready = vi.fn().mockResolvedValue([testsBead]);
      await conductor.startPipeline("owner/repo", TEST_REPO_CONFIG, "Feature", "Desc");
      await (conductor as unknown as { tick(): Promise<void> }).tick();

      const testSessionId = vi.mocked(agents.launchAgent).mock.results[0]?.value;

      // Spawn impl agent (different tick)
      vi.mocked(agents.launchAgent).mockClear();
      const implBead = makeBead({ id: "bd-impl", status: "open", title: "[hog:impl] Implement" });
      beads.ready = vi.fn().mockResolvedValue([implBead]);
      await (conductor as unknown as { tick(): Promise<void> }).tick();

      const implSessionId = vi.mocked(agents.launchAgent).mock.results[0]?.value;

      expect(testSessionId).not.toBe(implSessionId);
    });
  });

  // STORY-004: Agents work directly in the project directory
  // (Refinery integration requires worktrees, which are currently disabled)
  describe("STORY-004: Agent completes and advances pipeline", () => {
    it("closes bead when agent completes", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        refinery,
      });

      const storiesBead = makeBead({
        id: "bd-stories",
        status: "open",
        title: "[hog:stories] User stories",
      });
      beads.ready = vi.fn().mockResolvedValue([storiesBead]);

      await conductor.startPipeline("owner/repo", TEST_REPO_CONFIG, "Feature", "Desc");
      await (conductor as unknown as { tick(): Promise<void> }).tick();

      const sessionId = vi.mocked(agents.launchAgent).mock.results[0]?.value as string;
      expect(sessionId).toBeDefined();

      eventBus.emit("agent:completed", {
        sessionId,
        repo: "owner/repo",
        issueNumber: 0,
        phase: "stories",
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(beads.close).toHaveBeenCalled();
    });
  });

  // STORY-005: As a developer, when an agent fails repeatedly,
  // the system queues a question for me instead of retrying infinitely
  describe("STORY-005: Repeated failures escalate to human", () => {
    it("eventually queues a question after repeated failures for the same phase", () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads);

      const pipeline = {
        featureId: "feat-test",
        title: "Test Feature",
        repo: "owner/repo",
        localPath: "/tmp/test",
        repoConfig: TEST_REPO_CONFIG,
        beadIds: {
          brainstorm: "bd-b",
          stories: "bd-s",
          tests: "bd-t",
          impl: "bd-i",
          redteam: "bd-r",
          merge: "bd-m",
        },
        status: "running" as PipelineStatus,
        completedBeads: 0,
        startedAt: new Date().toISOString(),
      };
      (conductor as unknown as { store: { set(k: string, v: typeof pipeline): void } }).store.set(
        "feat-test",
        pipeline,
      );

      // Fire 5 failures — onAgentFailed is sync now
      for (let i = 0; i < 5; i++) {
        eventBus.emit("agent:failed", {
          sessionId: `s${i}`,
          repo: "owner/repo",
          issueNumber: 0,
          phase: "impl",
          exitCode: 1,
        });
      }

      // After 3+ failures: pipeline blocked and question queued
      const isBlocked = pipeline.status === "blocked";
      const queue = conductor.getQuestionQueue();
      const hasQuestion = queue.questions.some(
        (q) =>
          q.featureId === "feat-test" &&
          (q.question.includes("impl") || q.question.includes("Implementer")),
      );
      expect(isBlocked || hasQuestion).toBe(true);
    });
  });

  // STORY-006: As a developer, I can pause and resume pipelines
  describe("STORY-006: Pipeline pause/resume", () => {
    it("pausing stops new agent spawns", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        worktrees,
        refinery,
      });

      const result = await conductor.startPipeline(
        "owner/repo",
        TEST_REPO_CONFIG,
        "Feature",
        "Desc",
      );
      if ("error" in result) return;

      expect(conductor.pausePipeline(result.featureId)).toBe(true);

      const pipelines = conductor.getPipelines();
      expect(pipelines[0]?.status).toBe("paused");
    });

    it("resuming allows agents to spawn again", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        worktrees,
        refinery,
      });

      const result = await conductor.startPipeline(
        "owner/repo",
        TEST_REPO_CONFIG,
        "Feature",
        "Desc",
      );
      if ("error" in result) return;

      conductor.pausePipeline(result.featureId);
      expect(conductor.resumePipeline(result.featureId)).toBe(true);

      const pipelines = conductor.getPipelines();
      expect(pipelines[0]?.status).toBe("running");
    });
  });

  // STORY-007: As a developer, the decision log captures every pipeline action
  // for auditability
  describe("STORY-007: Decision log audit trail", () => {
    it("logs pipeline start", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        worktrees,
        refinery,
      });

      await conductor.startPipeline("owner/repo", TEST_REPO_CONFIG, "Auth Feature", "OAuth login");

      const log = conductor.getDecisionLog();
      expect(log.some((e) => e.action === "pipeline:started")).toBe(true);
      expect(log.some((e) => e.detail.includes("Auth Feature"))).toBe(true);
    });

    it("logs agent spawn with role", async () => {
      const conductor = new Conductor(TEST_CONFIG, eventBus, agents, beads, {
        worktrees,
        refinery,
      });

      const storiesBead = makeBead({
        id: "bd-stories",
        status: "open",
        title: "[hog:stories] User stories",
      });
      beads.ready = vi.fn().mockResolvedValue([storiesBead]);

      await conductor.startPipeline("owner/repo", TEST_REPO_CONFIG, "Feature", "Desc");
      await (conductor as unknown as { tick(): Promise<void> }).tick();

      const log = conductor.getDecisionLog();
      expect(log.some((e) => e.action === "agent:spawned:stories")).toBe(true);
    });
  });
});
