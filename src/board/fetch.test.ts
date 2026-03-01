import { beforeEach, describe, expect, it, vi } from "vitest";

// Must mock node:child_process before importing fetch.ts because fetchRecentActivity
// calls execFileSync directly (not through github.ts).
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockFetchRepoIssues = vi.fn();
const mockFetchProjectEnrichment = vi.fn();
const mockFetchProjectStatusOptions = vi.fn();

vi.mock("../github.js", () => ({
  fetchRepoIssues: (...args: unknown[]) => mockFetchRepoIssues(...args),
  fetchProjectEnrichment: (...args: unknown[]) => mockFetchProjectEnrichment(...args),
  fetchProjectStatusOptions: (...args: unknown[]) => mockFetchProjectStatusOptions(...args),
}));

import { execFileSync } from "node:child_process";
import type { HogConfig, RepoConfig } from "../config.js";
import {
  extractIssueNumbersFromBranch,
  extractLinkedIssueNumbers,
  fetchDashboard,
  fetchRecentActivity,
} from "./fetch.js";

const mockExecFileSync = vi.mocked(execFileSync);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    name: "test-org/backend",
    shortName: "backend",
    projectNumber: 10,
    statusFieldId: "PVTSSF_test",
    completionAction: { type: "updateProjectStatus", optionId: "abc123" },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<HogConfig> = {}): HogConfig {
  return {
    version: 4,
    repos: [makeRepo()],
    board: { refreshInterval: 60, backlogLimit: 20, assignee: "test-user", focusDuration: 1500 },
    profiles: {},
    ...overrides,
  };
}

function makeGitHubIssue(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: "Fix the bug",
    url: "https://github.com/test-org/backend/issues/42",
    state: "open",
    updatedAt: "2026-02-18T12:00:00Z",
    labels: [],
    assignees: [],
    body: undefined,
    ...overrides,
  };
}

// ── fetchDashboard ─────────────────────────────────────────────────────────────

