import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { Pipeline } from "../../engine/conductor.js";
import type { TrackedAgent } from "../../engine/agent-manager.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";
import type { PipelineViewData } from "./pipeline-view.js";
import { PipelineView } from "./pipeline-view.js";
import type { RepoConfig } from "../../config.js";

// ── Helpers ──

const REPO_CONFIG: RepoConfig = {
  name: "owner/repo",
  shortName: "repo",
  projectNumber: 1,
  statusFieldId: "sf1",
  localPath: "/tmp/repo",
  completionAction: { type: "closeIssue" as const },
};

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    featureId: "feat-001",
    title: "Add user authentication",
    repo: "owner/repo",
    localPath: "/tmp/repo",
    repoConfig: REPO_CONFIG,
    beadIds: {
      stories: "bd-s1",
      tests: "bd-t1",
      impl: "bd-i1",
      redteam: "bd-r1",
      merge: "bd-m1",
    },
    status: "running",
    completedBeads: 0,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgent(overrides: Partial<TrackedAgent> = {}): TrackedAgent {
  return {
    sessionId: "session-1",
    repo: "owner/repo",
    issueNumber: 0,
    phase: "stories",
    pid: 12345,
    startedAt: new Date(Date.now() - 180_000).toISOString(), // 3 min ago
    monitor: {
      sessionId: "session-1",
      lastToolUse: "Write",
      lastText: "Writing user stories...",
      isRunning: true,
    },
    child: {} as never,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-001",
    featureId: "feat-001",
    question: "OAuth providers or username/password?",
    options: ["OAuth", "Password", "Both"],
    createdAt: new Date().toISOString(),
    source: "clarity-analyst",
    ...overrides,
  };
}

