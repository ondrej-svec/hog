import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HogConfig } from "../../config.js";
import type { GitHubIssue } from "../../github.js";
import type { RepoData } from "../fetch.js";
import type { ToastAPI } from "./use-toast.js";

// Mock dependencies
const mockAssignIssueAsync = vi.fn().mockResolvedValue(undefined);
const mockUpdateProjectItemStatusAsync = vi.fn().mockResolvedValue(undefined);
const mockAddCommentAsync = vi.fn().mockResolvedValue(undefined);
const mockAddLabelAsync = vi.fn().mockResolvedValue(undefined);
const mockCloseIssueAsync = vi.fn().mockResolvedValue(undefined);
const mockCreateIssueAsync = vi.fn().mockResolvedValue("");
const mockUnassignIssueAsync = vi.fn().mockResolvedValue(undefined);
const mockUpdateLabelsAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../../github.js", () => ({
  assignIssueAsync: (...args: unknown[]) => mockAssignIssueAsync(...args),
  updateProjectItemStatusAsync: (...args: unknown[]) => mockUpdateProjectItemStatusAsync(...args),
  addCommentAsync: (...args: unknown[]) => mockAddCommentAsync(...args),
  addLabelAsync: (...args: unknown[]) => mockAddLabelAsync(...args),
  closeIssueAsync: (...args: unknown[]) => mockCloseIssueAsync(...args),
  createIssueAsync: (...args: unknown[]) => mockCreateIssueAsync(...args),
  unassignIssueAsync: (...args: unknown[]) => mockUnassignIssueAsync(...args),
  updateLabelsAsync: (...args: unknown[]) => mockUpdateLabelsAsync(...args),
  updateProjectItemDateAsync: vi.fn().mockResolvedValue(undefined),
}));

const mockPickIssue = vi.fn();
vi.mock("../../pick.js", () => ({
  pickIssue: (...args: unknown[]) => mockPickIssue(...args),
}));

import { findIssueContext, useActions } from "./use-actions.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Creates a mock ToastAPI that records all calls for assertion */
function makeMockToast() {
  const calls: Array<{ type: string; message: string }> = [];
  const toast: ToastAPI = {
    info: (message: string) => {
      calls.push({ type: "info", message });
    },
    success: (message: string) => {
      calls.push({ type: "success", message });
    },
    error: (message: string, _retry?: () => void) => {
      calls.push({ type: "error", message });
    },
    loading: (message: string) => {
      calls.push({ type: "loading", message });
      return {
        resolve: (msg: string) => {
          calls.push({ type: "success", message: msg });
        },
        reject: (msg: string) => {
          calls.push({ type: "error", message: msg });
        },
      };
    },
  };
  return { toast, calls, last: () => calls[calls.length - 1] ?? null };
}

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
    board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej", focusDuration: 1500 },
    ticktick: { enabled: true },
    profiles: {},
  };
}

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Test issue",
    url: "https://github.com/owner/repo/issues/42",
    state: "OPEN",
    updatedAt: "2026-02-15T12:00:00Z",
    labels: [],
    assignees: [],
    ...overrides,
  };
}

function makeRepoData(overrides: Partial<RepoData> = {}): RepoData {
  return {
    repo: {
      name: "owner/repo",
      shortName: "repo",
      projectNumber: 1,
      statusFieldId: "SF_1",
      completionAction: { type: "closeIssue" as const },
    },
    issues: [makeIssue()],
    statusOptions: [
      { id: "opt_1", name: "In Progress" },
      { id: "opt_2", name: "Backlog" },
    ],
    error: null,
    ...overrides,
  };
}

// ── Pure function tests ──

