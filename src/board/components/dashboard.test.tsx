import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HogConfig, RepoConfig } from "../../config.js";
import type { GitHubIssue, StatusOption } from "../../github.js";
import type { Task } from "../../types.js";
import { Priority } from "../../types.js";
import type { ActivityEvent, DashboardData, FetchOptions, RepoData } from "../fetch.js";

// Mock Worker: simulates the fetch-worker.ts behavior (useData spawns a worker thread)
const mockFetchDashboard = vi.fn();

vi.mock("node:worker_threads", () => ({
  Worker: class MockWorker {
    private handlers = new Map<string, (...args: unknown[]) => void>();

    constructor(_url: URL | string, opts: { workerData: { config: unknown; options: unknown } }) {
      setTimeout(async () => {
        try {
          const data = await mockFetchDashboard(opts.workerData.config, opts.workerData.options);
          this.handlers.get("message")?.({ type: "success", data });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.handlers.get("message")?.({ type: "error", error: message });
        }
      }, 0);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    terminate() {}
  },
}));

// Mock pickIssue
vi.mock("../../pick.js", () => ({
  pickIssue: vi.fn(),
}));

// Must import Dashboard AFTER mocks are set up
import { Dashboard } from "./dashboard.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeConfig(): HogConfig {
  return {
    version: 3,
    repos: [
      {
        name: "owner/repo",
        shortName: "repo",
        projectNumber: 1,
        statusFieldId: "SF_1",
        completionAction: { type: "closeIssue" as const },
      },
    ],
    board: { refreshInterval: 9999, backlogLimit: 20, assignee: "ondrej", focusDuration: 1500 },
    ticktick: { enabled: true },
    profiles: {},
  };
}

function makeOptions(): FetchOptions {
  return {};
}

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: "Test issue",
    url: "https://github.com/owner/repo/issues/1",
    state: "OPEN",
    updatedAt: "2026-02-15T12:00:00Z",
    labels: [],
    assignees: [],
    ...overrides,
  };
}

function makeRepoConfig(): RepoConfig {
  return {
    name: "owner/repo",
    shortName: "repo",
    projectNumber: 1,
    statusFieldId: "SF_1",
    completionAction: { type: "closeIssue" as const },
  };
}

function makeRepoData(overrides: Partial<RepoData> = {}): RepoData {
  return {
    repo: makeRepoConfig(),
    issues: [makeIssue()],
    statusOptions: [
      { id: "opt_1", name: "In Progress" },
      { id: "opt_2", name: "Backlog" },
    ],
    error: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Test task",
    content: "",
    desc: "",
    isAllDay: false,
    startDate: "",
    dueDate: "",
    completedTime: "",
    priority: Priority.None,
    reminders: [],
    repeatFlag: "",
    sortOrder: 0,
    status: 0,
    timeZone: "UTC",
    tags: [],
    items: [],
    ...overrides,
  };
}

function makeActivityEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    type: "comment",
    repoShortName: "repo",
    issueNumber: 1,
    actor: "testuser",
    summary: "commented on #1",
    timestamp: new Date("2026-02-15T11:30:00Z"),
    ...overrides,
  };
}

function makeDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    repos: [makeRepoData()],
    ticktick: [],
    ticktickError: null,
    activity: [],
    fetchedAt: new Date("2026-02-15T12:00:00Z"),
    ...overrides,
  };
}

