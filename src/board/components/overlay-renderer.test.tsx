import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { HogConfig } from "../../config.js";
import type { UIState } from "../hooks/use-ui-state.js";
import type { OverlayRendererProps } from "./overlay-renderer.js";
import { OverlayRenderer } from "./overlay-renderer.js";

// Mock github.js to avoid real gh CLI calls triggered by LabelPicker
vi.mock("../../github.js", () => ({
  fetchRepoLabelsAsync: vi.fn().mockResolvedValue([
    { name: "bug", color: "red" },
    { name: "feature", color: "blue" },
  ]),
}));
vi.mock("../ink-instance.js", () => ({
  getInkInstance: vi.fn(() => null),
  setInkInstance: vi.fn(),
}));
vi.mock("../../ai.js", () => ({
  extractIssueFields: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../config.js", () => ({
  getLlmAuth: () => null,
}));

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeUiState(overrides: Partial<UIState> = {}): UIState {
  return {
    mode: "normal",
    helpVisible: false,
    previousMode: "normal",
    ...overrides,
  };
}

const BASE_CONFIG: HogConfig = {
  version: 4,
  repos: [],
  board: {
    assignee: "me",
    refreshInterval: 30,
    backlogLimit: 20,
    focusDuration: 1500,
  },
  profiles: {},
};

function makeBaseProps(overrides: Partial<OverlayRendererProps> = {}): OverlayRendererProps {
  return {
    uiState: makeUiState(),
    config: BASE_CONFIG,
    repos: [],
    onFuzzySelect: vi.fn(),
    onFuzzyClose: vi.fn(),
    selectedRepoStatusOptions: [],
    currentStatus: undefined,
    onStatusSelect: vi.fn(),
    onExitOverlay: vi.fn(),
    defaultRepo: null,
    onCreateIssue: vi.fn(),
    onConfirmPick: vi.fn(),
    onCancelPick: vi.fn(),
    multiSelectCount: 0,
    multiSelectType: "github",
    onBulkAction: vi.fn(),
    focusLabel: null,
    focusKey: 0,
    onFocusExit: vi.fn(),
    onFocusEndAction: vi.fn(),
    searchQuery: "",
    onSearchChange: vi.fn(),
    onSearchSubmit: vi.fn(),
    selectedIssue: null,
    onComment: vi.fn(),
    onPauseRefresh: vi.fn(),
    onResumeRefresh: vi.fn(),
    onToggleHelp: vi.fn(),
    labelCache: {},
    onLabelConfirm: vi.fn(),
    onLabelError: vi.fn(),
    selectedRepoName: null,
    selectedRepoConfig: null,
    onToastInfo: vi.fn(),
    onToastError: vi.fn(),
    workflowPhases: [],
    onWorkflowAction: vi.fn(),
    ...overrides,
  };
}

function renderOverlay(props: OverlayRendererProps) {
  return render(React.createElement(OverlayRenderer, props));
}