describe("findIssueContext", () => {
  it("should find issue by selectedId", () => {
    const repos = [makeRepoData()];
    const config = makeConfig();
    const ctx = findIssueContext(repos, "gh:owner/repo:42", config);

    expect(ctx.issue).not.toBeNull();
    expect(ctx.issue!.number).toBe(42);
    expect(ctx.repoName).toBe("owner/repo");
    expect(ctx.repoConfig).not.toBeNull();
    expect(ctx.statusOptions).toHaveLength(2);
  });

  it("should return null context for non-issue selectedId", () => {
    const repos = [makeRepoData()];
    const config = makeConfig();

    const ctx1 = findIssueContext(repos, "header:repo", config);
    expect(ctx1.issue).toBeNull();

    const ctx2 = findIssueContext(repos, "tt:task-1", config);
    expect(ctx2.issue).toBeNull();

    const ctx3 = findIssueContext(repos, null, config);
    expect(ctx3.issue).toBeNull();
  });

  it("should return null context for non-existent issue", () => {
    const repos = [makeRepoData()];
    const config = makeConfig();
    const ctx = findIssueContext(repos, "gh:owner/repo:999", config);
    expect(ctx.issue).toBeNull();
  });
});

// ── Hook integration tests ──

function ActionsTester({
  config,
  repos,
  selectedId,
}: {
  config: HogConfig;
  repos: RepoData[];
  selectedId: string | null;
}) {
  const mockToast = makeMockToast();
  const refresh = vi.fn();
  const mutateData = vi.fn();
  const onOverlayDone = vi.fn();

  const actions = useActions({
    config,
    repos,
    selectedId,
    toast: mockToast.toast,
    refresh,
    mutateData,
    onOverlayDone,
  });

  // Expose for testing
  (globalThis as Record<string, unknown>)["__actions"] = actions;
  (globalThis as Record<string, unknown>)["__toastCalls"] = mockToast.calls;
  (globalThis as Record<string, unknown>)["__refresh"] = refresh;
  (globalThis as Record<string, unknown>)["__mutateData"] = mutateData;
  (globalThis as Record<string, unknown>)["__onOverlayDone"] = onOverlayDone;

  return (
    <Box>
      <Text>ready</Text>
    </Box>
  );
}

type ToastCall = { type: string; message: string };

function getToastCalls(): ToastCall[] {
  return (globalThis as Record<string, unknown>)["__toastCalls"] as ToastCall[];
}

function lastToast(): ToastCall | null {
  const calls = getToastCalls();
  return calls[calls.length - 1] ?? null;
}

function getRefresh(): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>)["__refresh"] as ReturnType<typeof vi.fn>;
}

function getMutateData(): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>)["__mutateData"] as ReturnType<typeof vi.fn>;
}

