import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoConfig } from "../config.js";
import type { GitHubIssue } from "../github.js";
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

  it("serialises correctly to JSON (valid JSON round-trip)", () => {
    const data = makeDashboardData({
      repos: [makeRepoData({ issues: [makeIssue()] })],
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
});
