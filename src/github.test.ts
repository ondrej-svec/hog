import { beforeEach, describe, expect, it, vi } from "vitest";

// Must mock node:child_process before importing github.ts, because github.ts
// calls execFileSync at the top level via runGh/runGhJson.
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));

import { execFile, execFileSync } from "node:child_process";
import type { RepoDueDateConfig, RepoProjectConfig } from "./github.js";
import {
  addCommentAsync,
  addLabel,
  addLabelAsync,
  assignIssue,
  assignIssueAsync,
  assignIssueToAsync,
  clearProjectNodeIdCache,
  fetchAssignedIssues,
  fetchIssueAsync,
  fetchIssueCommentsAsync,
  fetchProjectEnrichment,
  fetchProjectFields,
  fetchProjectStatusOptions,
  fetchProjectTargetDates,
  fetchRepoIssues,
  fetchRepoLabelsAsync,
  removeLabelAsync,
  unassignIssueAsync,
  updateProjectItemDateAsync,
  updateProjectItemStatus,
  updateProjectItemStatusAsync,
} from "./github.js";

// execFileSync is synchronous; execFile is callback-based (used via promisify).
const mockExecFileSync = vi.mocked(execFileSync);
const mockExecFile = vi.mocked(execFile);

// Helper: make execFile call its callback with a given stdout value.
// Note: vi.fn() mocks do NOT carry Node's [util.promisify.custom] symbol that
// the real execFile has.  Without that symbol, promisify uses standard
// callback lifting: the second callback argument becomes the resolved value.
// runGhAsync destructures `{ stdout }` from that value, so we must pass an
// object `{ stdout, stderr }` as the second callback argument.
function resolveExecFile(stdout: string) {
  mockExecFile.mockImplementation(
    // biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is loose
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: any) => {
      callback(null, { stdout, stderr: "" });
      // biome-ignore lint/suspicious/noExplicitAny: return value not used
      return {} as any;
    },
  );
}