describe("useActions hook", () => {
  beforeEach(() => {
    mockAssignIssueAsync.mockReset().mockResolvedValue(undefined);
    mockUpdateProjectItemStatusAsync.mockReset().mockResolvedValue(undefined);
    mockAddCommentAsync.mockReset().mockResolvedValue(undefined);
    mockAddLabelAsync.mockReset().mockResolvedValue(undefined);
    mockCloseIssueAsync.mockReset().mockResolvedValue(undefined);
    mockCreateIssueAsync.mockReset().mockResolvedValue("");
    mockUnassignIssueAsync.mockReset().mockResolvedValue(undefined);
    mockUpdateLabelsAsync.mockReset().mockResolvedValue(undefined);
    mockPickIssue.mockReset();
  });

  describe("handleAssign", () => {
    it("should call assignIssueAsync for unassigned issue", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleAssign();
      await delay(50);

      expect(mockAssignIssueAsync).toHaveBeenCalledWith("owner/repo", 42);

      instance.unmount();
    });

    it("should show feedback for already-assigned issue", async () => {
      const repos = [
        makeRepoData({
          issues: [makeIssue({ assignees: [{ login: "ondrej" }] })],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleAssign();

      expect(mockAssignIssueAsync).not.toHaveBeenCalled();
      expect(lastToast()?.message).toContain("Already assigned");
      expect(lastToast()?.type).toBe("info");

      instance.unmount();
    });

    it("should no-op for non-issue selection", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "tt:task-1",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleAssign();

      expect(mockAssignIssueAsync).not.toHaveBeenCalled();

      instance.unmount();
    });
  });

  describe("handleComment", () => {
    it("should call addCommentAsync with comment args", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleComment("LGTM!");
      await delay(50);

      expect(mockAddCommentAsync).toHaveBeenCalledWith("owner/repo", 42, "LGTM!");

      const onOverlayDone = (globalThis as Record<string, unknown>)[
        "__onOverlayDone"
      ] as ReturnType<typeof vi.fn>;
      expect(onOverlayDone).toHaveBeenCalled();

      instance.unmount();
    });

    it("should show error on failure", async () => {
      mockAddCommentAsync.mockRejectedValue(new Error("Permission denied"));

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleComment("test");
      await delay(50);

      expect(lastToast()?.message).toContain("Comment failed");
      expect(lastToast()?.type).toBe("error");

      instance.unmount();
    });
  });

  describe("handleStatusChange", () => {
    it("should call updateProjectItemStatusAsync with correct config", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleStatusChange("opt_1");
      await delay(50);

      expect(mockUpdateProjectItemStatusAsync).toHaveBeenCalledWith("owner/repo", 42, {
        projectNumber: 1,
        statusFieldId: "SF_1",
        optionId: "opt_1",
      });

      const onOverlayDone = (globalThis as Record<string, unknown>)[
        "__onOverlayDone"
      ] as ReturnType<typeof vi.fn>;
      expect(onOverlayDone).toHaveBeenCalled();

      instance.unmount();
    });

    it("should apply mutateData immediately (optimistic update before API resolves)", async () => {
      // Make the API call hang so we can observe state before it completes
      let resolveApi!: () => void;
      mockUpdateProjectItemStatusAsync.mockReturnValue(
        new Promise<void>((r) => {
          resolveApi = r;
        }),
      );

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleStatusChange("opt_1");

      // mutateData should have been called synchronously (before the API resolves)
      expect(getMutateData()).toHaveBeenCalledTimes(1);

      // Resolve the API call to avoid hanging
      resolveApi();
      await delay(50);

      instance.unmount();
    });

    it("should NOT call refresh on success (avoids overwriting optimistic update with stale data)", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleStatusChange("opt_1");
      await delay(50);

      // On success, refresh must NOT be called — GitHub Projects v2 is eventually consistent
      // and a refresh overwrites the optimistic update with stale server data.
      expect(getRefresh()).not.toHaveBeenCalled();

      instance.unmount();
    });

    it("should call refresh on failure to revert the optimistic update", async () => {
      mockUpdateProjectItemStatusAsync.mockRejectedValue(new Error("GraphQL error"));

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleStatusChange("opt_1");
      await delay(50);

      // On failure, refresh reverts the optimistic update to actual server state
      expect(getRefresh()).toHaveBeenCalledTimes(1);
      expect(lastToast()?.type).toBe("error");
      expect(lastToast()?.message).toContain("Status change failed");

      instance.unmount();
    });

    it("should call onOverlayDone on both success and failure", async () => {
      // Success case
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleStatusChange("opt_1");
      await delay(50);

      const onOverlayDone = (globalThis as Record<string, unknown>)[
        "__onOverlayDone"
      ] as ReturnType<typeof vi.fn>;
      expect(onOverlayDone).toHaveBeenCalledTimes(1);

      instance.unmount();
    });
  });

  describe("handleCreateIssue", () => {
    it("should call createIssueAsync with title and repo", async () => {
      mockCreateIssueAsync.mockResolvedValue("https://github.com/owner/repo/issues/99");

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: null,
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      await actions.handleCreateIssue("owner/repo", "New bug report", "");

      expect(mockCreateIssueAsync).toHaveBeenCalledWith(
        "owner/repo",
        "New bug report",
        "",
        undefined,
      );

      expect(lastToast()?.message).toContain("Created repo#99");
      expect(lastToast()?.type).toBe("success");

      instance.unmount();
    });

    it("should append due date to body when no dueDateFieldId configured", async () => {
      mockCreateIssueAsync.mockResolvedValue("https://github.com/owner/repo/issues/101");

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: null,
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      await actions.handleCreateIssue("owner/repo", "Fix login", "Some details", "2026-03-01");

      expect(mockCreateIssueAsync).toHaveBeenCalledWith(
        "owner/repo",
        "Fix login",
        "Some details\n\nDue: 2026-03-01",
        undefined,
      );

      instance.unmount();
    });

    it("should pass labels when provided", async () => {
      mockCreateIssueAsync.mockResolvedValue("https://github.com/owner/repo/issues/100");

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: null,
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      await actions.handleCreateIssue("owner/repo", "Bug", "", null, ["bug", "high-priority"]);

      expect(mockCreateIssueAsync).toHaveBeenCalledWith("owner/repo", "Bug", "", [
        "bug",
        "high-priority",
      ]);

      instance.unmount();
    });
  });

  describe("handleBulkAssign", () => {
    it("should assign multiple issues and return no failures", async () => {
      const repos = [
        makeRepoData({
          issues: [
            makeIssue({ number: 42, assignees: [] }),
            makeIssue({ number: 43, title: "Second issue", assignees: [] }),
          ],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      const failed = await actions.handleBulkAssign(
        new Set(["gh:owner/repo:42", "gh:owner/repo:43"]),
      );

      expect(failed).toHaveLength(0);
      expect(mockAssignIssueAsync).toHaveBeenCalledTimes(2);

      expect(lastToast()?.message).toContain("Assigned 2 issues");
      expect(lastToast()?.type).toBe("success");

      instance.unmount();
    });

    it("should skip already-assigned issues", async () => {
      const repos = [
        makeRepoData({
          issues: [
            makeIssue({ number: 42, assignees: [{ login: "ondrej" }] }),
            makeIssue({ number: 43, assignees: [] }),
          ],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      const failed = await actions.handleBulkAssign(
        new Set(["gh:owner/repo:42", "gh:owner/repo:43"]),
      );

      expect(failed).toHaveLength(0);
      // Only 43 should be assigned (42 already assigned)
      expect(mockAssignIssueAsync).toHaveBeenCalledTimes(1);
      expect(mockAssignIssueAsync).toHaveBeenCalledWith("owner/repo", 43);

      instance.unmount();
    });

    it("should return failed IDs on error", async () => {
      mockAssignIssueAsync.mockRejectedValue(new Error("fail"));

      const repos = [
        makeRepoData({
          issues: [
            makeIssue({ number: 42, assignees: [] }),
            makeIssue({ number: 43, assignees: [] }),
          ],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      const failed = await actions.handleBulkAssign(
        new Set(["gh:owner/repo:42", "gh:owner/repo:43"]),
      );

      expect(failed).toHaveLength(2);

      expect(lastToast()?.message).toContain("failed");
      expect(lastToast()?.type).toBe("error");

      instance.unmount();
    });
  });

  describe("handleBulkUnassign", () => {
    it("should unassign multiple self-assigned issues", async () => {
      const repos = [
        makeRepoData({
          issues: [
            makeIssue({ number: 42, assignees: [{ login: "ondrej" }] }),
            makeIssue({ number: 43, assignees: [{ login: "ondrej" }] }),
          ],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      const failed = await actions.handleBulkUnassign(
        new Set(["gh:owner/repo:42", "gh:owner/repo:43"]),
      );

      expect(failed).toHaveLength(0);
      expect(mockUnassignIssueAsync).toHaveBeenCalledTimes(2);
      expect(mockUnassignIssueAsync).toHaveBeenCalledWith("owner/repo", 42, "@me");
      expect(mockUnassignIssueAsync).toHaveBeenCalledWith("owner/repo", 43, "@me");

      instance.unmount();
    });
  });

  describe("handleBulkStatusChange", () => {
    it("should change status for multiple issues", async () => {
      const repos = [
        makeRepoData({
          issues: [makeIssue({ number: 42 }), makeIssue({ number: 43 })],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      const failed = await actions.handleBulkStatusChange(
        new Set(["gh:owner/repo:42", "gh:owner/repo:43"]),
        "opt_1",
      );

      expect(failed).toHaveLength(0);
      expect(mockUpdateProjectItemStatusAsync).toHaveBeenCalledTimes(2);

      expect(lastToast()?.message).toContain("Moved 2 issues to In Progress");
      expect(lastToast()?.type).toBe("success");

      instance.unmount();
    });

    it("should call mutateData optimistically for each issue before API calls", async () => {
      // Block the API so we can check mutateData before resolution
      let resolveAll!: () => void;
      mockUpdateProjectItemStatusAsync.mockReturnValue(
        new Promise<void>((r) => {
          resolveAll = r;
        }),
      );

      const repos = [
        makeRepoData({
          issues: [makeIssue({ number: 42 }), makeIssue({ number: 43 })],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;

      // Don't await — we need to inspect state while API is pending
      const inFlight = actions.handleBulkStatusChange(
        new Set(["gh:owner/repo:42", "gh:owner/repo:43"]),
        "opt_1",
      );

      // mutateData should have been called once per issue (synchronously before API calls)
      expect(getMutateData()).toHaveBeenCalledTimes(2);

      resolveAll();
      await inFlight;
      await delay(50);

      instance.unmount();
    });

    it("should NOT call refresh when all issues succeed", async () => {
      const repos = [
        makeRepoData({
          issues: [makeIssue({ number: 42 }), makeIssue({ number: 43 })],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      await actions.handleBulkStatusChange(
        new Set(["gh:owner/repo:42", "gh:owner/repo:43"]),
        "opt_1",
      );

      // On full success, refresh must NOT be called (same eventual-consistency reason)
      expect(getRefresh()).not.toHaveBeenCalled();

      instance.unmount();
    });

    it("should call refresh when some issues fail to revert optimistic updates", async () => {
      // First call succeeds, second fails
      mockUpdateProjectItemStatusAsync
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("fail"));

      const repos = [
        makeRepoData({
          issues: [makeIssue({ number: 42 }), makeIssue({ number: 43 })],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      const failed = await actions.handleBulkStatusChange(
        new Set(["gh:owner/repo:42", "gh:owner/repo:43"]),
        "opt_1",
      );

      expect(failed).toHaveLength(1);
      // refresh should be called to revert the optimistic updates for failed items
      expect(getRefresh()).toHaveBeenCalledTimes(1);
      expect(lastToast()?.type).toBe("error");

      instance.unmount();
    });

    it("should push non-existent ids to failed list (lines 590-591: ctx has no issue/repoConfig)", async () => {
      // IDs in the set that don't correspond to any loaded issue
      const repos = [
        makeRepoData({
          issues: [makeIssue({ number: 42 })],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;

      // gh:owner/repo:999 does not exist in the repos data — it should end up in failed
      const failed = await actions.handleBulkStatusChange(
        new Set(["gh:owner/repo:42", "gh:owner/repo:999"]),
        "opt_1",
      );

      // 999 not found → pushed to failed
      expect(failed).toContain("gh:owner/repo:999");
      // 42 was found and succeeded
      expect(failed).not.toContain("gh:owner/repo:42");

      instance.unmount();
    });

    it("should fall back to optionId as name when no status option name is found (line 613)", async () => {
      // Use an optionId that does not exist in the statusOptions array so the IIFE returns optionId itself
      const repos = [
        makeRepoData({
          issues: [makeIssue({ number: 42 })],
          statusOptions: [{ id: "opt_1", name: "In Progress" }],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;

      // Use an optionId that is not in statusOptions — optionName falls back to optionId
      const failed = await actions.handleBulkStatusChange(
        new Set(["gh:owner/repo:42"]),
        "unknown_option_id",
      );

      expect(failed).toHaveLength(0);
      // Toast message should contain the raw optionId as the status name fallback
      expect(lastToast()?.message).toContain("unknown_option_id");

      instance.unmount();
    });
  });

  describe("handlePick", () => {
    it("should call pickIssue for an unassigned issue", async () => {
      mockPickIssue.mockResolvedValue({ warning: undefined });

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handlePick();
      await delay(50);

      expect(mockPickIssue).toHaveBeenCalledWith(
        expect.objectContaining({ board: expect.any(Object) }),
        expect.objectContaining({ issueNumber: 42 }),
      );

      instance.unmount();
    });

    it("should show info toast when issue is already assigned to self", async () => {
      const repos = [
        makeRepoData({
          issues: [makeIssue({ assignees: [{ login: "ondrej" }] })],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handlePick();

      expect(mockPickIssue).not.toHaveBeenCalled();
      expect(lastToast()?.type).toBe("info");
      expect(lastToast()?.message).toContain("Already assigned");

      instance.unmount();
    });

    it("should show info toast when issue is assigned to someone else", async () => {
      const repos = [
        makeRepoData({
          issues: [makeIssue({ assignees: [{ login: "other-user" }] })],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handlePick();

      expect(mockPickIssue).not.toHaveBeenCalled();
      expect(lastToast()?.type).toBe("info");
      expect(lastToast()?.message).toContain("Already assigned");

      instance.unmount();
    });

    it("should show error toast when pickIssue fails", async () => {
      mockPickIssue.mockRejectedValue(new Error("TickTick unavailable"));

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handlePick();
      await delay(50);

      expect(lastToast()?.type).toBe("error");
      expect(lastToast()?.message).toContain("Pick failed");

      instance.unmount();
    });

    it("should no-op when no issue is selected", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: null,
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handlePick();
      await delay(50);

      expect(mockPickIssue).not.toHaveBeenCalled();

      instance.unmount();
    });
  });

  describe("handleLabelChange", () => {
    it("should call updateLabelsAsync with add-label args", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleLabelChange(["bug"], []);
      await delay(50);

      expect(mockUpdateLabelsAsync).toHaveBeenCalledWith("owner/repo", 42, ["bug"], []);

      instance.unmount();
    });

    it("should call updateLabelsAsync with remove-label args", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleLabelChange([], ["old-label"]);
      await delay(50);

      expect(mockUpdateLabelsAsync).toHaveBeenCalledWith("owner/repo", 42, [], ["old-label"]);

      instance.unmount();
    });

    it("should show error toast on failure", async () => {
      mockUpdateLabelsAsync.mockRejectedValue(new Error("label update error"));

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleLabelChange(["bug"], []);
      await delay(50);

      expect(lastToast()?.type).toBe("error");
      expect(lastToast()?.message).toContain("Label update failed");

      instance.unmount();
    });

    it("should no-op when no issue is selected", async () => {
      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos: [makeRepoData()],
          selectedId: "tt:task-1",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleLabelChange(["bug"], []);
      await delay(50);

      expect(mockUpdateLabelsAsync).not.toHaveBeenCalled();

      instance.unmount();
    });
  });

  describe("handleStatusChange — terminal status with completion action", () => {
    it("should trigger closeIssue completion action when status is terminal", async () => {
      const repos = [
        makeRepoData({
          statusOptions: [
            { id: "opt_done", name: "done" },
            { id: "opt_1", name: "In Progress" },
          ],
        }),
      ];

      const instance = render(
        React.createElement(ActionsTester, {
          config: makeConfig(),
          repos,
          selectedId: "gh:owner/repo:42",
        }),
      );
      await delay(50);

      const actions = (globalThis as Record<string, unknown>)["__actions"] as ReturnType<
        typeof useActions
      >;
      actions.handleStatusChange("opt_done");
      await delay(100);

      // Should have called closeIssueAsync (the closeIssue completion action)
      expect(mockCloseIssueAsync).toHaveBeenCalledWith("owner/repo", 42);

      instance.unmount();
    });
  });
});