describe("Dashboard integration", () => {
  afterEach(() => {
    mockFetchDashboard.mockReset();
  });

  it("should render without infinite loop (the critical regression test)", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData());

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    // Wait for fetch to resolve and component to settle
    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("HOG BOARD");
    expect(frame).toContain("repo");

    // fetchDashboard should have been called exactly once (no render loop re-fetch)
    expect(mockFetchDashboard).toHaveBeenCalledTimes(1);

    instance.unmount();
  });

  it("should render loading state without infinite loop", async () => {
    // Never resolve — stay loading
    mockFetchDashboard.mockReturnValue(new Promise(() => {}));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(100);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("Loading");

    instance.unmount();
  });

  it("should render with empty data (no repos, no tasks)", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos: [], ticktick: [] }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("HOG BOARD");
    expect(mockFetchDashboard).toHaveBeenCalledTimes(1);

    instance.unmount();
  });

  it("should render issues with correct count in collapsed section header", async () => {
    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "In progress issue", projectStatus: "In Progress" }),
      makeIssue({ number: 2, title: "Backlog issue", projectStatus: "Backlog" }),
      makeIssue({ number: 3, title: "No status issue" }),
    ];

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos: [makeRepoData({ issues })] }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    // Sections start collapsed — header shows count
    expect(frame).toContain("repo");
    expect(frame).toContain("3 issues");

    instance.unmount();
  });

  it("should filter terminal statuses from issue count", async () => {
    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "Active issue", projectStatus: "In Progress" }),
      makeIssue({ number: 2, title: "Done issue", projectStatus: "Done" }),
    ];
    const statusOptions: StatusOption[] = [
      { id: "opt_1", name: "In Progress" },
      { id: "opt_2", name: "Done" },
      { id: "opt_3", name: "Backlog" },
    ];

    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({ repos: [makeRepoData({ issues, statusOptions })] }),
    );

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    // Only non-terminal issues counted in header
    // "Done issue" filtered out, so only 1 issue visible
    expect(frame).toContain("repo");
    expect(frame).not.toContain("Done issue");

    instance.unmount();
  });

  it("should show TickTick section header when tasks exist", async () => {
    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({ ticktick: [makeTask({ id: "t1", title: "Buy groceries" })] }),
    );

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    // TickTick section header visible (collapsed)
    expect(frame).toContain("TickTick");
    expect(frame).toContain("1 task");

    instance.unmount();
  });

  it("should handle fetch error without crashing", async () => {
    mockFetchDashboard.mockRejectedValue(new Error("API timeout"));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("Error");
    expect(frame).toContain("API timeout");

    instance.unmount();
  });

  it("should not crash with issue body data", async () => {
    const issues: GitHubIssue[] = [
      makeIssue({
        number: 1,
        title: "Issue with body",
        body: "This is the description of the issue.",
        projectStatus: "In Progress",
      }),
    ];

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos: [makeRepoData({ issues })] }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("HOG BOARD");
    // Section is collapsed so title not visible, but should not crash
    expect(frame).toContain("repo");

    instance.unmount();
  });

  it("should not crash with Slack URL data", async () => {
    const issues: GitHubIssue[] = [
      makeIssue({
        number: 1,
        title: "Issue with Slack link",
        body: "See thread: https://team.slack.com/archives/C01234567/p1234567890",
        slackThreadUrl: "https://team.slack.com/archives/C01234567/p1234567890",
        projectStatus: "In Progress",
      }),
    ];

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos: [makeRepoData({ issues })] }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    // Section is collapsed so title not visible, but should not crash
    expect(frame).toContain("HOG BOARD");
    expect(frame).toContain("repo");

    instance.unmount();
  });

  it("should not call fetchDashboard more than once on mount (no render loop)", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData());

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    // Wait long enough for any potential re-fetch loops to show
    await delay(500);

    // Critical assertion: only 1 call means no render-loop-triggered refetches
    expect(mockFetchDashboard).toHaveBeenCalledTimes(1);

    instance.unmount();
  });

  it("should show Activity section header when activity events exist", async () => {
    const activity: ActivityEvent[] = [
      makeActivityEvent({ actor: "alice", summary: "commented on #1" }),
      makeActivityEvent({ actor: "bob", summary: "opened #2", type: "opened" }),
      makeActivityEvent({ actor: "charlie", summary: "closed #3", type: "closed" }),
    ];

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ activity }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("Recent Activity");
    expect(frame).toContain("3 events");

    instance.unmount();
  });

  it("should not show Activity section when no events", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData({ activity: [] }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).not.toContain("Recent Activity");

    instance.unmount();
  });

  it("should show focus hint in status bar", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData());

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("f:focus");

    instance.unmount();
  });

  it("should handle multiple repos with different status options", async () => {
    const repo1Issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "Repo1 issue", projectStatus: "In Progress" }),
    ];
    const repo2Config: RepoConfig = {
      name: "owner/repo2",
      shortName: "repo2",
      projectNumber: 2,
      statusFieldId: "SF_2",
      completionAction: { type: "closeIssue" as const },
    };
    const repo2Issues: GitHubIssue[] = [
      makeIssue({ number: 10, title: "Repo2 issue", projectStatus: "Planning" }),
    ];
    const repo2StatusOptions: StatusOption[] = [
      { id: "opt_a", name: "Planning" },
      { id: "opt_b", name: "In Progress" },
    ];

    const repos: RepoData[] = [
      makeRepoData({ issues: repo1Issues }),
      { repo: repo2Config, issues: repo2Issues, statusOptions: repo2StatusOptions, error: null },
    ];

    const config: HogConfig = {
      ...makeConfig(),
      repos: [makeRepoConfig(), repo2Config],
    };

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos }));

    const instance = render(React.createElement(Dashboard, { config, options: makeOptions() }));

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("repo");
    expect(frame).toContain("repo2");
    // Both sections have collapsed issue counts
    expect(frame).toContain("1 issue");

    instance.unmount();
  });

  it("should handle repo-level error gracefully", async () => {
    const repos: RepoData[] = [makeRepoData({ issues: [], error: "Permission denied" })];

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("repo");
    // The section is collapsed by default so the error is not visible,
    // but it should not crash
    expect(frame).toContain("HOG BOARD");

    instance.unmount();
  });

  it("should handle ticktick error in data without crashing", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData({ ticktickError: "Auth expired" }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    // Should render board without crashing (ticktick error is non-fatal)
    expect(frame).toContain("HOG BOARD");

    instance.unmount();
  });

  it("should render status sub-headers as navigable with collapse indicators", async () => {
    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "Active task", projectStatus: "In Progress" }),
      makeIssue({ number: 2, title: "Waiting task", projectStatus: "Backlog" }),
    ];

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos: [makeRepoData({ issues })] }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    // Sections start expanded by default — no need to press Enter
    const frame = instance.lastFrame()!;
    // Sub-headers should show with expand indicator (▼) and count
    expect(frame).toContain("In Progress");
    expect(frame).toContain("(1)");
    expect(frame).toContain("Backlog");

    instance.unmount();
  });

  it("should collapse status sub-section and hide its issues", async () => {
    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "Active task", projectStatus: "In Progress" }),
      makeIssue({ number: 2, title: "Backlog task", projectStatus: "Backlog" }),
    ];

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos: [makeRepoData({ issues })] }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    // Sections start expanded by default — no Enter needed
    let frame = instance.lastFrame()!;
    // Both sub-sections should be visible with issues
    expect(frame).toContain("In Progress");
    expect(frame).toContain("Active task");

    // Navigate down to the sub-header "In Progress" (header is selected first)
    instance.stdin.write("j");
    await delay(50);

    // Toggle collapse on the sub-header
    instance.stdin.write("\r");
    await delay(100);

    frame = instance.lastFrame()!;
    // Sub-header still visible but issues hidden
    expect(frame).toContain("In Progress");
    expect(frame).not.toContain("Active task");
    // Backlog section still visible
    expect(frame).toContain("Backlog");

    instance.unmount();
  });

  it("should show collapsed sub-header with ▶ indicator", async () => {
    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "My issue", projectStatus: "In Progress" }),
    ];

    mockFetchDashboard.mockResolvedValue(makeDashboardData({ repos: [makeRepoData({ issues })] }));

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    // Sections start expanded by default — no Enter needed
    let frame = instance.lastFrame()!;
    // Sub-headers start expanded — should show ▼
    expect(frame).toContain("\u25BC");
    expect(frame).toContain("In Progress");
    expect(frame).toContain("My issue");

    // Navigate to sub-header and collapse it
    instance.stdin.write("j");
    await delay(50);
    instance.stdin.write("\r");
    await delay(100);

    frame = instance.lastFrame()!;
    // Should show collapsed indicator ▶
    expect(frame).toContain("\u25B6");
    expect(frame).not.toContain("My issue");

    instance.unmount();
  });

  it("should use configured statusGroups to merge statuses under one header", async () => {
    const repo = makeRepoConfig();
    // Configure status groups: merge "Todo" and "Backlog" under one "Todo" header
    (repo as Record<string, unknown>)["statusGroups"] = ["In Progress", "Todo,Backlog"];

    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "Active task", projectStatus: "In Progress" }),
      makeIssue({ number: 2, title: "Backlog task", projectStatus: "Backlog" }),
      makeIssue({ number: 3, title: "Todo task", projectStatus: "Todo" }),
    ];

    const statusOptions: StatusOption[] = [
      { id: "opt_1", name: "In Progress" },
      { id: "opt_2", name: "Todo" },
      { id: "opt_3", name: "Backlog" },
      { id: "opt_4", name: "Done" },
    ];

    const config: HogConfig = { ...makeConfig(), repos: [repo] };
    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({ repos: [{ repo, issues, statusOptions, error: null }] }),
    );

    const instance = render(React.createElement(Dashboard, { config, options: makeOptions() }));

    await delay(200);

    // Sections start expanded by default — no Enter needed
    const frame = instance.lastFrame()!;
    // "In Progress" header visible
    expect(frame).toContain("In Progress");
    // "Todo" used as merged header label (first status in "Todo,Backlog" group)
    expect(frame).toContain("Todo");
    // Both tasks from merged group should be visible under "Todo"
    expect(frame).toContain("Backlog task");
    expect(frame).toContain("Todo task");
    // "Done" is terminal and should not appear as a header
    expect(frame).not.toContain("Done");

    instance.unmount();
  });

  it("should auto-detect status groups when no statusGroups configured", async () => {
    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "Planning task", projectStatus: "Planning" }),
      makeIssue({ number: 2, title: "Active task", projectStatus: "In Progress" }),
      makeIssue({ number: 3, title: "Backlog task", projectStatus: "Backlog" }),
    ];

    const statusOptions: StatusOption[] = [
      { id: "opt_1", name: "Planning" },
      { id: "opt_2", name: "In Progress" },
      { id: "opt_3", name: "Done" },
    ];

    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({ repos: [makeRepoData({ issues, statusOptions })] }),
    );

    const instance = render(
      React.createElement(Dashboard, { config: makeConfig(), options: makeOptions() }),
    );

    await delay(200);

    // Sections start expanded by default — no Enter needed
    const frame = instance.lastFrame()!;
    // Auto-detected non-terminal statuses should appear as separate headers
    expect(frame).toContain("Planning");
    expect(frame).toContain("In Progress");
    // Backlog auto-appended and has an issue, so should appear
    expect(frame).toContain("Backlog");
    // Terminal status should not appear as a header
    expect(frame).not.toContain("Done");

    instance.unmount();
  });

  it("should show merged issue count in status group header", async () => {
    const repo = makeRepoConfig();
    (repo as Record<string, unknown>)["statusGroups"] = ["Todo,Backlog"];

    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, title: "First", projectStatus: "Todo" }),
      makeIssue({ number: 2, title: "Second", projectStatus: "Backlog" }),
      makeIssue({ number: 3, title: "Third", projectStatus: "Todo" }),
    ];

    const statusOptions: StatusOption[] = [
      { id: "opt_1", name: "Todo" },
      { id: "opt_2", name: "Backlog" },
    ];

    const config: HogConfig = { ...makeConfig(), repos: [repo] };
    mockFetchDashboard.mockResolvedValue(
      makeDashboardData({ repos: [{ repo, issues, statusOptions, error: null }] }),
    );

    const instance = render(React.createElement(Dashboard, { config, options: makeOptions() }));

    await delay(200);

    // Sections start expanded by default — no Enter needed
    const frame = instance.lastFrame()!;
    // Merged group should show combined count (3 issues total)
    expect(frame).toContain("(3)");

    instance.unmount();
  });
});
