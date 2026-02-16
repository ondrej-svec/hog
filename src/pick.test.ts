import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing pick module
vi.mock("./config.js", () => ({
  findRepo: vi.fn(),
  requireAuth: () => ({ accessToken: "test-token", clientId: "cid", clientSecret: "csec" }),
}));

const mockAssignIssue = vi.fn();
const mockFetchRepoIssues = vi.fn();
const mockFetchProjectFields = vi.fn();

vi.mock("./github.js", () => ({
  assignIssue: (...args: unknown[]) => mockAssignIssue(...args),
  fetchRepoIssues: (...args: unknown[]) => mockFetchRepoIssues(...args),
  fetchProjectFields: (...args: unknown[]) => mockFetchProjectFields(...args),
}));

const mockCreateTask = vi.fn();

vi.mock("./api.js", () => ({
  // biome-ignore lint/complexity/useArrowFunction: vitest 4 requires function keyword for constructor mocks
  TickTickClient: vi.fn().mockImplementation(function () {
    return { createTask: mockCreateTask };
  }),
}));

const mockLoadSyncState = vi.fn();
const mockSaveSyncState = vi.fn();
const mockFindMapping = vi.fn();
const mockUpsertMapping = vi.fn();

vi.mock("./sync-state.js", () => ({
  loadSyncState: (...args: unknown[]) => mockLoadSyncState(...args),
  saveSyncState: (...args: unknown[]) => mockSaveSyncState(...args),
  findMapping: (...args: unknown[]) => mockFindMapping(...args),
  upsertMapping: (...args: unknown[]) => mockUpsertMapping(...args),
}));

import type { HogConfig, RepoConfig } from "./config.js";
import { findRepo } from "./config.js";
import { parseIssueRef, pickIssue } from "./pick.js";

const mockFindRepo = vi.mocked(findRepo);

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
    version: 3,
    defaultProjectId: "inbox123",
    repos: [makeRepo()],
    board: { refreshInterval: 60, backlogLimit: 20, assignee: "test-user", focusDuration: 1500 },
    ticktick: { enabled: true },
    profiles: {},
    ...overrides,
  };
}

function makeGitHubIssue(overrides: Record<string, unknown> = {}) {
  return {
    number: 145,
    title: "Fix mobile layout",
    url: "https://github.com/test-org/backend/issues/145",
    state: "open",
    updatedAt: "2026-02-15T10:00:00Z",
    labels: [],
    assignees: [],
    ...overrides,
  };
}

describe("parseIssueRef", () => {
  it("parses valid shortName/number format", () => {
    const repo = makeRepo();
    mockFindRepo.mockReturnValue(repo);
    const config = makeConfig();

    const result = parseIssueRef("aibility/145", config);
    expect(result.repo).toBe(repo);
    expect(result.issueNumber).toBe(145);
    expect(mockFindRepo).toHaveBeenCalledWith(config, "aibility");
  });

  it("throws on invalid format (no slash)", () => {
    expect(() => parseIssueRef("aibility145", makeConfig())).toThrow("Invalid format");
  });

  it("throws on invalid format (empty parts)", () => {
    expect(() => parseIssueRef("/145", makeConfig())).toThrow("Invalid format");
  });

  it("throws on unknown repo", () => {
    mockFindRepo.mockReturnValue(undefined);
    expect(() => parseIssueRef("unknown/145", makeConfig())).toThrow('Unknown repo "unknown"');
  });

  it("throws on invalid issue number (zero)", () => {
    mockFindRepo.mockReturnValue(makeRepo());
    expect(() => parseIssueRef("aibility/0", makeConfig())).toThrow("Invalid issue number");
  });

  it("throws on invalid issue number (too large)", () => {
    mockFindRepo.mockReturnValue(makeRepo());
    expect(() => parseIssueRef("aibility/1000000", makeConfig())).toThrow("Invalid issue number");
  });

  describe("malicious input fuzzing", () => {
    const config = makeConfig();

    it.each([
      "../../etc/passwd/1",
      "../../../1",
      "repo/1; rm -rf /",
      "repo/1$(whoami)",
      "repo/1`id`",
      "repo/1 && echo pwned",
      "repo/1|cat /etc/passwd",
    ])("rejects shell injection / path traversal: %s", (input) => {
      expect(() => parseIssueRef(input, config)).toThrow();
    });

    it.each([
      "repo/-1",
      "repo/NaN",
      "repo/Infinity",
      "repo/1e10",
      "repo/0x1",
      "repo/1.5",
    ])("rejects non-positive-integer issue numbers: %s", (input) => {
      expect(() => parseIssueRef(input, config)).toThrow();
    });

    it.each(["repo\x00name/1", "\x00/1", "repo/\x001"])("rejects null bytes: %s", (input) => {
      expect(() => parseIssueRef(input, config)).toThrow();
    });

    it.each([
      "",
      "   ",
      "/",
      "//",
      "///1",
      "repo/",
      "/1",
    ])("rejects malformed refs: %s", (input) => {
      expect(() => parseIssueRef(input, config)).toThrow();
    });
  });
});

