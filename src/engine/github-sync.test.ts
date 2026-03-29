/**
 * Tests for the GitHub sync bridge.
 * Phase transitions push labels/status/comments to linked GitHub issues.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoConfig } from "../config.js";
import type { Pipeline } from "./conductor.js";

// Mock github.ts functions
vi.mock("../github.js", () => ({
  addLabelAsync: vi.fn().mockResolvedValue(undefined),
  removeLabelAsync: vi.fn().mockResolvedValue(undefined),
  updateProjectItemStatusAsync: vi.fn().mockResolvedValue(undefined),
  closeIssueAsync: vi.fn().mockResolvedValue(undefined),
  addCommentAsync: vi.fn().mockResolvedValue(undefined),
  fetchProjectStatusOptions: vi.fn().mockReturnValue([
    { id: "opt-1", name: "In Progress" },
    { id: "opt-2", name: "Done" },
  ]),
}));

const { addLabelAsync, removeLabelAsync, closeIssueAsync, addCommentAsync } = await import(
  "../github.js"
);

// Import after mocks
const { GitHubSync } = await import("./github-sync.js");

// ── Test Fixtures ──

const REPO_CONFIG: RepoConfig = {
  name: "owner/repo",
  shortName: "repo",
  projectNumber: 1,
  statusFieldId: "SF_1",
  localPath: "/tmp/repo",
  completionAction: { type: "closeIssue" as const },
};

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    featureId: "feat-001",
    title: "Add auth",
    repo: "owner/repo",
    localPath: "/tmp/repo",
    repoConfig: REPO_CONFIG,
    beadIds: {
      brainstorm: "bd-b1",
      stories: "bd-s1",
      scaffold: "bd-sc1",
      tests: "bd-t1",
      impl: "bd-i1",
      redteam: "bd-r1",
      merge: "bd-m1",
    },
    status: "running",
    completedBeads: 0,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ──

describe("GitHubSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds phase label on phase completion", async () => {
    const sync = new GitHubSync({
      phaseToLabel: {
        stories: "phase:stories",
        test: "phase:red",
        impl: "phase:green",
        redteam: "phase:review",
        merge: "phase:merge",
      },
    });

    await sync.onPhaseCompleted(makePipeline(), "stories", "owner/repo", 42);

    expect(addLabelAsync).toHaveBeenCalledWith("owner/repo", 42, "phase:stories");
  });

  it("removes previous phase label when advancing", async () => {
    const sync = new GitHubSync({
      phaseToLabel: {
        stories: "phase:stories",
        scaffold: "phase:scaffold",
        test: "phase:red",
      },
    });

    await sync.onPhaseCompleted(makePipeline(), "test", "owner/repo", 42);

    // Should remove the scaffold label (previous phase) and add the test label
    expect(removeLabelAsync).toHaveBeenCalledWith("owner/repo", 42, "phase:scaffold");
    expect(addLabelAsync).toHaveBeenCalledWith("owner/repo", 42, "phase:red");
  });

  it("does nothing when no GitHub issue is linked", async () => {
    const sync = new GitHubSync({
      phaseToLabel: { stories: "phase:stories" },
    });

    // issueNumber 0 means no issue linked
    await sync.onPhaseCompleted(makePipeline(), "stories", "", 0);

    expect(addLabelAsync).not.toHaveBeenCalled();
  });

  it("does nothing when no sync config is provided", async () => {
    const sync = new GitHubSync({});

    await sync.onPhaseCompleted(makePipeline(), "stories", "owner/repo", 42);

    expect(addLabelAsync).not.toHaveBeenCalled();
  });

  it("triggers completion action on merge phase", async () => {
    const pipeline = makePipeline({
      repoConfig: { ...REPO_CONFIG, completionAction: { type: "closeIssue" } },
    });
    const sync = new GitHubSync({ triggerCompletionAction: true });

    await sync.onPhaseCompleted(pipeline, "merge", "owner/repo", 42);

    expect(closeIssueAsync).toHaveBeenCalledWith("owner/repo", 42);
  });

  it("posts comment when syncComments is true", async () => {
    const sync = new GitHubSync({ syncComments: true });

    await sync.onPhaseCompleted(makePipeline(), "test", "owner/repo", 42);

    expect(addCommentAsync).toHaveBeenCalledWith("owner/repo", 42, expect.stringContaining("test"));
  });

  it("does not block pipeline when GitHub API call fails", async () => {
    vi.mocked(addLabelAsync).mockRejectedValueOnce(new Error("API rate limit"));

    const sync = new GitHubSync({
      phaseToLabel: { stories: "phase:stories" },
    });

    // Should not throw
    await expect(
      sync.onPhaseCompleted(makePipeline(), "stories", "owner/repo", 42),
    ).resolves.toBeUndefined();
  });
});
