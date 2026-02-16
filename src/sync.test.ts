import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing sync module
vi.mock("./config.js", () => ({
  requireAuth: () => ({ accessToken: "test-token", clientId: "cid", clientSecret: "csec" }),
  loadFullConfig: () => ({
    version: 3,
    repos: [
      {
        name: "aibilitycz/aibility",
        shortName: "aibility",
        projectNumber: 10,
        statusFieldId: "PVTSSF_lADODPBO_s4BOlJ6zg9Paxg",
        completionAction: { type: "updateProjectStatus", optionId: "df73e18b" },
      },
      {
        name: "aibilitycz/aimee-product",
        shortName: "aimee",
        projectNumber: 8,
        statusFieldId: "PVTSSF_lADODPBO_s4BOFV4zg8455s",
        completionAction: { type: "addLabel", label: "review:pending" },
      },
    ],
    board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej-svec" },
    ticktick: { enabled: true },
    profiles: {},
  }),
}));

const mockCreateTask = vi.fn();
const mockUpdateTask = vi.fn();
const mockCompleteTask = vi.fn();
const mockGetTask = vi.fn();

vi.mock("./api.js", () => ({
  TickTickClient: vi.fn().mockImplementation(() => ({
    createTask: mockCreateTask,
    updateTask: mockUpdateTask,
    completeTask: mockCompleteTask,
    getTask: mockGetTask,
  })),
}));

const mockFetchAssignedIssues = vi.fn();
const mockFetchProjectFields = vi.fn();
const mockAddLabel = vi.fn();
const mockUpdateProjectItemStatus = vi.fn();

vi.mock("./github.js", () => ({
  fetchAssignedIssues: (...args: unknown[]) => mockFetchAssignedIssues(...args),
  fetchProjectFields: (...args: unknown[]) => mockFetchProjectFields(...args),
  addLabel: (...args: unknown[]) => mockAddLabel(...args),
  updateProjectItemStatus: (...args: unknown[]) => mockUpdateProjectItemStatus(...args),
}));

const mockLoadSyncState = vi.fn();
const mockSaveSyncState = vi.fn();

vi.mock("./sync-state.js", async () => {
  const actual = await vi.importActual<typeof import("./sync-state.js")>("./sync-state.js");
  return {
    ...actual,
    loadSyncState: () => mockLoadSyncState(),
    saveSyncState: (state: unknown) => mockSaveSyncState(state),
  };
});

import type { GitHubIssue } from "./github.js";
import { runSync } from "./sync.js";
import type { SyncState } from "./sync-state.js";
import { Priority, TaskStatus } from "./types.js";

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Fix the bug",
    url: "https://github.com/aibilitycz/aibility/issues/42",
    state: "open",
    updatedAt: "2025-01-15T10:00:00Z",
    labels: [],
    ...overrides,
  };
}

function emptyState(): SyncState {
  return { mappings: [] };
}