function makeMergeEntry(overrides: Partial<MergeQueueEntry> = {}): MergeQueueEntry {
  return {
    id: "merge-001",
    featureId: "feat-001",
    branch: "hog/feat-001/impl",
    worktreePath: "/tmp/worktrees/hog-feat-001-impl",
    repoPath: "/tmp/repo",
    submittedAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}

function renderPipelineView(data: Partial<PipelineViewData> = {}) {
  const fullData: PipelineViewData = {
    pipelines: [],
    agents: [],
    pendingDecisions: [],
    mergeQueue: [],
    selectedIndex: 0,
    ...data,
  };
  return render(
    React.createElement(PipelineView, { data: fullData, cols: 160, rows: 40 }),
  );
}

// ── User Stories ──

describe("PipelineView", () => {
  // STORY-010: As a user opening the cockpit with no pipelines,
  // I see an inviting empty state that tells me how to start
  describe("STORY-010: Empty state invites creation", () => {
    it("shows 'What do you want to build?' when no pipelines exist", () => {
      const { lastFrame } = renderPipelineView();
      const frame = lastFrame() ?? "";
      expect(frame).toContain("What do you want to build?");
    });

    it("shows P key hint to start a pipeline", () => {
      const { lastFrame } = renderPipelineView();
      const frame = lastFrame() ?? "";
      expect(frame).toContain("P");
      expect(frame).toContain("pipeline");
    });

    it("shows i key hint to browse issues", () => {
      const { lastFrame } = renderPipelineView();
      const frame = lastFrame() ?? "";
      expect(frame).toContain("i");
      expect(frame).toContain("issues");
    });
  });

  // STORY-011: As a user with running pipelines,
  // I see my pipelines with progress indicators at a glance
  describe("STORY-011: Pipeline list shows progress", () => {
    it("shows pipeline title", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Add user authentication");
    });

    it("shows running status icon for active pipeline", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline({ status: "running" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("◐");
    });

    it("shows completed icon for finished pipeline", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline({ status: "completed" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("✓");
    });

    it("shows failed icon for failed pipeline", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline({ status: "failed" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("✗");
    });

    it("shows blocked icon with warning for blocked pipeline", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline({ status: "blocked" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("⚠");
    });

    it("shows progress bar", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
      });
      const frame = lastFrame() ?? "";
      // Progress bar uses █ and ░ characters
      expect(frame).toMatch(/[█░]/);
    });

    it("highlights the selected pipeline", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline(), makePipeline({ featureId: "feat-002", title: "Rate limiting" })],
        selectedIndex: 0,
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("▶");
    });

    it("renders more than one pipeline", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [
          makePipeline({ title: "Auth" }),
          makePipeline({ featureId: "feat-002", title: "Rate" }),
        ],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Auth");
      expect(frame).toContain("Rate");
    });
  });

  // STORY-012: As a user, pending decisions dominate the focus panel
  // because they are the bottleneck — the thing that needs my attention
  describe("STORY-012: Decisions are the hero", () => {
    it("shows DECISION NEEDED when a question is pending", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        pendingDecisions: [makeQuestion()],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("DECISION NEEDED");
    });

    it("shows the question text", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        pendingDecisions: [makeQuestion({ question: "Which database?" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Which database?");
    });

    it("shows numbered answer options", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        pendingDecisions: [makeQuestion({ options: ["PostgreSQL", "SQLite", "MongoDB"] })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("[1]");
      expect(frame).toContain("PostgreSQL");
      expect(frame).toContain("[2]");
      expect(frame).toContain("SQLite");
      expect(frame).toContain("[3]");
      expect(frame).toContain("MongoDB");
    });

    it("shows decision answering hint", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        pendingDecisions: [makeQuestion()],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("number to answer");
    });

    it("decision takes priority over pipeline detail", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        pendingDecisions: [makeQuestion()],
      });
      const frame = lastFrame() ?? "";
      // Decision panel should be shown, not the pipeline detail DAG
      expect(frame).toContain("DECISION NEEDED");
    });
  });

  // STORY-013: As a user with all pipelines running smoothly,
  // I see the selected pipeline's detail (DAG + agent status)
  describe("STORY-013: Pipeline detail when no decisions", () => {
    it("shows pipeline title in detail panel", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline({ title: "Rate limiting feature" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Rate limiting feature");
    });

    it("shows pipeline status", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline({ status: "running" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("running");
    });
  });

  // STORY-014: As a user, I see active agents across all pipelines
  // so I know what's happening right now
  describe("STORY-014: Agent monitoring", () => {
    it("shows agents section with count", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        agents: [makeAgent()],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Agents (1)");
    });

    it("shows agent phase", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        agents: [makeAgent({ phase: "impl" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("impl");
    });

    it("shows agent activity indicator", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        agents: [makeAgent()],
      });
      const frame = lastFrame() ?? "";
      // Agent section should show the phase and some activity text
      expect(frame).toContain("stories");
      expect(frame).toContain("Agents (1)");
    });

    it("shows running icon for active agent", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        agents: [makeAgent()],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("◐");
    });

    it("shows completed icon for finished agent", () => {
      const doneAgent = makeAgent({
        monitor: { sessionId: "s1", lastToolUse: undefined, lastText: "Done", isRunning: false },
      });
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        agents: [doneAgent],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("✓");
    });

    it("shows elapsed time", () => {
      // Agent started 3 min ago
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        agents: [makeAgent()],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("3m");
    });

    it("shows multiple agents from different pipelines", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        agents: [
          makeAgent({ sessionId: "s1", phase: "stories" }),
          makeAgent({ sessionId: "s2", phase: "impl" }),
        ],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("stories");
      expect(frame).toContain("impl");
      expect(frame).toContain("Agents (2)");
    });
  });

  // STORY-015: As a user, I see the merge queue so I know
  // what's waiting to be integrated
  describe("STORY-015: Merge queue visibility", () => {
    it("shows merge queue section when entries exist", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        mergeQueue: [makeMergeEntry()],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Merge Queue");
    });

    it("shows merge queue count", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        mergeQueue: [makeMergeEntry(), makeMergeEntry({ id: "merge-002", branch: "hog/feat-002/tests" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Merge Queue (2)");
    });

    it("shows branch info in merge queue", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        mergeQueue: [makeMergeEntry({ branch: "hog/auth" })],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("hog/auth");
    });

    it("hides merge queue when empty", () => {
      const { lastFrame } = renderPipelineView({
        pipelines: [makePipeline()],
        mergeQueue: [],
      });
      const frame = lastFrame() ?? "";
      expect(frame).not.toContain("Merge Queue");
    });
  });

  // STORY-016: As a user, the layout is responsive —
  // narrow terminals show a compact view
  describe("STORY-016: Responsive layout", () => {
    it("wide layout (>= 140) shows decision panel alongside pipeline list", () => {
      const { lastFrame } = render(
        React.createElement(PipelineView, {
          data: {
            pipelines: [makePipeline({ title: "Auth" })],
            agents: [],
            pendingDecisions: [makeQuestion()],
            mergeQueue: [],
            selectedIndex: 0,
          },
          cols: 160,
          rows: 40,
        }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Auth");
      expect(frame).toContain("DECISION");
    });

    it("narrow layout (< 140) shows list only", () => {
      const { lastFrame } = render(
        React.createElement(PipelineView, {
          data: {
            pipelines: [makePipeline()],
            agents: [],
            pendingDecisions: [],
            mergeQueue: [],
            selectedIndex: 0,
          },
          cols: 100,
          rows: 40,
        }),
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Add user authentication");
    });
  });
});