describe("pickIssue", () => {
  const repo = makeRepo();
  const config = makeConfig();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchProjectFields.mockReturnValue({});
    mockLoadSyncState.mockReturnValue({ mappings: [], lastSyncAt: null });
    mockFindMapping.mockReturnValue(undefined);
    mockCreateTask.mockResolvedValue({
      id: "tt-task-1",
      title: "Fix mobile layout",
      projectId: "inbox123",
      status: 0,
      priority: 0,
    });
  });

  it("assigns issue on GitHub and creates TickTick task", async () => {
    const issue = makeGitHubIssue();
    mockFetchRepoIssues.mockReturnValue([issue]);

    const result = await pickIssue(config, { repo, issueNumber: 145 });

    expect(result.success).toBe(true);
    expect(result.issue.number).toBe(145);
    expect(result.issue.repo).toBe("test-org/backend");
    expect(mockAssignIssue).toHaveBeenCalledWith("test-org/backend", 145);
    expect(mockCreateTask).toHaveBeenCalled();
    expect(mockUpsertMapping).toHaveBeenCalled();
    expect(mockSaveSyncState).toHaveBeenCalled();
    expect(result.ticktickTask).toBeDefined();
  });

  it("throws if issue not found", async () => {
    mockFetchRepoIssues.mockReturnValue([]);

    await expect(pickIssue(config, { repo, issueNumber: 999 })).rejects.toThrow(
      "Issue #999 not found",
    );
  });

  it("warns if issue already assigned to self", async () => {
    const issue = makeGitHubIssue({ assignees: [{ login: "test-user" }] });
    mockFetchRepoIssues.mockReturnValue([issue]);

    const result = await pickIssue(config, { repo, issueNumber: 145 });

    expect(result.warning).toContain("already assigned to you");
    expect(mockAssignIssue).toHaveBeenCalled(); // Still assigns (idempotent)
  });

  it("warns if issue assigned to someone else", async () => {
    const issue = makeGitHubIssue({ assignees: [{ login: "petr" }] });
    mockFetchRepoIssues.mockReturnValue([issue]);

    const result = await pickIssue(config, { repo, issueNumber: 145 });

    expect(result.warning).toContain("currently assigned to petr");
  });

  it("skips TickTick if sync mapping already exists", async () => {
    const issue = makeGitHubIssue();
    mockFetchRepoIssues.mockReturnValue([issue]);
    mockFindMapping.mockReturnValue({ ticktickTaskId: "existing" });

    const result = await pickIssue(config, { repo, issueNumber: 145 });

    expect(result.success).toBe(true);
    expect(result.ticktickTask).toBeUndefined();
    expect(result.warning).toContain("TickTick task already exists");
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("handles TickTick failure gracefully", async () => {
    const issue = makeGitHubIssue();
    mockFetchRepoIssues.mockReturnValue([issue]);
    mockCreateTask.mockRejectedValue(new Error("API timeout"));

    const result = await pickIssue(config, { repo, issueNumber: 145 });

    expect(result.success).toBe(true); // GitHub assignment succeeded
    expect(result.warning).toContain("TickTick sync failed: API timeout");
    expect(mockAssignIssue).toHaveBeenCalled();
  });

  it("includes project fields in TickTick task when available", async () => {
    const issue = makeGitHubIssue();
    mockFetchRepoIssues.mockReturnValue([issue]);
    mockFetchProjectFields.mockReturnValue({ targetDate: "2026-02-20", status: "In Progress" });

    await pickIssue(config, { repo, issueNumber: 145 });

    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: "2026-02-20",
        isAllDay: true,
      }),
    );
  });
});
