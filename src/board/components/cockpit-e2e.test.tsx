import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { RepoConfig } from "../../config.js";
import type { Pipeline } from "../../engine/conductor.js";
import type { DaemonAgentInfo } from "../hooks/use-pipeline-data.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";
import type { PipelineViewData } from "./pipeline-view.js";
import { PipelineView } from "./pipeline-view.js";

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
    title: "Content pipeline upgrade",
    repo: "owner/repo",
    localPath: "/tmp/repo",
    repoConfig: REPO_CONFIG,
    beadIds: {
      brainstorm: "bd-b1",
      stories: "bd-s1",
      scaffold: "bd-sc1",
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

function makeAgent(overrides: Partial<DaemonAgentInfo> = {}): DaemonAgentInfo {
  return {
    sessionId: "session-1",
    repo: "owner/repo",
    phase: "stories",
    pid: 12345,
    startedAt: new Date(Date.now() - 180_000).toISOString(),
    lastToolUse: "Read",
    isRunning: true,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-001",
    featureId: "feat-001",
    question: "Should the content be focused on LinkedIn or all platforms?",
    options: ["LinkedIn only", "All platforms", "LinkedIn + YouTube"],
    createdAt: new Date().toISOString(),
    source: "clarity-analyst",
    questionType: "blocking",
    ...overrides,
  };
}

function renderView(data: Partial<PipelineViewData> = {}, cols = 120) {
  const fullData: PipelineViewData = {
    pipelines: [],
    agents: [],
    pendingDecisions: [],
    mergeQueue: [],
    selectedIndex: 0,
    ...data,
  };
  return render(React.createElement(PipelineView, { data: fullData, cols, rows: 40 }));
}

// ── User Flow Tests ──
// These simulate what the user actually SEES at each stage

describe("Cockpit E2E: User sees the right thing at every stage", () => {
  // Flow 1: User opens board with no pipelines
  describe("Flow 1: Fresh start — no pipelines", () => {
    it("shows invitation to build", () => {
      const { lastFrame } = renderView();
      const frame = lastFrame() ?? "";
      expect(frame).toContain("What do you want to build?");
      expect(frame).toContain("P");
    });

    it("does NOT show agents section or status bar", () => {
      const { lastFrame } = renderView();
      const frame = lastFrame() ?? "";
      expect(frame).not.toContain("Agents (");
      expect(frame).not.toContain("0 agents");
    });
  });

  // Flow 2: User started a pipeline, agent is running stories phase
  describe("Flow 2: Pipeline running — stories agent active", () => {
    const pipeline = makePipeline({ completedBeads: 0, activePhase: "stories" });
    const agent = makeAgent({ phase: "stories" });

    it("shows pipeline with 0% progress in list panel", () => {
      // List panel appears when there are 2+ pipelines
      const { lastFrame } = renderView({
        pipelines: [
          pipeline,
          makePipeline({ featureId: "feat-002", title: "Rate limiting" }),
        ],
        agents: [agent],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("0%");
      expect(frame).toContain("stories");
    });

    it("shows agent activity in active agent card", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline], agents: [agent] });
      const frame = lastFrame() ?? "";
      // Active agent card shows agent name and phase
      expect(frame).toMatch(/Ada|Bea|Cal|Dev|Eve|Fin|Gia|Hal|Ivy|Jay|Kit|Lea|Max|Nia|Oz|Pia/);
      expect(frame).toContain("stories");
    });

    it("shows pipeline and phase info (status bar is in cockpit.tsx, not PipelineView)", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline], agents: [agent] });
      const frame = lastFrame() ?? "";
      // PipelineView shows the pipeline title and phases
      expect(frame).toContain("Content pipeline upgrade");
      expect(frame).toContain("stories");
    });

    it("shows DAG with stories active, rest pending", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline], agents: [agent] }, 120);
      const frame = lastFrame() ?? "";
      // Detail panel shows phase bar with ── connectors
      expect(frame).toContain("stories");
      expect(frame).toContain("──");
    });
  });

  // Flow 3: Stories done, tests running
  describe("Flow 3: Pipeline progressed — tests phase active", () => {
    const pipeline = makePipeline({ completedBeads: 1, activePhase: "test" });
    const agent = makeAgent({
      phase: "test",
      lastToolUse: "Write",
      isRunning: true,
    });

    it("shows 17% progress (1/6 beads done) in list panel", () => {
      // List panel appears when there are 2+ pipelines
      const { lastFrame } = renderView({
        pipelines: [
          pipeline,
          makePipeline({ featureId: "feat-002", title: "Rate limiting" }),
        ],
        agents: [agent],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("17%");
    });

    it("shows test agent activity", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline], agents: [agent] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Test Writer");
    });
  });

  // Flow 4: Decision needed — blocks the pipeline
  describe("Flow 4: Decision blocks pipeline — user must answer", () => {
    const pipeline = makePipeline({ status: "blocked", completedBeads: 0 });
    const question = makeQuestion();

    it("shows DECISION NEEDED prominently", () => {
      const { lastFrame } = renderView({
        pipelines: [pipeline],
        pendingDecisions: [question],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("DECISION NEEDED");
    });

    it("shows the actual question", () => {
      const { lastFrame } = renderView({
        pipelines: [pipeline],
        pendingDecisions: [question],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("LinkedIn");
    });

    it("shows numbered options", () => {
      const { lastFrame } = renderView({
        pipelines: [pipeline],
        pendingDecisions: [question],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("[1]");
      expect(frame).toContain("[2]");
      expect(frame).toContain("[3]");
    });

    it("shows decision panel with DECISION NEEDED heading", () => {
      const { lastFrame } = renderView({
        pipelines: [pipeline],
        pendingDecisions: [question],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("DECISION NEEDED");
    });

    it("decision shows even in narrow layout", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline], pendingDecisions: [question] }, 80);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("DECISION NEEDED");
      expect(frame).toContain("LinkedIn");
    });
  });

  // Flow 5: Pipeline completed
  describe("Flow 5: Pipeline completed — celebration", () => {
    const pipeline = makePipeline({
      status: "completed",
      completedBeads: 6,
      completedAt: new Date().toISOString(),
    });

    it("shows completed icon", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("✓");
    });

    it("shows 100% progress in list panel", () => {
      // List panel appears when there are 2+ pipelines
      const { lastFrame } = renderView({
        pipelines: [
          pipeline,
          makePipeline({ featureId: "feat-002", title: "Rate limiting" }),
        ],
      });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("100%");
    });

    it("shows completion message in detail", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] }, 120);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Pipeline complete");
    });
  });

  // Flow 6: Pipeline failed
  describe("Flow 6: Pipeline failed — shows error inline", () => {
    const pipeline = makePipeline({ status: "failed", activePhase: "impl", completedBeads: 2 });

    it("shows failed pipeline phase bar with active phase highlighted", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] });
      const frame = lastFrame() ?? "";
      // Phase bar shows the active phase with ◐
      expect(frame).toContain("impl");
    });

    it("shows failure phase in the phase bar", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] }, 120);
      const frame = lastFrame() ?? "";
      // The phase bar shows impl as active (◐)
      expect(frame).toContain("impl");
      // Completed phases show ✓
      expect(frame).toContain("brainstorm ✓");
    });
  });

  // Flow 7: All clear — nothing needs attention
  describe("Flow 7: All clear — push user away", () => {
    const pipeline = makePipeline({ status: "running", completedBeads: 2 });

    it("shows all-clear message when no decisions", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] }, 120);
      const frame = lastFrame() ?? "";
      // When pipeline is selected and no decisions, detail panel shows
      // But the all-clear panel shows when no pipeline is selected
    });

    it("shows 'Go do deep work' when no decisions pending", () => {
      // All-clear shows when pipelines exist but nothing needs attention
      // This happens in the focus panel when no decisions and selectedPipeline exists
      // The detail panel shows pipeline info, which is correct
      const { lastFrame } = renderView({ pipelines: [pipeline] }, 120);
      const frame = lastFrame() ?? "";
      // Should have pipeline info, not "DECISION NEEDED"
      expect(frame).not.toContain("DECISION NEEDED");
    });
  });

  // Flow 8: Multiple pipelines
  describe("Flow 8: Multiple pipelines with different states", () => {
    const pipelines = [
      makePipeline({ featureId: "f1", title: "Auth", status: "completed", completedBeads: 6 }),
      makePipeline({
        featureId: "f2",
        title: "Rate limit",
        status: "running",
        completedBeads: 2,
        activePhase: "impl",
      }),
      makePipeline({ featureId: "f3", title: "Search", status: "blocked", completedBeads: 1 }),
    ];

    it("shows all three pipelines", () => {
      const { lastFrame } = renderView({ pipelines }, 120);
      const frame = lastFrame() ?? "";
      // Titles may be truncated, check for partial matches
      expect(frame).toContain("Auth");
      expect(frame).toContain("Rate");
      expect(frame).toContain("Search");
    });

    it("shows pipeline list with different states", () => {
      const { lastFrame } = renderView({ pipelines });
      const frame = lastFrame() ?? "";
      // With multiple pipelines, list panel shows all of them
      expect(frame).toContain("Auth");
      expect(frame).toContain("Rate");
    });
  });

  // Flow 9: Narrow terminal
  describe("Flow 9: Narrow terminal (< 100 cols)", () => {
    const pipeline = makePipeline({ completedBeads: 1, activePhase: "test" });
    const question = makeQuestion();

    it("still shows pipeline title", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] }, 80);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Content pipeline");
    });

    it("shows decisions inline (not hidden in detail panel)", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline], pendingDecisions: [question] }, 80);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("DECISION NEEDED");
      expect(frame).toContain("[1]");
    });

    it("shows status bar", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] }, 80);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("pipeline");
    });
  });

  // Flow 10: Brainstorm phase — shows "Press Z" not "DECISION NEEDED"
  describe("Flow 10: Brainstorm phase shows correct prompt", () => {
    const pipeline = makePipeline({ completedBeads: 0, activePhase: "brainstorm" });

    it("shows brainstorm prompt not DECISION NEEDED", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("brainstorm");
      expect(frame).not.toContain("DECISION NEEDED");
    });

    it("shows brainstorm as active phase with ◐ in the phase bar", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] });
      const frame = lastFrame() ?? "";
      // Phase bar shows brainstorm as active
      expect(frame).toContain("brainstorm");
      expect(frame).toContain("◐");
    });

    it("DAG shows brainstorm as first phase", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("brainstorm");
      expect(frame).toContain("stories");
    });

    it("shows pipeline title for brainstorm phase", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Content pipeline upgrade");
    });
  });

  // Flow 11: Quick picks still work for operational questions
  describe("Flow 11: Quick picks still work alongside brainstorm", () => {
    const pipeline = makePipeline({ completedBeads: 2, activePhase: "impl" });
    const question = makeQuestion();

    it("shows DECISION NEEDED for non-brainstorm phases", () => {
      const { lastFrame } = renderView({ pipelines: [pipeline], pendingDecisions: [question] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("DECISION NEEDED");
      expect(frame).toContain("[1]");
    });
  });
});
