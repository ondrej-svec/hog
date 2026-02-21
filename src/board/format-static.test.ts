import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoConfig } from "../config.js";
import type { GitHubIssue } from "../github.js";
import type { Task } from "../types.js";
import { Priority, TaskStatus } from "../types.js";
import type { DashboardData, RepoData } from "./fetch.js";
import { renderBoardJson, renderStaticBoard } from "./format-static.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRepoConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    name: "owner/my-repo",
    shortName: "my-repo",
    projectNumber: 1,
    statusFieldId: "field-1",
    completionAction: { type: "closeIssue" },
    ...overrides,
  };
}

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Fix the bug",
    url: "https://github.com/owner/my-repo/issues/42",
    state: "open",
    updatedAt: "2026-01-01T00:00:00Z",
    labels: [],
    assignees: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "Write tests",
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
    status: TaskStatus.Active,
    timeZone: "UTC",
    tags: [],
    items: [],
    ...overrides,
  };
}

function makeRepoData(overrides: Partial<RepoData> = {}): RepoData {
  return {
    repo: makeRepoConfig(),
    issues: [],
    statusOptions: [],
    error: null,
    ...overrides,
  };
}

function makeDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    repos: [],
    ticktick: [],
    ticktickError: null,
    activity: [],
    fetchedAt: new Date("2026-02-19T12:00:00Z"),
    ...overrides,
  };
}

// ── renderBoardJson ───────────────────────────────────────────────────────────

// Helper to extract the nested data object from renderBoardJson with proper typing
function getBoardJsonData(result: Record<string, unknown>): Record<string, unknown> {
  return result["data"] as Record<string, unknown>;
}

