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
vi.mock("../../github.js", () => ({
  assignIssueAsync: (...args: unknown[]) => mockAssignIssueAsync(...args),
  updateProjectItemStatusAsync: (...args: unknown[]) => mockUpdateProjectItemStatusAsync(...args),
}));

const mockPickIssue = vi.fn();
vi.mock("../../pick.js", () => ({
  pickIssue: (...args: unknown[]) => mockPickIssue(...args),
}));

// Mock execFile (callback-based, used via promisify)
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock("node:util", () => ({
  promisify:
    () =>
    (...args: unknown[]) => {
      // Return a promise that resolves/rejects based on mockExecFile behavior
      return new Promise((resolve, reject) => {
        try {
          const result = mockExecFile(...args);
          resolve(result ?? { stdout: "", stderr: "" });
        } catch (err) {
          reject(err);
        }
      });
    },
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

describe("useActions hook", () => {
  beforeEach(() => {
    mockAssignIssueAsync.mockReset().mockResolvedValue(undefined);
    mockUpdateProjectItemStatusAsync.mockReset().mockResolvedValue(undefined);
    mockPickIssue.mockReset();
    mockExecFile.mockReset().mockReturnValue({ stdout: "", stderr: "" });
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

  describe("handleUnassign", () => {
    it("should call execFile for self-assigned issue", async () => {
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
      actions.handleUnassign();
      await delay(50);

      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        ["issue", "edit", "42", "--repo", "owner/repo", "--remove-assignee", "@me"],
        expect.any(Object),
      );

      instance.unmount();
    });

    it("should show feedback when assigned to someone else", async () => {
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
      actions.handleUnassign();

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(lastToast()?.message).toContain("can only unassign self");
      expect(lastToast()?.type).toBe("info");

      instance.unmount();
    });
  });

  describe("handleComment", () => {
    it("should call execFile with comment args", async () => {
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

      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        ["issue", "comment", "42", "--repo", "owner/repo", "--body", "LGTM!"],
        expect.any(Object),
      );

      const onOverlayDone = (globalThis as Record<string, unknown>)[
        "__onOverlayDone"
      ] as ReturnType<typeof vi.fn>;
      expect(onOverlayDone).toHaveBeenCalled();

      instance.unmount();
    });

    it("should show error on failure", async () => {
      mockExecFile.mockImplementation(() => {
        throw new Error("Permission denied");
      });

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
  });

  describe("handleCreateIssue", () => {
    it("should call execFile with title and repo", async () => {
      mockExecFile.mockReturnValue({
        stdout: "https://github.com/owner/repo/issues/99\n",
        stderr: "",
      });

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

      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        ["issue", "create", "--repo", "owner/repo", "--title", "New bug report", "--body", ""],
        expect.any(Object),
      );

      expect(lastToast()?.message).toContain("Created repo#99");
      expect(lastToast()?.type).toBe("success");

      instance.unmount();
    });

    it("should append due date to body when no dueDateFieldId configured", async () => {
      mockExecFile.mockReturnValue({
        stdout: "https://github.com/owner/repo/issues/101\n",
        stderr: "",
      });

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

      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        [
          "issue",
          "create",
          "--repo",
          "owner/repo",
          "--title",
          "Fix login",
          "--body",
          "Some details\n\nDue: 2026-03-01",
        ],
        expect.any(Object),
      );

      instance.unmount();
    });

    it("should pass labels when provided", async () => {
      mockExecFile.mockReturnValue({
        stdout: "https://github.com/owner/repo/issues/100\n",
        stderr: "",
      });

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

      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        [
          "issue",
          "create",
          "--repo",
          "owner/repo",
          "--title",
          "Bug",
          "--body",
          "",
          "--label",
          "bug",
          "--label",
          "high-priority",
        ],
        expect.any(Object),
      );

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
      expect(mockExecFile).toHaveBeenCalledTimes(2);

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
  });
});