describe("fetchDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchRepoIssues.mockReturnValue([]);
    mockFetchProjectEnrichment.mockReturnValue(new Map());
    mockFetchProjectStatusOptions.mockReturnValue([]);
    // By default, silence the fetchRecentActivity execFileSync call
    mockExecFileSync.mockReturnValue("");
  });

  it("returns repos, activity, and fetchedAt on happy path", async () => {
    const issue = makeGitHubIssue();
    mockFetchRepoIssues.mockReturnValue([issue]);
    mockFetchProjectStatusOptions.mockReturnValue([{ id: "opt-1", name: "In Progress" }]);

    const config = makeConfig();
    const result = await fetchDashboard(config);

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.error).toBeNull();
    expect(result.repos[0]?.issues).toHaveLength(1);
    expect(result.repos[0]?.issues[0]?.number).toBe(42);
    expect(result.repos[0]?.statusOptions).toEqual([{ id: "opt-1", name: "In Progress" }]);
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it("returns empty issues for a repo that errors, with error message", async () => {
    mockFetchRepoIssues.mockImplementation(() => {
      throw new Error("gh: authentication failed");
    });

    const config = makeConfig();
    const result = await fetchDashboard(config);

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.issues).toHaveLength(0);
    expect(result.repos[0]?.error).toBe("gh: authentication failed");
  });

  it("handles non-Error repo failures by stringifying them", async () => {
    mockFetchRepoIssues.mockImplementation(() => {
      throw "string error";
    });

    const config = makeConfig();
    const result = await fetchDashboard(config);

    expect(result.repos[0]?.error).toBe("string error");
  });

  it("returns empty repos when there are no repos configured", async () => {
    const config = makeConfig({ repos: [] });
    const result = await fetchDashboard(config);

    expect(result.repos).toHaveLength(0);
    expect(result.activity).toHaveLength(0);
  });

  it("filters repos by repoFilter matching shortName", async () => {
    const backendRepo = makeRepo({ name: "test-org/backend", shortName: "backend" });
    const frontendRepo = makeRepo({
      name: "test-org/frontend",
      shortName: "frontend",
      projectNumber: 11,
      statusFieldId: "PVTSSF_front",
      completionAction: { type: "closeIssue" },
    });
    const config = makeConfig({ repos: [backendRepo, frontendRepo] });

    const result = await fetchDashboard(config, { repoFilter: "frontend" });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.repo.shortName).toBe("frontend");
  });

  it("filters repos by repoFilter matching full repo name", async () => {
    const backendRepo = makeRepo({ name: "test-org/backend", shortName: "backend" });
    const frontendRepo = makeRepo({
      name: "test-org/frontend",
      shortName: "frontend",
      projectNumber: 11,
      statusFieldId: "PVTSSF_front",
      completionAction: { type: "closeIssue" },
    });
    const config = makeConfig({ repos: [backendRepo, frontendRepo] });

    const result = await fetchDashboard(config, { repoFilter: "test-org/backend" });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.repo.name).toBe("test-org/backend");
  });

  it("passes assignee from config.board when mineOnly is true", async () => {
    const config = makeConfig();
    await fetchDashboard(config, { mineOnly: true });

    expect(mockFetchRepoIssues).toHaveBeenCalledWith(
      "test-org/backend",
      expect.objectContaining({ assignee: "test-user" }),
    );
  });

  it("does not pass assignee when mineOnly is false", async () => {
    const config = makeConfig();
    await fetchDashboard(config, { mineOnly: false });

    expect(mockFetchRepoIssues).toHaveBeenCalledWith("test-org/backend", {});
  });

  it("enriches issues with targetDate and projectStatus from project enrichment", async () => {
    const issue = makeGitHubIssue({ number: 42 });
    mockFetchRepoIssues.mockReturnValue([issue]);
    mockFetchProjectEnrichment.mockReturnValue(
      new Map([[42, { targetDate: "2026-03-01", projectStatus: "In Review" }]]),
    );

    const config = makeConfig();
    const result = await fetchDashboard(config);

    expect(result.repos[0]?.issues[0]?.targetDate).toBe("2026-03-01");
    expect(result.repos[0]?.issues[0]?.projectStatus).toBe("In Review");
  });

  it("silently ignores project enrichment failures (non-critical)", async () => {
    const issue = makeGitHubIssue();
    mockFetchRepoIssues.mockReturnValue([issue]);
    mockFetchProjectEnrichment.mockImplementation(() => {
      throw new Error("GraphQL rate limited");
    });

    const config = makeConfig();
    const result = await fetchDashboard(config);

    expect(result.repos[0]?.error).toBeNull();
    expect(result.repos[0]?.issues).toHaveLength(1);
    // statusOptions falls back to empty because the catch swallows the error
    expect(result.repos[0]?.statusOptions).toHaveLength(0);
  });

  it("extracts Slack thread URL from issue body", async () => {
    const issue = makeGitHubIssue({
      body: "See thread: https://myteam.slack.com/archives/C012345678/p1234567890123456",
    });
    mockFetchRepoIssues.mockReturnValue([issue]);

    const config = makeConfig();
    const result = await fetchDashboard(config);

    expect(result.repos[0]?.issues[0]?.slackThreadUrl).toBe(
      "https://myteam.slack.com/archives/C012345678/p1234567890123456",
    );
  });

  it("does not set slackThreadUrl when issue body has no Slack URL", async () => {
    const issue = makeGitHubIssue({ body: "Just a plain description" });
    mockFetchRepoIssues.mockReturnValue([issue]);

    const config = makeConfig();
    const result = await fetchDashboard(config);

    expect(result.repos[0]?.issues[0]?.slackThreadUrl).toBeUndefined();
  });

  it("sorts activity events by timestamp descending", async () => {
    const repoA = makeRepo({ name: "test-org/backend", shortName: "backend" });
    const repoB = makeRepo({
      name: "test-org/frontend",
      shortName: "frontend",
      projectNumber: 11,
      statusFieldId: "PVTSSF_front",
      completionAction: { type: "closeIssue" },
    });
    const config = makeConfig({ repos: [repoA, repoB] });

    const nowMs = Date.now();
    const olderLine = JSON.stringify({
      type: "IssuesEvent",
      actor: "alice",
      action: "opened",
      number: 1,
      title: "Older issue",
      body: null,
      created_at: new Date(nowMs - 3_600_000).toISOString(),
    });
    const newerLine = JSON.stringify({
      type: "IssuesEvent",
      actor: "bob",
      action: "closed",
      number: 2,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1_800_000).toISOString(),
    });

    // First call (backend): returns the older event; second call (frontend): returns the newer
    mockExecFileSync.mockReturnValueOnce(olderLine).mockReturnValueOnce(newerLine);

    const result = await fetchDashboard(config);

    expect(result.activity.length).toBeGreaterThanOrEqual(2);
    expect(result.activity[0]?.timestamp.getTime()).toBeGreaterThan(
      result.activity[1]?.timestamp.getTime() ?? 0,
    );
  });

  it("caps the total activity list at 15 events", async () => {
    // Produce 20 events from a single repo
    const events = Array.from({ length: 20 }, (_, i) => {
      const nowMs = Date.now();
      return JSON.stringify({
        type: "IssuesEvent",
        actor: "user",
        action: "opened",
        number: i + 1,
        title: `Issue ${i + 1}`,
        body: null,
        created_at: new Date(nowMs - i * 60_000).toISOString(),
      });
    });
    mockExecFileSync.mockReturnValue(events.join("\n"));

    const config = makeConfig();
    const result = await fetchDashboard(config);

    expect(result.activity.length).toBeLessThanOrEqual(15);
  });
});

