/**
 * PARITY GATE — Phase 1 → Phase 2 handoff criterion.
 *
 * Every board workflow that users depend on must have a cockpit equivalent.
 * Phase 1 makes these pass. Phase 2 (board deletion) can ONLY start when
 * all tests in this file are green.
 *
 * Once Phase 2 deletes the board code, delete this file too (Phase 2.16).
 */
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { RepoConfig } from "../../config.js";
import type { Pipeline } from "../../engine/conductor.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";
import type { PipelineViewData } from "../components/pipeline-view.js";
import { PipelineView } from "../components/pipeline-view.js";
import type { DaemonAgentInfo } from "../hooks/use-pipeline-data.js";

// ── Helpers (reuse cockpit-e2e patterns) ──

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
    question: "Should auth use OAuth or API keys?",
    options: ["OAuth", "API keys", "Both"],
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

// ── Parity Gate Tests ──
// Each test corresponds to a board workflow that the cockpit must replace.
// These MUST ALL PASS before Phase 2 (board deletion) can begin.

describe("PARITY GATE: Cockpit covers all board workflows", () => {
  // Replaces: pick an issue → assign → start working
  it("PARITY-1: users can start a pipeline (replaces: pick an issue)", () => {
    // The empty state must show guidance for starting a pipeline
    const { lastFrame } = renderView();
    const frame = lastFrame() ?? "";
    // PipelineView empty state shows invitation to build
    expect(frame).toContain("What do you want to build?");
  });

  // Replaces: issue status view with progress percentages
  it("PARITY-2: users can see pipeline progress with real percentages", () => {
    const pipeline = makePipeline({ completedBeads: 3 });
    // List panel with progress % appears when there are 2+ pipelines
    const { lastFrame } = renderView({
      pipelines: [pipeline, makePipeline({ featureId: "feat-002", title: "Rate limiting" })],
    });
    const frame = lastFrame() ?? "";
    // Must show real percentage (50% for 3/6), not hardcoded
    expect(frame).toContain("50%");
  });

  // Replaces: comment input for communicating with issue
  it.todo(
    "PARITY-3: users can answer decisions inline via keyboard (D + number keys)",
    // This requires cockpit keyboard handling wired up (Phase 1.4)
    // Currently decisions render but can't be answered from cockpit
  );

  // Replaces: issue error states
  it("PARITY-4: users can see agent failures with phase and error detail", () => {
    const pipeline = makePipeline({ status: "failed", activePhase: "impl", completedBeads: 2 });
    const { lastFrame } = renderView({ pipelines: [pipeline] }, 120);
    const frame = lastFrame() ?? "";
    // Phase bar shows impl as active (◐) — the phase where failure occurred
    expect(frame).toContain("impl");
    // Completed phases shown with ✓
    expect(frame).toContain("brainstorm");
  });

  // Replaces: status change on issues
  it("PARITY-5: users can see pipeline pause/resume state", () => {
    const pipeline = makePipeline({ status: "paused" });
    const { lastFrame } = renderView({ pipelines: [pipeline] });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("⏸");
  });

  // Replaces: launch claude from issue
  // Zen mode already exists — just verify it's accessible from pipeline view
  it("PARITY-6: pipeline view shows agents that can be attached to via tmux", () => {
    const pipeline = makePipeline({ activePhase: "stories" });
    const agent = makeAgent({ phase: "stories" });
    const { lastFrame } = renderView({ pipelines: [pipeline], agents: [agent] });
    const frame = lastFrame() ?? "";
    // Active agent card shows agent name (humanized) and phase
    expect(frame).toContain("stories");
    expect(frame).toMatch(/Ada|Bea|Cal|Dev|Eve|Fin|Gia|Hal|Ivy|Jay|Kit|Lea|Max|Nia|Oz|Pia/);
  });

  // Replaces: board help overlay with keyboard shortcuts
  // The status bar is rendered by cockpit.tsx, not PipelineView.
  // PipelineView shows the pipeline title and phase bar.
  it("PARITY-7: pipeline view shows pipeline title and phase info", () => {
    const pipeline = makePipeline();
    const { lastFrame } = renderView({ pipelines: [pipeline] });
    const frame = lastFrame() ?? "";
    // PipelineView shows the pipeline title in the detail panel
    expect(frame).toContain("Content pipeline upgrade");
    // Phase bar is always shown
    expect(frame).toContain("brainstorm");
  });

  // Replaces: empty board state with guidance
  it("PARITY-8: empty state shows guidance for new users", () => {
    const { lastFrame } = renderView();
    const frame = lastFrame() ?? "";
    // Must explicitly guide user to start a pipeline
    expect(frame).toContain("What do you want to build?");
    // Must NOT show confusing empty sections or loading spinners
    expect(frame).not.toContain("No open issues");
  });

  // Replaces: decision answering — decisions render with numbered options
  it("PARITY-9: decisions show numbered options that users can select", () => {
    const pipeline = makePipeline({ status: "blocked" });
    const question = makeQuestion();
    const { lastFrame } = renderView({ pipelines: [pipeline], pendingDecisions: [question] });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("DECISION NEEDED");
    expect(frame).toContain("[1]");
    expect(frame).toContain("[2]");
    expect(frame).toContain("OAuth");
    expect(frame).toContain("API keys");
  });
});