describe("OverlayRenderer", () => {
  it("renders nothing visible in normal mode with no overlays", () => {
    const { lastFrame } = renderOverlay(makeBaseProps());
    // No overlay active — output should be essentially empty
    const frame = lastFrame() ?? "";
    expect(frame.trim()).toBe("");
  });

  it("renders HelpOverlay when helpVisible is true", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ helpVisible: true }),
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Keyboard Shortcuts");
  });

  it("HelpOverlay shows current mode when help is visible", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "search", helpVisible: true }),
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("mode: search");
  });

  it("renders SearchBar when mode is search", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "search" }),
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    // SearchBar renders the / vim-prefix
    expect(frame).toContain("/");
  });

  it("renders ConfirmPrompt when mode is overlay:confirmPick", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:confirmPick" }),
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Pick this issue?");
  });

  it("renders StatusPicker when mode is overlay:status and options are present", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:status" }),
      selectedRepoStatusOptions: [
        { id: "opt-1", name: "In Progress" },
        { id: "opt-2", name: "Done" },
      ],
      currentStatus: "In Progress",
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("In Progress");
  });

  it("does not render StatusPicker when mode is overlay:status but options are empty", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:status" }),
      selectedRepoStatusOptions: [],
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    // With no options the StatusPicker should not appear
    expect(frame.trim()).toBe("");
  });

  it("renders BulkActionMenu when mode is overlay:bulkAction", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:bulkAction" }),
      multiSelectCount: 2,
      multiSelectType: "github",
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("2");
  });

  it("renders LabelPicker when mode is overlay:label with selectedIssue and defaultRepo (line 180)", async () => {
    const selectedIssue = {
      number: 10,
      title: "My issue",
      url: "https://github.com/owner/repo/issues/10",
      state: "open",
      updatedAt: "2024-01-01T00:00:00Z",
      labels: [{ name: "bug" }, { name: "enhancement" }],
      assignees: [],
    };
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:label" }),
      selectedIssue,
      defaultRepo: "owner/repo",
      labelCache: {},
    });
    const { lastFrame } = renderOverlay(props);
    await delay(50);
    const frame = lastFrame() ?? "";
    // LabelPicker shows a loading state initially — confirms the component rendered
    // and the labels.map() on line 180 executed without error
    expect(frame).toBeDefined();
    // The loading spinner or label content should be present
    expect(frame.length).toBeGreaterThan(0);
  });

  it("does not render LabelPicker when selectedIssue is null", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:label" }),
      selectedIssue: null,
      defaultRepo: "owner/repo",
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame.trim()).toBe("");
  });

  it("does not render LabelPicker when defaultRepo is null", () => {
    const selectedIssue = {
      number: 5,
      title: "Some issue",
      url: "https://github.com/owner/repo/issues/5",
      state: "open",
      updatedAt: "2024-01-01T00:00:00Z",
      labels: [],
      assignees: [],
    };
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:label" }),
      selectedIssue,
      defaultRepo: null,
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame.trim()).toBe("");
  });

  it("renders FuzzyPicker when mode is overlay:fuzzyPicker", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:fuzzyPicker" }),
      repos: [],
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Find issue");
  });

  it("renders CreateIssueForm when mode is overlay:create", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:create" }),
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    // CreateIssueForm renders some content
    expect(frame.length).toBeGreaterThan(0);
  });

  it("renders FocusMode when mode is focus and focusLabel is set", async () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "focus" }),
      focusLabel: "issue #42: fix bug",
      focusKey: 1,
    });
    const { lastFrame } = renderOverlay(props);
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("issue #42");
  });

  it("renders FocusMode with explicit focusDuration config value", async () => {
    const configNoDuration: HogConfig = {
      ...BASE_CONFIG,
      board: { assignee: "me", refreshInterval: 30, backlogLimit: 20, focusDuration: 1500 },
    };
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "focus" }),
      focusLabel: "my task",
      focusKey: 1,
      config: configNoDuration,
    });
    const { lastFrame } = renderOverlay(props);
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toBeTruthy();
  });

  it("does not render FocusMode when mode is focus but focusLabel is null", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "focus" }),
      focusLabel: null,
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame.trim()).toBe("");
  });

  it("renders CommentInput when mode is overlay:comment and selectedIssue is provided", () => {
    const selectedIssue = {
      number: 7,
      title: "Test issue",
      url: "https://github.com/owner/repo/issues/7",
      state: "open" as const,
      updatedAt: "2024-01-01T00:00:00Z",
      labels: [],
      assignees: [],
    };
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:comment" }),
      selectedIssue,
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#7");
  });

  it("does not render CommentInput when mode is overlay:comment but selectedIssue is null", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:comment" }),
      selectedIssue: null,
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame.trim()).toBe("");
  });

  it("renders NlCreateOverlay when mode is overlay:createNl", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:createNl" }),
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("What do you need to do");
  });

  it("does not render EditIssueOverlay when selectedRepoName is null in editIssue mode", () => {
    const selectedIssue = {
      number: 5,
      title: "Some issue",
      url: "https://github.com/owner/repo/issues/5",
      state: "open" as const,
      updatedAt: "2024-01-01T00:00:00Z",
      labels: [],
      assignees: [],
    };
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:editIssue" }),
      selectedIssue,
      selectedRepoName: null,
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame.trim()).toBe("");
  });

  it("does not render EditIssueOverlay when selectedIssue is null in editIssue mode", () => {
    const props = makeBaseProps({
      uiState: makeUiState({ mode: "overlay:editIssue" }),
      selectedIssue: null,
      selectedRepoName: "owner/repo",
    });
    const { lastFrame } = renderOverlay(props);
    const frame = lastFrame() ?? "";
    expect(frame.trim()).toBe("");
  });
});