describe("sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSyncState.mockReturnValue(emptyState());
    mockFetchProjectFields.mockReturnValue({});
  });

  describe("Phase 1: GitHub -> TickTick", () => {
    it("creates TickTick task for new GitHub issue", async () => {
      const issue = makeIssue();
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aibility") return [issue];
        return [];
      });
      mockCreateTask.mockResolvedValue({
        id: "tt-new",
        projectId: "proj-inbox",
        title: "[aibility#42] Fix the bug",
      });

      const result = await runSync();

      expect(result.created).toContain("aibilitycz/aibility#42");
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Fix the bug",
          tags: ["github", "aibility"],
        }),
      );
      expect(mockSaveSyncState).toHaveBeenCalled();
    });

    it("maps priority labels correctly", async () => {
      const issue = makeIssue({ labels: [{ name: "priority:high" }] });
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aibility") return [issue];
        return [];
      });
      mockCreateTask.mockResolvedValue({
        id: "tt-new",
        projectId: "proj-inbox",
        title: "[aibility#42] Fix the bug",
      });

      await runSync();

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ priority: Priority.High }),
      );
    });

    it("skips unchanged issues", async () => {
      const issue = makeIssue();
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aibility") return [issue];
        return [];
      });
      mockLoadSyncState.mockReturnValue({
        mappings: [
          {
            githubRepo: "aibilitycz/aibility",
            githubIssueNumber: 42,
            githubUrl: issue.url,
            ticktickTaskId: "tt-existing",
            ticktickProjectId: "proj-inbox",
            githubUpdatedAt: "2025-01-15T10:00:00Z", // same as issue
            lastSyncedAt: "2025-01-15T10:05:00Z",
          },
        ],
      });

      const result = await runSync();

      expect(result.created).toHaveLength(0);
      expect(result.updated).toHaveLength(0);
      expect(mockCreateTask).not.toHaveBeenCalled();
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });

    it("updates task when issue has changed", async () => {
      const issue = makeIssue({ updatedAt: "2025-01-16T10:00:00Z" });
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aibility") return [issue];
        return [];
      });
      mockLoadSyncState.mockReturnValue({
        mappings: [
          {
            githubRepo: "aibilitycz/aibility",
            githubIssueNumber: 42,
            githubUrl: issue.url,
            ticktickTaskId: "tt-existing",
            ticktickProjectId: "proj-inbox",
            githubUpdatedAt: "2025-01-15T10:00:00Z",
            lastSyncedAt: "2025-01-15T10:05:00Z",
          },
        ],
      });
      mockUpdateTask.mockResolvedValue({ id: "tt-existing" });

      const result = await runSync();

      expect(result.updated).toContain("aibilitycz/aibility#42");
      expect(mockUpdateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tt-existing", projectId: "proj-inbox" }),
      );
    });

    it("sets due date from project target date", async () => {
      const issue = makeIssue();
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aibility") return [issue];
        return [];
      });
      mockFetchProjectFields.mockReturnValue({ targetDate: "2025-02-01" });
      mockCreateTask.mockResolvedValue({
        id: "tt-new",
        projectId: "proj-inbox",
        title: "[aibility#42] Fix the bug",
      });

      await runSync();

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: "2025-02-01", isAllDay: true }),
      );
    });
  });

  describe("Phase 2: Closed issues -> complete TickTick tasks", () => {
    it("does NOT complete tasks when repo fetch fails", async () => {
      mockFetchAssignedIssues.mockImplementation(() => {
        throw new Error("gh: command not found");
      });
      mockLoadSyncState.mockReturnValue({
        mappings: [
          {
            githubRepo: "aibilitycz/aibility",
            githubIssueNumber: 42,
            githubUrl: "https://github.com/aibilitycz/aibility/issues/42",
            ticktickTaskId: "tt-123",
            ticktickProjectId: "proj-inbox",
            githubUpdatedAt: "2025-01-15T10:00:00Z",
            lastSyncedAt: "2025-01-15T10:05:00Z",
          },
        ],
      });

      const result = await runSync();

      expect(result.completed).toHaveLength(0);
      expect(mockCompleteTask).not.toHaveBeenCalled();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("completes TickTick task when GitHub issue is no longer open", async () => {
      mockFetchAssignedIssues.mockReturnValue([]); // No open issues
      mockLoadSyncState.mockReturnValue({
        mappings: [
          {
            githubRepo: "aibilitycz/aibility",
            githubIssueNumber: 42,
            githubUrl: "https://github.com/aibilitycz/aibility/issues/42",
            ticktickTaskId: "tt-123",
            ticktickProjectId: "proj-inbox",
            githubUpdatedAt: "2025-01-15T10:00:00Z",
            lastSyncedAt: "2025-01-15T10:05:00Z",
          },
        ],
      });
      mockCompleteTask.mockResolvedValue(undefined);

      const result = await runSync();

      expect(result.completed).toContain("aibilitycz/aibility#42");
      expect(mockCompleteTask).toHaveBeenCalledWith("proj-inbox", "tt-123");
    });
  });

  describe("Phase 3: TickTick completed -> update GitHub", () => {
    it("adds review:pending label for completed aimee-product task", async () => {
      const issue = makeIssue({
        number: 10,
        url: "https://github.com/aibilitycz/aimee-product/issues/10",
      });
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aimee-product") return [issue];
        return [];
      });
      mockLoadSyncState.mockReturnValue({
        mappings: [
          {
            githubRepo: "aibilitycz/aimee-product",
            githubIssueNumber: 10,
            githubUrl: issue.url,
            ticktickTaskId: "tt-aimee",
            ticktickProjectId: "proj-inbox",
            githubUpdatedAt: issue.updatedAt,
            lastSyncedAt: "2025-01-15T10:05:00Z",
          },
        ],
      });
      mockGetTask.mockResolvedValue({
        id: "tt-aimee",
        projectId: "proj-inbox",
        status: TaskStatus.Completed,
      });

      const result = await runSync();

      expect(result.ghUpdated).toContain("aibilitycz/aimee-product#10");
      expect(mockAddLabel).toHaveBeenCalledWith("aibilitycz/aimee-product", 10, "review:pending");
    });

    it("updates project status for completed aibility task", async () => {
      const issue = makeIssue();
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aibility") return [issue];
        return [];
      });
      mockLoadSyncState.mockReturnValue({
        mappings: [
          {
            githubRepo: "aibilitycz/aibility",
            githubIssueNumber: 42,
            githubUrl: issue.url,
            ticktickTaskId: "tt-abi",
            ticktickProjectId: "proj-inbox",
            githubUpdatedAt: issue.updatedAt,
            lastSyncedAt: "2025-01-15T10:05:00Z",
          },
        ],
      });
      mockGetTask.mockResolvedValue({
        id: "tt-abi",
        projectId: "proj-inbox",
        status: TaskStatus.Completed,
      });

      const result = await runSync();

      expect(result.ghUpdated).toContain("aibilitycz/aibility#42");
      expect(mockUpdateProjectItemStatus).toHaveBeenCalledWith("aibilitycz/aibility", 42, {
        projectNumber: 10,
        statusFieldId: "PVTSSF_lADODPBO_s4BOlJ6zg9Paxg",
        optionId: "df73e18b",
      });
    });
  });

  describe("dry-run mode", () => {
    it("reports changes without applying them", async () => {
      const issue = makeIssue();
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aibility") return [issue];
        return [];
      });

      const result = await runSync({ dryRun: true });

      expect(result.created).toContain("aibilitycz/aibility#42");
      expect(mockCreateTask).not.toHaveBeenCalled();
      expect(mockSaveSyncState).not.toHaveBeenCalled();
    });
  });

  describe("error isolation", () => {
    it("continues syncing other issues when one fails", async () => {
      const issue1 = makeIssue({ number: 1, title: "First" });
      const issue2 = makeIssue({ number: 2, title: "Second" });
      mockFetchAssignedIssues.mockImplementation((repo: string) => {
        if (repo === "aibilitycz/aibility") return [issue1, issue2];
        return [];
      });
      mockFetchProjectFields
        .mockImplementationOnce(() => {
          throw new Error("GraphQL failed");
        })
        .mockReturnValueOnce({});
      mockCreateTask.mockResolvedValue({
        id: "tt-new",
        projectId: "proj-inbox",
        title: "[aibility#2] Second",
      });

      const result = await runSync();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("aibilitycz/aibility#1");
      expect(result.created).toContain("aibilitycz/aibility#2");
    });
  });
});