describe("renderBoardJson", () => {
  it("returns an object with ok: true", () => {
    const result = renderBoardJson(makeDashboardData(), "alice");
    expect(result["ok"]).toBe(true);
  });

  it("returns a data property", () => {
    const result = renderBoardJson(makeDashboardData(), "alice");
    expect(result["data"]).toBeDefined();
  });

  it("includes repos array in data", () => {
    const data = makeDashboardData({
      repos: [makeRepoData()],
    });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    expect(Array.isArray(d["repos"])).toBe(true);
  });

  it("maps repo name and shortName correctly", () => {
    const data = makeDashboardData({
      repos: [
        makeRepoData({
          repo: makeRepoConfig({ name: "owner/cool-repo", shortName: "cool-repo" }),
        }),
      ],
    });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    expect(repos[0]?.["name"]).toBe("owner/cool-repo");
    expect(repos[0]?.["shortName"]).toBe("cool-repo");
  });

  it("propagates repo error field", () => {
    const data = makeDashboardData({
      repos: [makeRepoData({ error: "Network timeout" })],
    });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    expect(repos[0]?.["error"]).toBe("Network timeout");
  });

  it("maps issues with correct fields", () => {
    const issue = makeIssue({
      number: 7,
      title: "A title",
      url: "https://github.com/owner/repo/issues/7",
      state: "open",
      labels: [{ name: "bug" }, { name: "help wanted" }],
      assignees: [{ login: "alice" }],
      updatedAt: "2026-02-01T10:00:00Z",
    });
    const data = makeDashboardData({
      repos: [makeRepoData({ issues: [issue] })],
    });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];

    expect(issues[0]?.["number"]).toBe(7);
    expect(issues[0]?.["title"]).toBe("A title");
    expect(issues[0]?.["url"]).toBe("https://github.com/owner/repo/issues/7");
    expect(issues[0]?.["state"]).toBe("open");
    expect(issues[0]?.["labels"]).toEqual(["bug", "help wanted"]);
    expect(issues[0]?.["assignee"]).toBe("alice");
    expect(issues[0]?.["assignees"]).toEqual(["alice"]);
    expect(issues[0]?.["updatedAt"]).toBe("2026-02-01T10:00:00Z");
  });

  it("sets isMine true when issue is assigned to selfLogin", () => {
    const issue = makeIssue({ assignees: [{ login: "alice" }] });
    const data = makeDashboardData({ repos: [makeRepoData({ issues: [issue] })] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];
    expect(issues[0]?.["isMine"]).toBe(true);
  });

  it("sets isMine false when issue is not assigned to selfLogin", () => {
    const issue = makeIssue({ assignees: [{ login: "bob" }] });
    const data = makeDashboardData({ repos: [makeRepoData({ issues: [issue] })] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];
    expect(issues[0]?.["isMine"]).toBe(false);
  });

  it("sets assignee to null when no assignees", () => {
    const issue = makeIssue({ assignees: [] });
    const data = makeDashboardData({ repos: [makeRepoData({ issues: [issue] })] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];
    expect(issues[0]?.["assignee"]).toBeNull();
  });

  it("includes slackThreadUrl field — null when not set", () => {
    const issue = makeIssue();
    const data = makeDashboardData({ repos: [makeRepoData({ issues: [issue] })] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];
    expect(issues[0]?.["slackThreadUrl"]).toBeNull();
  });

  it("includes slackThreadUrl field — value when set", () => {
    const slackUrl = "https://acme.slack.com/archives/C01234567/p1234567890";
    const issue = makeIssue({ slackThreadUrl: slackUrl });
    const data = makeDashboardData({ repos: [makeRepoData({ issues: [issue] })] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];
    expect(issues[0]?.["slackThreadUrl"]).toBe(slackUrl);
  });

  it("includes projectStatus field — null when not set", () => {
    const issue = makeIssue();
    const data = makeDashboardData({ repos: [makeRepoData({ issues: [issue] })] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];
    expect(issues[0]?.["projectStatus"]).toBeNull();
  });

  it("includes projectStatus field — value when set", () => {
    const issue = makeIssue({ projectStatus: "In Progress" });
    const data = makeDashboardData({ repos: [makeRepoData({ issues: [issue] })] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];
    expect(issues[0]?.["projectStatus"]).toBe("In Progress");
  });

  it("includes targetDate field — null when not set", () => {
    const issue = makeIssue();
    const data = makeDashboardData({ repos: [makeRepoData({ issues: [issue] })] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const repos = d["repos"] as Record<string, unknown>[];
    const issues = repos[0]?.["issues"] as Record<string, unknown>[];
    expect(issues[0]?.["targetDate"]).toBeNull();
  });

  it("includes ticktick section with tasks", () => {
    const task = makeTask({ id: "t1", title: "My task", priority: Priority.High });
    const data = makeDashboardData({ ticktick: [task] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const ticktick = d["ticktick"] as Record<string, unknown>;

    expect(ticktick["error"]).toBeNull();
    const tasks = ticktick["tasks"] as Record<string, unknown>[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.["id"]).toBe("t1");
    expect(tasks[0]?.["title"]).toBe("My task");
    expect(tasks[0]?.["priority"]).toBe(Priority.High);
  });

  it("includes ticktick error when present", () => {
    const data = makeDashboardData({ ticktickError: "Auth failed" });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const ticktick = d["ticktick"] as Record<string, unknown>;
    expect(ticktick["error"]).toBe("Auth failed");
  });

  it("includes fetchedAt as ISO string", () => {
    const fetchedAt = new Date("2026-02-19T08:30:00.000Z");
    const data = makeDashboardData({ fetchedAt });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    expect(d["fetchedAt"]).toBe("2026-02-19T08:30:00.000Z");
  });

  it("includes activity array in data", () => {
    const data = makeDashboardData({ activity: [] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    expect(Array.isArray(d["activity"])).toBe(true);
  });

  it("includes activity events when present", () => {
    const event = {
      type: "comment" as const,
      repoShortName: "my-repo",
      issueNumber: 42,
      actor: "alice",
      summary: "commented on #42",
      timestamp: new Date("2026-02-19T10:00:00Z"),
    };
    const data = makeDashboardData({ activity: [event] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const activity = d["activity"] as Record<string, unknown>[];
    expect(activity).toHaveLength(1);
    expect(activity[0]?.["actor"]).toBe("alice");
    expect(activity[0]?.["issueNumber"]).toBe(42);
  });

  it("includes task dueDate and tags", () => {
    const task = makeTask({
      dueDate: "2026-03-01T00:00:00Z",
      tags: ["work", "urgent"],
    });
    const data = makeDashboardData({ ticktick: [task] });
    const result = renderBoardJson(data, "alice");
    const d = getBoardJsonData(result);
    const ticktick = d["ticktick"] as Record<string, unknown>;
    const tasks = ticktick["tasks"] as Record<string, unknown>[];
    expect(tasks[0]?.["dueDate"]).toBe("2026-03-01T00:00:00Z");
    expect(tasks[0]?.["tags"]).toEqual(["work", "urgent"]);
  });

  it("serialises correctly to JSON (valid JSON round-trip)", () => {
    const data = makeDashboardData({
      repos: [makeRepoData({ issues: [makeIssue()] })],
      ticktick: [makeTask()],
    });
    const result = renderBoardJson(data, "alice");
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed["ok"]).toBe(true);
  });
});

// ── renderStaticBoard ─────────────────────────────────────────────────────────
// renderStaticBoard calls console.log — spy on it so tests remain quiet
// and we can verify output content.

describe("renderStaticBoard", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      capturedOutput.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("calls console.log at least once", () => {
    renderStaticBoard(makeDashboardData(), "alice", false);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("outputs HOG BOARD header text", () => {
    renderStaticBoard(makeDashboardData(), "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("HOG BOARD");
  });

  it("renders repo short name in output", () => {
    const data = makeDashboardData({
      repos: [makeRepoData({ repo: makeRepoConfig({ shortName: "my-project" }) })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("my-project");
  });

  it("renders issue number in output", () => {
    const data = makeDashboardData({
      repos: [
        makeRepoData({
          issues: [
            makeIssue({ number: 99, title: "Important fix", assignees: [{ login: "alice" }] }),
          ],
        }),
      ],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("99");
  });

  it("renders issue title in output", () => {
    const data = makeDashboardData({
      repos: [
        makeRepoData({
          issues: [makeIssue({ title: "Unique title for testing" })],
        }),
      ],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("Unique title for testing");
  });

  it("shows repo error message when repo has an error", () => {
    const data = makeDashboardData({
      repos: [makeRepoData({ error: "Connection refused" })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("Connection refused");
  });

  it("shows 'No open issues' when repo has no issues", () => {
    const data = makeDashboardData({
      repos: [makeRepoData({ issues: [] })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("No open issues");
  });

  it("shows TickTick section when not backlogOnly", () => {
    const data = makeDashboardData({
      ticktick: [makeTask({ title: "TickTick task" })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("TickTick");
  });

  it("omits TickTick section when backlogOnly is true", () => {
    const data = makeDashboardData({
      ticktick: [makeTask({ title: "TickTick task" })],
    });
    renderStaticBoard(data, "alice", true);
    const all = capturedOutput.join("\n");
    expect(all).not.toContain("TickTick");
  });

  it("shows 'No active tasks' when TickTick has no tasks", () => {
    const data = makeDashboardData({ ticktick: [] });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("No active tasks");
  });

  it("shows TickTick error message when ticktickError is set", () => {
    const data = makeDashboardData({ ticktickError: "Token expired" });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("Token expired");
  });

  it("shows 'In Progress' section for assigned issues when not backlogOnly", () => {
    const data = makeDashboardData({
      repos: [
        makeRepoData({
          issues: [makeIssue({ assignees: [{ login: "alice" }] })],
        }),
      ],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("In Progress");
  });

  it("shows 'Backlog' section for unassigned issues", () => {
    const data = makeDashboardData({
      repos: [
        makeRepoData({
          issues: [makeIssue({ assignees: [] })],
        }),
      ],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("Backlog");
  });

  it("hides assigned issues in backlogOnly mode", () => {
    const data = makeDashboardData({
      repos: [
        makeRepoData({
          issues: [
            makeIssue({ number: 5, title: "Assigned issue", assignees: [{ login: "alice" }] }),
          ],
        }),
      ],
    });
    renderStaticBoard(data, "alice", true);
    const all = capturedOutput.join("\n");
    // In backlogOnly mode assigned issues are filtered out — only backlog shown
    expect(all).not.toContain("In Progress");
  });

  it("shows task title in TickTick section", () => {
    const data = makeDashboardData({
      ticktick: [makeTask({ title: "Deploy to production" })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("Deploy to production");
  });

  it("shows 'due today' indicator when task due date is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T12:00:00Z"));

    const data = makeDashboardData({
      ticktick: [makeTask({ dueDate: "2026-02-19T00:00:00Z" })],
      fetchedAt: new Date("2026-02-19T12:00:00Z"),
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    // The TickTick header should include "due today" count when tasks are due
    expect(all).toContain("due today");

    vi.useRealTimers();
  });
});

// ── Task sort order (branches in renderTickTickSection comparator) ────────────
// renderTickTickSection is private; we exercise it indirectly through
// renderStaticBoard and inspect the relative position of task titles in output.

describe("renderStaticBoard task sort order", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      capturedOutput.push(args.map(String).join(" "));
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T12:00:00Z"));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.useRealTimers();
  });

  it("places a task with dueDate before a task without dueDate", () => {
    // Branch: a.dueDate && !b.dueDate → return -1 (a comes first)
    const withDue = makeTask({
      id: "t-due",
      title: "Has Due Date",
      dueDate: "2026-03-01T00:00:00Z",
    });
    const withoutDue = makeTask({ id: "t-no-due", title: "No Due Date", dueDate: "" });
    // Pass without-due first so the sort must move with-due ahead
    const data = makeDashboardData({ ticktick: [withoutDue, withDue] });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all.indexOf("Has Due Date")).toBeLessThan(all.indexOf("No Due Date"));
  });

  it("places a task without dueDate after a task with dueDate", () => {
    // Branch: !a.dueDate && b.dueDate → return 1 (b comes first)
    const withDue = makeTask({
      id: "t-due",
      title: "Has Due Date",
      dueDate: "2026-03-01T00:00:00Z",
    });
    const withoutDue = makeTask({ id: "t-no-due", title: "No Due Date", dueDate: "" });
    // Pass with-due first; sort must keep it before without-due
    const data = makeDashboardData({ ticktick: [withDue, withoutDue] });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all.indexOf("Has Due Date")).toBeLessThan(all.indexOf("No Due Date"));
  });

  it("sorts two tasks with dueDates by date (earlier date first)", () => {
    // Branch: a.dueDate && b.dueDate → a.dueDate.localeCompare(b.dueDate)
    const earlier = makeTask({
      id: "t-early",
      title: "Earlier Task",
      dueDate: "2026-03-01T00:00:00Z",
    });
    const later = makeTask({ id: "t-late", title: "Later Task", dueDate: "2026-04-01T00:00:00Z" });
    // Pass later first so the sort must reorder them
    const data = makeDashboardData({ ticktick: [later, earlier] });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all.indexOf("Earlier Task")).toBeLessThan(all.indexOf("Later Task"));
  });

  it("sorts two tasks without dueDates by priority (higher priority first)", () => {
    // Branch: both no dueDate → b.priority - a.priority (descending priority)
    const highPri = makeTask({
      id: "t-high",
      title: "High Priority Task",
      dueDate: "",
      priority: Priority.High,
    });
    const lowPri = makeTask({
      id: "t-low",
      title: "Low Priority Task",
      dueDate: "",
      priority: Priority.Low,
    });
    // Pass low-priority first so the sort must place high-priority ahead
    const data = makeDashboardData({ ticktick: [lowPri, highPri] });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all.indexOf("High Priority Task")).toBeLessThan(all.indexOf("Low Priority Task"));
  });
});

// ── formatDueDate (tested indirectly through renderStaticBoard output) ────────

describe("formatDueDate via renderStaticBoard output", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      capturedOutput.push(args.map(String).join(" "));
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T12:00:00Z"));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.useRealTimers();
  });

  it("shows 'overdue' text for a past due date", () => {
    const data = makeDashboardData({
      ticktick: [makeTask({ dueDate: "2026-02-15T00:00:00Z" })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("overdue");
  });

  it("shows 'today' text for a due date that is today", () => {
    const data = makeDashboardData({
      ticktick: [makeTask({ dueDate: "2026-02-19T00:00:00Z" })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("today");
  });

  it("shows 'tomorrow' text for a due date that is tomorrow", () => {
    const data = makeDashboardData({
      ticktick: [makeTask({ dueDate: "2026-02-20T00:00:00Z" })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("tomorrow");
  });

  it("shows 'in Nd' text for a due date within the next 7 days", () => {
    const data = makeDashboardData({
      ticktick: [makeTask({ dueDate: "2026-02-22T00:00:00Z" })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    expect(all).toContain("in ");
    expect(all).toMatch(/in \d+d/);
  });

  it("shows short month/day for a due date more than 7 days out", () => {
    // Feb 19 + 10 days = Mar 1
    const data = makeDashboardData({
      ticktick: [makeTask({ dueDate: "2026-03-01T00:00:00Z" })],
    });
    renderStaticBoard(data, "alice", false);
    const all = capturedOutput.join("\n");
    // toLocaleDateString with { month: 'short', day: 'numeric' } → "Mar 1"
    expect(all).toContain("Mar");
  });
});