// ── fetchRecentActivity ────────────────────────────────────────────────────────

describe("fetchRecentActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when execFileSync throws", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("gh not found");
    });

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toEqual([]);
  });

  it("returns empty array for empty output", () => {
    mockExecFileSync.mockReturnValue("");
    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toEqual([]);
  });

  it("parses IssueCommentEvent correctly", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "IssueCommentEvent",
      actor: "alice",
      action: "created",
      number: 7,
      title: "Fix bug",
      body: "Looks good to me",
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("comment");
    expect(events[0]?.actor).toBe("alice");
    expect(events[0]?.issueNumber).toBe(7);
    expect(events[0]?.repoShortName).toBe("backend");
    expect(events[0]?.summary).toContain("commented on #7");
    expect(events[0]?.summary).toContain("Looks good to me");
  });

  it("truncates long comment body in summary with ellipsis", () => {
    const nowMs = Date.now();
    const longBody = "A".repeat(80);
    const line = JSON.stringify({
      type: "IssueCommentEvent",
      actor: "alice",
      action: "created",
      number: 7,
      title: null,
      body: longBody,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");

    expect(events[0]?.summary).toContain("...");
  });

  it("parses IssuesEvent opened action", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "IssuesEvent",
      actor: "bob",
      action: "opened",
      number: 10,
      title: "New feature request",
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("opened");
    expect(events[0]?.summary).toContain("opened #10");
    expect(events[0]?.summary).toContain("New feature request");
  });

  it("parses IssuesEvent closed action", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "IssuesEvent",
      actor: "carol",
      action: "closed",
      number: 5,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");

    expect(events[0]?.type).toBe("closed");
    expect(events[0]?.summary).toContain("closed #5");
  });

  it("parses IssuesEvent assigned action", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "IssuesEvent",
      actor: "dave",
      action: "assigned",
      number: 3,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");

    expect(events[0]?.type).toBe("assignment");
  });

  it("parses IssuesEvent labeled action", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "IssuesEvent",
      actor: "eve",
      action: "labeled",
      number: 9,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");

    expect(events[0]?.type).toBe("labeled");
  });

  it("skips IssuesEvent with unknown action", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "IssuesEvent",
      actor: "frank",
      action: "transferred",
      number: 11,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(0);
  });

  it("parses PullRequestEvent opened", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "PullRequestEvent",
      actor: "grace",
      action: "opened",
      number: 12,
      title: "Fix #42 auth bug",
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
      ref: null,
      ref_type: null,
      merged: null,
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");
    // Linked issue #42 from title
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pr_opened");
    expect(events[0]?.issueNumber).toBe(42);
    expect(events[0]?.prNumber).toBe(12);
  });

  it("parses PullRequestEvent merged", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "PullRequestEvent",
      actor: "grace",
      action: "closed",
      number: 15,
      title: "Add feature",
      body: "Closes #7",
      created_at: new Date(nowMs - 1000).toISOString(),
      ref: null,
      ref_type: null,
      merged: true,
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pr_merged");
    expect(events[0]?.issueNumber).toBe(7);
    expect(events[0]?.prNumber).toBe(15);
  });

  it("parses CreateEvent branch with issue number", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "CreateEvent",
      actor: "bob",
      action: null,
      number: null,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
      ref: "feat/42-add-auth",
      ref_type: "branch",
      merged: null,
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("branch_created");
    expect(events[0]?.issueNumber).toBe(42);
    expect(events[0]?.branchName).toBe("feat/42-add-auth");
  });

  it("skips CreateEvent for tags", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "CreateEvent",
      actor: "bob",
      action: null,
      number: null,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
      ref: "v1.0.0",
      ref_type: "tag",
      merged: null,
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(0);
  });

  it("skips unknown event types", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "WatchEvent",
      actor: "grace",
      action: "started",
      number: null,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
      ref: null,
      ref_type: null,
      merged: null,
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(0);
  });

  it("skips events older than 24 hours", () => {
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const line = JSON.stringify({
      type: "IssuesEvent",
      actor: "alice",
      action: "opened",
      number: 1,
      title: "Old issue",
      body: null,
      created_at: oldTimestamp,
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(0);
  });

  it("skips events with null issue number", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "IssuesEvent",
      actor: "alice",
      action: "opened",
      number: null,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(0);
  });

  it("skips malformed JSON lines without throwing", () => {
    const nowMs = Date.now();
    const validLine = JSON.stringify({
      type: "IssuesEvent",
      actor: "bob",
      action: "opened",
      number: 2,
      title: "Valid issue",
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(`not-json\n${validLine}`);

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(1);
    expect(events[0]?.issueNumber).toBe(2);
  });

  it("caps results at 15 events even when more are returned", () => {
    const nowMs = Date.now();
    const lines = Array.from({ length: 20 }, (_, i) =>
      JSON.stringify({
        type: "IssuesEvent",
        actor: "user",
        action: "opened",
        number: i + 1,
        title: `Issue ${i + 1}`,
        body: null,
        created_at: new Date(nowMs - i * 1000).toISOString(),
      }),
    );
    mockExecFileSync.mockReturnValue(lines.join("\n"));

    const events = fetchRecentActivity("test-org/backend", "backend");
    expect(events).toHaveLength(15);
  });

  it("handles IssueCommentEvent with null body without crashing", () => {
    const nowMs = Date.now();
    const line = JSON.stringify({
      type: "IssueCommentEvent",
      actor: "alice",
      action: "created",
      number: 7,
      title: null,
      body: null,
      created_at: new Date(nowMs - 1000).toISOString(),
    });
    mockExecFileSync.mockReturnValue(line);

    const events = fetchRecentActivity("test-org/backend", "backend");

    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toContain("commented on #7");
    // No body preview appended
    expect(events[0]?.summary).not.toContain('"');
  });
});

describe("extractIssueNumbersFromBranch", () => {
  it("extracts issue number from typical branch names", () => {
    expect(extractIssueNumbersFromBranch("feat/42-add-auth")).toEqual([42]);
    expect(extractIssueNumbersFromBranch("fix/123-broken-login")).toEqual([123]);
    expect(extractIssueNumbersFromBranch("issue-7-bugfix")).toEqual([7]);
  });

  it("extracts multiple issue numbers", () => {
    const result = extractIssueNumbersFromBranch("feat/42-and-43");
    expect(result).toContain(42);
    expect(result).toContain(43);
  });

  it("deduplicates issue numbers", () => {
    expect(extractIssueNumbersFromBranch("feat/42-issue-42")).toEqual([42]);
  });

  it("returns empty for branches without numbers", () => {
    expect(extractIssueNumbersFromBranch("main")).toEqual([]);
    expect(extractIssueNumbersFromBranch("feat/add-auth")).toEqual([]);
  });

  it("uses custom pattern when provided", () => {
    expect(extractIssueNumbersFromBranch("feat/PROJ-42", "PROJ-(\\d+)")).toEqual([42]);
  });

  it("falls back to default when custom pattern is invalid", () => {
    expect(extractIssueNumbersFromBranch("feat/42-fix", "[invalid")).toEqual([42]);
  });
});

describe("extractLinkedIssueNumbers", () => {
  it("extracts issue numbers from title", () => {
    expect(extractLinkedIssueNumbers("Fix #42 auth bug", null)).toEqual([42]);
  });

  it("extracts issue numbers from body", () => {
    expect(extractLinkedIssueNumbers(null, "Closes #7 and fixes #12")).toEqual([7, 12]);
  });

  it("extracts from both title and body", () => {
    expect(extractLinkedIssueNumbers("PR for #5", "Also fixes #10")).toEqual([5, 10]);
  });

  it("deduplicates", () => {
    expect(extractLinkedIssueNumbers("Fix #42", "Closes #42")).toEqual([42]);
  });

  it("returns empty when no issue references", () => {
    expect(extractLinkedIssueNumbers("Add feature", "No issues here")).toEqual([]);
    expect(extractLinkedIssueNumbers(null, null)).toEqual([]);
  });
});