function rejectExecFile(message: string) {
  mockExecFile.mockImplementation(
    // biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is loose
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: any) => {
      callback(new Error(message), { stdout: "", stderr: "" });
      // biome-ignore lint/suspicious/noExplicitAny: return value not used
      return {} as any;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// fetchAssignedIssues
// ---------------------------------------------------------------------------
describe("fetchAssignedIssues", () => {
  it("returns parsed issues for the given repo and assignee", () => {
    const issues = [
      {
        number: 1,
        title: "Fix bug",
        url: "https://github.com/org/repo/issues/1",
        state: "open",
        updatedAt: "2026-02-01T00:00:00Z",
        labels: [],
      },
    ];
    mockExecFileSync.mockReturnValue(JSON.stringify(issues));

    const result = fetchAssignedIssues("org/repo", "alice");

    expect(result).toEqual(issues);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["issue", "list", "--repo", "org/repo", "--assignee", "alice"]),
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("returns an empty array when there are no assigned issues", () => {
    mockExecFileSync.mockReturnValue("[]");

    const result = fetchAssignedIssues("org/repo", "alice");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchRepoIssues
// ---------------------------------------------------------------------------
describe("fetchRepoIssues", () => {
  it("returns issues with default options (open, limit 100)", () => {
    const issues = [
      {
        number: 42,
        title: "Implement feature",
        url: "https://github.com/org/repo/issues/42",
        state: "open",
        updatedAt: "2026-02-10T00:00:00Z",
        labels: [{ name: "enhancement" }],
        assignees: [{ login: "bob" }],
      },
    ];
    mockExecFileSync.mockReturnValue(JSON.stringify(issues));

    const result = fetchRepoIssues("org/repo");

    expect(result).toEqual(issues);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--state", "open", "--limit", "100"]),
      expect.anything(),
    );
  });

  it("passes assignee filter when provided in options", () => {
    mockExecFileSync.mockReturnValue("[]");

    fetchRepoIssues("org/repo", { assignee: "carol" });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--assignee", "carol"]),
      expect.anything(),
    );
  });

  it("respects custom state and limit options", () => {
    mockExecFileSync.mockReturnValue("[]");

    fetchRepoIssues("org/repo", { state: "closed", limit: 50 });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--state", "closed", "--limit", "50"]),
      expect.anything(),
    );
  });

  it("returns empty array when repo has no issues", () => {
    mockExecFileSync.mockReturnValue("[]");

    const result = fetchRepoIssues("org/empty-repo");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assignIssue (sync)
// ---------------------------------------------------------------------------
describe("assignIssue", () => {
  it("calls gh issue edit with --add-assignee @me", () => {
    mockExecFileSync.mockReturnValue("");

    assignIssue("org/repo", 7);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "7", "--repo", "org/repo", "--add-assignee", "@me"],
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });
});

// ---------------------------------------------------------------------------
// assignIssueAsync
// ---------------------------------------------------------------------------
describe("assignIssueAsync", () => {
  it("resolves after calling gh issue edit with --add-assignee @me", async () => {
    resolveExecFile("");

    await assignIssueAsync("org/repo", 7);

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "7", "--repo", "org/repo", "--add-assignee", "@me"],
      expect.objectContaining({ encoding: "utf-8" }),
      expect.any(Function),
    );
  });

  it("rejects when gh CLI returns an error", async () => {
    rejectExecFile("gh: not found");

    await expect(assignIssueAsync("org/repo", 7)).rejects.toThrow("gh: not found");
  });
});

// ---------------------------------------------------------------------------
// assignIssueToAsync
// ---------------------------------------------------------------------------
describe("assignIssueToAsync", () => {
  it("assigns issue to the specified user", async () => {
    resolveExecFile("");

    await assignIssueToAsync("org/repo", 12, "dave");

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "12", "--repo", "org/repo", "--add-assignee", "dave"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// unassignIssueAsync
// ---------------------------------------------------------------------------
describe("unassignIssueAsync", () => {
  it("removes assignment for the specified user", async () => {
    resolveExecFile("");

    await unassignIssueAsync("org/repo", 12, "dave");

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "12", "--repo", "org/repo", "--remove-assignee", "dave"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// fetchIssueAsync
// ---------------------------------------------------------------------------
describe("fetchIssueAsync", () => {
  it("returns a parsed GitHubIssue", async () => {
    const issue = {
      number: 5,
      title: "Crash on startup",
      url: "https://github.com/org/repo/issues/5",
      state: "open",
      updatedAt: "2026-01-20T08:00:00Z",
      labels: [],
      assignees: [],
      body: "Steps to reproduce…",
    };
    resolveExecFile(JSON.stringify(issue));

    const result = await fetchIssueAsync("org/repo", 5);

    expect(result).toEqual(issue);
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["issue", "view", "5", "--repo", "org/repo"]),
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// fetchIssueCommentsAsync
// ---------------------------------------------------------------------------
describe("fetchIssueCommentsAsync", () => {
  it("returns the comments array from the issue view JSON", async () => {
    const comments = [
      { body: "LGTM", author: { login: "reviewer" }, createdAt: "2026-02-01T10:00:00Z" },
    ];
    resolveExecFile(JSON.stringify({ comments }));

    const result = await fetchIssueCommentsAsync("org/repo", 99);

    expect(result).toEqual(comments);
  });

  it("returns empty array when issue has no comments", async () => {
    resolveExecFile(JSON.stringify({ comments: [] }));

    const result = await fetchIssueCommentsAsync("org/repo", 99);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchProjectFields
// ---------------------------------------------------------------------------
describe("fetchProjectFields", () => {
  function makeProjectFieldsResponse(overrides: {
    targetDate?: string;
    status?: string;
    projectNumber?: number;
  }) {
    const { targetDate, status, projectNumber = 10 } = overrides;
    const fieldValues: unknown[] = [];
    if (targetDate) {
      fieldValues.push({ field: { name: "Target Date" }, date: targetDate });
    }
    if (status) {
      fieldValues.push({ field: { name: "Status" }, name: status });
    }
    return {
      data: {
        repository: {
          issue: {
            projectItems: {
              nodes: [
                {
                  project: { number: projectNumber },
                  fieldValues: { nodes: fieldValues },
                },
              ],
            },
          },
        },
      },
    };
  }

  it("extracts targetDate and status from project fields", () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify(
        makeProjectFieldsResponse({ targetDate: "2026-03-15", status: "In Progress" }),
      ),
    );

    const result = fetchProjectFields("org/repo", 1, 10);

    expect(result.targetDate).toBe("2026-03-15");
    expect(result.status).toBe("In Progress");
  });

  it("returns empty object when project item is not found", () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify(makeProjectFieldsResponse({ targetDate: "2026-03-15", projectNumber: 999 })),
    );

    // Issue belongs to project 999 but we ask for project 10
    const result = fetchProjectFields("org/repo", 1, 10);

    expect(result).toEqual({});
  });

  it("returns empty object when gh CLI throws", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("gh: command not found");
    });

    const result = fetchProjectFields("org/repo", 1, 10);

    expect(result).toEqual({});
  });

  it("returns empty object when issue has no project items", () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify({ data: { repository: { issue: { projectItems: { nodes: [] } } } } }),
    );

    const result = fetchProjectFields("org/repo", 1, 10);

    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// fetchProjectEnrichment
// ---------------------------------------------------------------------------
describe("fetchProjectEnrichment", () => {
  function makeEnrichmentResponse(
    items: Array<{
      issueNumber?: number;
      targetDate?: string;
      status?: string;
    }>,
    pageInfo: { hasNextPage: boolean; endCursor?: string } = { hasNextPage: false },
  ) {
    return {
      data: {
        organization: {
          projectV2: {
            items: {
              pageInfo,
              nodes: items.map(({ issueNumber, targetDate, status }) => {
                const fieldValues: unknown[] = [];
                if (targetDate) {
                  fieldValues.push({ field: { name: "Target Date" }, date: targetDate });
                }
                if (status) {
                  fieldValues.push({ field: { name: "Status" }, name: status });
                }
                return {
                  content: issueNumber !== undefined ? { number: issueNumber } : {},
                  fieldValues: { nodes: fieldValues },
                };
              }),
            },
          },
        },
      },
    };
  }

  it("returns a map of issue number to enrichment data", () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify(
        makeEnrichmentResponse([
          { issueNumber: 1, targetDate: "2026-03-01", status: "In Progress" },
          { issueNumber: 2, status: "Done" },
        ]),
      ),
    );

    const result = fetchProjectEnrichment("org/repo", 5);

    expect(result.get(1)).toEqual({ targetDate: "2026-03-01", projectStatus: "In Progress" });
    expect(result.get(2)).toEqual({ projectStatus: "Done" });
  });

  it("returns empty map when project has no items", () => {
    mockExecFileSync.mockReturnValue(JSON.stringify(makeEnrichmentResponse([])));

    const result = fetchProjectEnrichment("org/repo", 5);

    expect(result.size).toBe(0);
  });

  it("returns empty map when gh CLI throws", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("network error");
    });

    const result = fetchProjectEnrichment("org/repo", 5);

    expect(result.size).toBe(0);
  });

  it("skips items without an issue number", () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify(
        makeEnrichmentResponse([
          { status: "Done" }, // no issueNumber
          { issueNumber: 3, status: "Todo" },
        ]),
      ),
    );

    const result = fetchProjectEnrichment("org/repo", 5);

    expect(result.size).toBe(1);
    expect(result.get(3)).toEqual({ projectStatus: "Todo" });
  });

  it("paginates through multiple pages", () => {
    mockExecFileSync
      .mockReturnValueOnce(
        JSON.stringify(
          makeEnrichmentResponse([{ issueNumber: 1, status: "In Progress" }], {
            hasNextPage: true,
            endCursor: "cursor1",
          }),
        ),
      )
      .mockReturnValueOnce(
        JSON.stringify(
          makeEnrichmentResponse([{ issueNumber: 2, status: "Review" }], { hasNextPage: false }),
        ),
      );

    const result = fetchProjectEnrichment("org/repo", 5);

    expect(result.size).toBe(2);
    expect(result.get(1)).toEqual({ projectStatus: "In Progress" });
    expect(result.get(2)).toEqual({ projectStatus: "Review" });
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// fetchProjectTargetDates
// ---------------------------------------------------------------------------
describe("fetchProjectTargetDates", () => {
  it("returns only issues that have a target date", () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify({
        data: {
          organization: {
            projectV2: {
              items: {
                nodes: [
                  {
                    content: { number: 10 },
                    fieldValues: {
                      nodes: [{ field: { name: "Target Date" }, date: "2026-04-01" }],
                    },
                  },
                  {
                    content: { number: 11 },
                    fieldValues: { nodes: [] },
                  },
                ],
              },
            },
          },
        },
      }),
    );

    const result = fetchProjectTargetDates("org/repo", 1);

    expect(result.get(10)).toBe("2026-04-01");
    expect(result.has(11)).toBe(false);
  });

  it("returns empty map when no issues have target dates", () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify({
        data: {
          organization: { projectV2: { items: { nodes: [] } } },
        },
      }),
    );

    const result = fetchProjectTargetDates("org/repo", 1);

    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchProjectStatusOptions
// ---------------------------------------------------------------------------
describe("fetchProjectStatusOptions", () => {
  it("returns status options from project field", () => {
    const options = [
      { id: "opt-1", name: "Todo" },
      { id: "opt-2", name: "In Progress" },
      { id: "opt-3", name: "Done" },
    ];
    mockExecFileSync.mockReturnValue(
      JSON.stringify({
        data: {
          organization: {
            projectV2: { field: { options } },
          },
        },
      }),
    );

    const result = fetchProjectStatusOptions("org/repo", 1, "PVTSSF_field");

    expect(result).toEqual(options);
  });

  it("returns empty array when there are no status options", () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify({ data: { organization: { projectV2: { field: { options: [] } } } } }),
    );

    const result = fetchProjectStatusOptions("org/repo", 1, "PVTSSF_field");

    expect(result).toEqual([]);
  });

  it("returns empty array when gh CLI throws", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("authentication required");
    });

    const result = fetchProjectStatusOptions("org/repo", 1, "PVTSSF_field");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addLabel (sync)
// ---------------------------------------------------------------------------
describe("addLabel", () => {
  it("calls gh issue edit with --add-label", () => {
    mockExecFileSync.mockReturnValue("");

    addLabel("org/repo", 3, "bug");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "3", "--repo", "org/repo", "--add-label", "bug"],
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });
});

// ---------------------------------------------------------------------------
// fetchRepoLabelsAsync
// ---------------------------------------------------------------------------
describe("fetchRepoLabelsAsync", () => {
  it("returns label list with name and color", async () => {
    const labels = [
      { name: "bug", color: "d73a4a" },
      { name: "enhancement", color: "a2eeef" },
    ];
    resolveExecFile(JSON.stringify(labels));

    const result = await fetchRepoLabelsAsync("org/repo");

    expect(result).toEqual(labels);
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["label", "list", "--repo", "org/repo"]),
      expect.anything(),
      expect.any(Function),
    );
  });

  it("returns empty array when repo has no labels", async () => {
    resolveExecFile("[]");

    const result = await fetchRepoLabelsAsync("org/repo");

    expect(result).toEqual([]);
  });

  it("returns empty array when gh CLI throws", async () => {
    rejectExecFile("gh: API error");

    const result = await fetchRepoLabelsAsync("org/repo");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateProjectItemStatus (sync)
// ---------------------------------------------------------------------------
describe("updateProjectItemStatus", () => {
  const projectConfig: RepoProjectConfig = {
    projectNumber: 10,
    statusFieldId: "PVTSSF_status",
    optionId: "opt-done",
  };

  function mockFindItemCall(projectNumber: number, itemId: string) {
    return JSON.stringify({
      data: {
        repository: {
          issue: {
            projectItems: {
              nodes: [{ id: itemId, project: { number: projectNumber } }],
            },
          },
        },
      },
    });
  }

  function mockProjectIdCall(id: string) {
    return JSON.stringify({
      data: { organization: { projectV2: { id } } },
    });
  }

  it("performs find-item, get-project-id, and mutation calls in sequence", () => {
    mockExecFileSync
      .mockReturnValueOnce(mockFindItemCall(10, "PVTI_item_001"))
      .mockReturnValueOnce(mockProjectIdCall("PVT_proj_001"))
      .mockReturnValueOnce(""); // mutation

    updateProjectItemStatus("org/repo", 42, projectConfig);

    expect(mockExecFileSync).toHaveBeenCalledTimes(3);
    // First call: find item
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      "gh",
      expect.arrayContaining(["api", "graphql"]),
      expect.anything(),
    );
    // Third call: mutation — should include the itemId and optionId
    const thirdCallArgs = mockExecFileSync.mock.calls[2]?.[1] as string[];
    expect(thirdCallArgs).toContain("itemId=PVTI_item_001");
    expect(thirdCallArgs).toContain("optionId=opt-done");
  });

  it("does nothing when the issue has no project item for the given project number", () => {
    mockExecFileSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [{ id: "PVTI_other", project: { number: 999 } }],
              },
            },
          },
        },
      }),
    );

    updateProjectItemStatus("org/repo", 42, projectConfig);

    // Only the find-item call should have been made; no project-id or mutation
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no project ID is returned", () => {
    mockExecFileSync
      .mockReturnValueOnce(mockFindItemCall(10, "PVTI_item_002"))
      .mockReturnValueOnce(JSON.stringify({ data: { organization: { projectV2: { id: null } } } }));

    updateProjectItemStatus("org/repo", 42, projectConfig);

    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// updateProjectItemStatusAsync
// ---------------------------------------------------------------------------
describe("updateProjectItemStatusAsync", () => {
  const projectConfig: RepoProjectConfig = {
    projectNumber: 10,
    statusFieldId: "PVTSSF_status",
    optionId: "opt-in-progress",
  };

  beforeEach(() => {
    clearProjectNodeIdCache();
  });

  it("resolves after performing all three async gh calls", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is loose
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: any) => {
        callCount += 1;
        if (callCount === 1) {
          // find-item
          callback(null, {
            stdout: JSON.stringify({
              data: {
                repository: {
                  issue: {
                    projectItems: {
                      nodes: [{ id: "PVTI_async_001", project: { number: 10 } }],
                    },
                  },
                },
              },
            }),
            stderr: "",
          });
        } else if (callCount === 2) {
          // project id
          callback(null, {
            stdout: JSON.stringify({
              data: { organization: { projectV2: { id: "PVT_async_proj" } } },
            }),
            stderr: "",
          });
        } else {
          // mutation
          callback(null, { stdout: "{}", stderr: "" });
        }
        // biome-ignore lint/suspicious/noExplicitAny: return value not used
        return {} as any;
      },
    );

    await updateProjectItemStatusAsync("org/repo", 88, projectConfig);

    expect(mockExecFile).toHaveBeenCalledTimes(3);
  });

  it("resolves early when no matching project item is found", async () => {
    resolveExecFile(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [{ id: "PVTI_other", project: { number: 999 } }],
              },
            },
          },
        },
      }),
    );

    await updateProjectItemStatusAsync("org/repo", 88, projectConfig);

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// addCommentAsync
// ---------------------------------------------------------------------------
describe("addCommentAsync", () => {
  it("calls gh issue comment with the correct arguments", async () => {
    resolveExecFile("");

    await addCommentAsync("org/repo", 10, "Great work!");

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "comment", "10", "--repo", "org/repo", "--body", "Great work!"],
      expect.objectContaining({ encoding: "utf-8" }),
      expect.any(Function),
    );
  });

  it("rejects when gh CLI returns an error", async () => {
    rejectExecFile("gh: API error");

    await expect(addCommentAsync("org/repo", 10, "oops")).rejects.toThrow("gh: API error");
  });
});

// ---------------------------------------------------------------------------
// addLabelAsync
// ---------------------------------------------------------------------------
describe("addLabelAsync", () => {
  it("calls gh issue edit with --add-label", async () => {
    resolveExecFile("");

    await addLabelAsync("org/repo", 5, "bug");

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "5", "--repo", "org/repo", "--add-label", "bug"],
      expect.objectContaining({ encoding: "utf-8" }),
      expect.any(Function),
    );
  });

  it("rejects when gh CLI returns an error", async () => {
    rejectExecFile("gh: label not found");

    await expect(addLabelAsync("org/repo", 5, "bug")).rejects.toThrow("gh: label not found");
  });
});

