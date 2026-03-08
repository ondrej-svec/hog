import { describe, expect, it } from "vitest";
import { findIssueByNavId, makeIssueNavId, parseIssueNavId } from "./board-utils.js";
import type { RepoData } from "./fetch.js";

// ── Helpers ──

function makeRepoData(repoName = "owner/repo", issueNumbers = [1, 2, 3]): RepoData {
  return {
    repo: {
      name: repoName,
      shortName: repoName.split("/")[1] ?? repoName,
      statusFieldId: "SF_1",
      projectNumber: 1,
      completionAction: { type: "closeIssue" as const },
    },
    issues: issueNumbers.map((n) => ({
      number: n,
      title: `Issue ${n}`,
      url: `https://github.com/${repoName}/issues/${n}`,
      state: "open" as const,
      updatedAt: "2026-01-01T00:00:00Z",
      labels: [],
      assignees: [],
      body: "",
    })),
    statusOptions: [],
    error: null,
  };
}

// ── Tests ──

describe("makeIssueNavId", () => {
  it("builds a canonical nav ID", () => {
    expect(makeIssueNavId("owner/repo", 42)).toBe("gh:owner/repo:42");
  });
});

describe("parseIssueNavId", () => {
  it("parses a valid nav ID", () => {
    const result = parseIssueNavId("gh:owner/repo:42");
    expect(result).toEqual({ repoName: "owner/repo", issueNumber: 42 });
  });

  it("returns null for non-gh prefixed IDs", () => {
    expect(parseIssueNavId("header:repo")).toBeNull();
    expect(parseIssueNavId("tt:task-1")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseIssueNavId(null)).toBeNull();
  });

  it("returns null for malformed IDs", () => {
    expect(parseIssueNavId("gh:")).toBeNull();
    expect(parseIssueNavId("gh:repo")).toBeNull();
  });

  it("returns null when issue number is not a number", () => {
    expect(parseIssueNavId("gh:repo:abc")).toBeNull();
  });
});

describe("findIssueByNavId", () => {
  it("finds an issue across repos", () => {
    const repos = [makeRepoData("org/a", [1, 2]), makeRepoData("org/b", [3, 4])];
    const result = findIssueByNavId(repos, "gh:org/b:4");
    expect(result).not.toBeNull();
    expect(result!.issue.number).toBe(4);
    expect(result!.repoName).toBe("org/b");
  });

  it("returns null for non-existent issue", () => {
    const repos = [makeRepoData()];
    expect(findIssueByNavId(repos, "gh:owner/repo:999")).toBeNull();
  });

  it("returns null for non-gh nav IDs", () => {
    const repos = [makeRepoData()];
    expect(findIssueByNavId(repos, "header:repo")).toBeNull();
    expect(findIssueByNavId(repos, null)).toBeNull();
  });

  it("returns null for empty repos array", () => {
    expect(findIssueByNavId([], "gh:owner/repo:1")).toBeNull();
  });
});