// ---------------------------------------------------------------------------
// removeLabelAsync
// ---------------------------------------------------------------------------
describe("removeLabelAsync", () => {
  it("calls gh issue edit with --remove-label", async () => {
    resolveExecFile("");

    await removeLabelAsync("org/repo", 7, "wontfix");

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "7", "--repo", "org/repo", "--remove-label", "wontfix"],
      expect.objectContaining({ encoding: "utf-8" }),
      expect.any(Function),
    );
  });

  it("rejects when gh CLI returns an error", async () => {
    rejectExecFile("gh: permission denied");

    await expect(removeLabelAsync("org/repo", 7, "wontfix")).rejects.toThrow(
      "gh: permission denied",
    );
  });
});

// ---------------------------------------------------------------------------
// updateProjectItemDateAsync
// ---------------------------------------------------------------------------
describe("updateProjectItemDateAsync", () => {
  const projectConfig: RepoDueDateConfig = {
    projectNumber: 10,
    dueDateFieldId: "PVTF_due_date",
  };

  beforeEach(() => {
    clearProjectNodeIdCache();
  });

  function makeFindItemResponse(projectNumber: number, itemId: string) {
    return JSON.stringify({
      data: {
        repository: {
          issue: {
            projectItems: {
              nodes: [{ id: itemId, project: { number: projectNumber } }],
            },
          },
        },
      },
    });
  }

  function makeProjectIdResponse(id: string | null) {
    return JSON.stringify({
      data: { organization: { projectV2: { id } } },
    });
  }

  it("performs find-item, get-project-id, and mutation calls in sequence", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is loose
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: any) => {
        callCount += 1;
        if (callCount === 1) {
          callback(null, { stdout: makeFindItemResponse(10, "PVTI_date_001"), stderr: "" });
        } else if (callCount === 2) {
          callback(null, { stdout: makeProjectIdResponse("PVT_date_proj"), stderr: "" });
        } else {
          callback(null, { stdout: "{}", stderr: "" });
        }
        // biome-ignore lint/suspicious/noExplicitAny: return value not used
        return {} as any;
      },
    );

    await updateProjectItemDateAsync("org/repo", 42, projectConfig, "2026-06-01");

    expect(mockExecFile).toHaveBeenCalledTimes(3);

    // Third call (mutation) must include the correct field values
    const thirdCallArgs = mockExecFile.mock.calls[2]?.[1] as string[];
    expect(thirdCallArgs).toContain("itemId=PVTI_date_001");
    expect(thirdCallArgs).toContain("fieldId=PVTF_due_date");
    expect(thirdCallArgs).toContain("date=2026-06-01");
  });

  it("returns early when no matching project item is found (wrong project number)", async () => {
    resolveExecFile(makeFindItemResponse(999, "PVTI_other"));

    await updateProjectItemDateAsync("org/repo", 42, projectConfig, "2026-06-01");

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("returns early when project items list is empty", async () => {
    resolveExecFile(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: { nodes: [] },
            },
          },
        },
      }),
    );

    await updateProjectItemDateAsync("org/repo", 42, projectConfig, "2026-06-01");

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("returns early when projectId is null", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is loose
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: any) => {
        callCount += 1;
        if (callCount === 1) {
          callback(null, { stdout: makeFindItemResponse(10, "PVTI_date_002"), stderr: "" });
        } else {
          callback(null, { stdout: makeProjectIdResponse(null), stderr: "" });
        }
        // biome-ignore lint/suspicious/noExplicitAny: return value not used
        return {} as any;
      },
    );

    await updateProjectItemDateAsync("org/repo", 42, projectConfig, "2026-06-01");

    // Only find-item and get-project-id; no mutation
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });
});
