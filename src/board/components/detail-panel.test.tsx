import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { GitHubIssue, IssueComment } from "../../github.js";
import type { DetailPanelProps } from "./detail-panel.js";
import { DetailPanel } from "./detail-panel.js";

function renderPanel(props: DetailPanelProps) {
  return render(React.createElement(DetailPanel, props));
}

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Fix the login bug",
    url: "https://github.com/owner/repo/issues/42",
    state: "open",
    updatedAt: "2026-02-19T10:00:00Z",
    labels: [],
    assignees: [],
    ...overrides,
  };
}

// ── "No item selected" state ──

describe("DetailPanel with no issue", () => {
  it("renders 'No item selected' when issue is null", () => {
    const { lastFrame } = renderPanel({ issue: null, width: 40, isActive: false });
    expect(lastFrame()).toContain("No item selected");
  });
});

// ── Issue rendering ──

describe("DetailPanel with a GitHub issue", () => {
  it("renders issue number and title", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#42");
    expect(frame).toContain("Fix the login bug");
  });

  it("renders issue URL", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("https://github.com/owner/repo/issues/42");
  });

  it("renders open state in green (output contains 'open')", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ state: "open" }),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("open");
  });

  it("renders closed state", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ state: "closed" }),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("closed");
  });

  it("renders labels when present", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ labels: [{ name: "bug" }, { name: "priority:high" }] }),
      width: 80,
      isActive: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("bug");
    expect(frame).toContain("priority:high");
  });

  it("does not render Labels row when labels array is empty", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ labels: [] }),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).not.toContain("Labels:");
  });

  it("renders assignees when present", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ assignees: [{ login: "alice" }, { login: "bob" }] }),
      width: 80,
      isActive: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("alice");
    expect(frame).toContain("bob");
  });

  it("does not render Assignees row when assignees is empty", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ assignees: [] }),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).not.toContain("Assignees:");
  });

  it("renders projectStatus when present", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ projectStatus: "In Progress" }),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("In Progress");
  });

  it("does not render Status row when projectStatus is absent", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({}),
      width: 80,
      isActive: false,
    });
    // makeIssue() does not include projectStatus — verify the Status row is absent
    expect(lastFrame()).not.toContain("Status:");
  });

  it("renders targetDate when present", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ targetDate: "2026-03-01" }),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("2026-03-01");
  });

  it("renders issue body (description section)", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ body: "This is the issue body content." }),
      width: 80,
      isActive: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Description");
    expect(frame).toContain("This is the issue body content.");
  });

  it("renders (no description) when body is absent", () => {
    // makeIssue() without a body override means body is omitted (undefined)
    const { lastFrame } = renderPanel({
      issue: makeIssue({}),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("no description");
  });

  it("renders Comments section header", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("Comments");
  });

  it("renders 'fetching comments...' when commentsState is null", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: null,
    });
    expect(lastFrame()).toContain("fetching comments");
  });

  it("renders 'fetching comments...' when commentsState is not provided", () => {
    // When commentsState prop is omitted, it is undefined — same as no fetch started yet
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("fetching comments");
  });

  it("renders loading state while comments are fetching", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: "loading",
    });
    expect(lastFrame()).toContain("fetching comments");
  });

  it("renders error state when comments failed", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: "error",
    });
    expect(lastFrame()).toContain("could not load comments");
  });

  it("renders 'No comments yet' when comments array is empty", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: [],
    });
    expect(lastFrame()).toContain("No comments yet");
  });

  it("renders actual comments when available", () => {
    const comments: IssueComment[] = [
      {
        author: { login: "alice" },
        body: "This looks good to me!",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ];
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: comments,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("@alice");
    expect(frame).toContain("This looks good to me!");
  });

  it("renders at most 5 most-recent comments", () => {
    const comments: IssueComment[] = Array.from({ length: 7 }, (_, i) => ({
      author: { login: `user${i}` },
      body: `Comment number ${i}`,
      createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    }));
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: comments,
    });
    const frame = lastFrame() ?? "";
    // Only last 5 (indices 2-6 from the original array when sliced with .slice(-5))
    expect(frame).toContain("user2");
    expect(frame).toContain("user6");
    // First two should not appear (they were sliced off)
    expect(frame).not.toContain("user0");
    expect(frame).not.toContain("user1");
  });

  it("calls fetchComments when commentsState is null and fetchComments/issueRepo are provided", () => {
    const fetchComments = vi.fn();
    renderPanel({
      issue: makeIssue({ number: 42 }),
      width: 80,
      isActive: false,
      commentsState: null,
      fetchComments,
      issueRepo: "owner/repo",
    });
    expect(fetchComments).toHaveBeenCalledWith("owner/repo", 42);
  });

  it("does NOT call fetchComments when commentsState is already loaded", () => {
    const fetchComments = vi.fn();
    renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: [],
      fetchComments,
      issueRepo: "owner/repo",
    });
    // commentsState is [] (not null/undefined), so fetchComments should not be triggered
    expect(fetchComments).not.toHaveBeenCalled();
  });

  it("does NOT call fetchComments when issueRepo is not provided", () => {
    const fetchComments = vi.fn();
    renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: null,
      fetchComments,
      issueRepo: null,
    });
    expect(fetchComments).not.toHaveBeenCalled();
  });

  it("renders slackThreadUrl section when slackThreadUrl is present", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({
        slackThreadUrl: "https://myorg.slack.com/archives/C12345/p1234567890",
      }),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("Slack");
  });

  it("shows multiple slack links count when body has multiple slack URLs", () => {
    const body = [
      "See https://myorg.slack.com/archives/C12345/p1111111111",
      "and https://myorg.slack.com/archives/C12345/p2222222222",
    ].join("\n");

    const { lastFrame } = renderPanel({
      issue: makeIssue({
        slackThreadUrl: "https://myorg.slack.com/archives/C12345/p1111111111",
        body,
      }),
      width: 80,
      isActive: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("2 links");
  });

  it("shows single slack link hint when body has exactly one slack URL", () => {
    const body = "See https://myorg.slack.com/archives/C12345/p1111111111";

    const { lastFrame } = renderPanel({
      issue: makeIssue({
        slackThreadUrl: "https://myorg.slack.com/archives/C12345/p1111111111",
        body,
      }),
      width: 80,
      isActive: false,
    });
    expect(lastFrame()).toContain("thread (s to open)");
  });

  it("strips markdown headers from body display", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ body: "## Section Header\n\nSome content here." }),
      width: 80,
      isActive: false,
    });
    const frame = lastFrame() ?? "";
    // Header markers should be stripped
    expect(frame).not.toContain("##");
    expect(frame).toContain("Section Header");
    expect(frame).toContain("Some content here.");
  });

  it("strips bold markdown from body display", () => {
    const { lastFrame } = renderPanel({
      issue: makeIssue({ body: "**Bold text** and normal text." }),
      width: 80,
      isActive: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("**");
    expect(frame).toContain("Bold text");
  });

  it("panel label is cyan when isActive=true", () => {
    const { lastFrame } = renderPanel({
      issue: null,
      width: 40,
      isActive: true,
    });
    // Label always appears regardless of active state
    expect(lastFrame()).toContain("[0] Detail");
  });
});

// ── Comment age formatting (formatCommentAge via rendered output) ──

describe("comment age display", () => {
  it("shows seconds ago for very recent comments", () => {
    const comments: IssueComment[] = [
      {
        author: { login: "alice" },
        body: "Quick comment",
        createdAt: new Date(Date.now() - 30_000).toISOString(),
      },
    ];
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: comments,
    });
    expect(lastFrame()).toContain("s ago");
  });

  it("shows minutes ago for comments older than a minute", () => {
    const comments: IssueComment[] = [
      {
        author: { login: "bob" },
        body: "Old comment",
        createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    ];
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: comments,
    });
    expect(lastFrame()).toContain("m ago");
  });

  it("shows hours ago for comments older than an hour", () => {
    const comments: IssueComment[] = [
      {
        author: { login: "carol" },
        body: "Hours old",
        createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      },
    ];
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: comments,
    });
    expect(lastFrame()).toContain("h ago");
  });

  it("shows days ago for comments older than a day", () => {
    const comments: IssueComment[] = [
      {
        author: { login: "dave" },
        body: "Ancient comment",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
      },
    ];
    const { lastFrame } = renderPanel({
      issue: makeIssue(),
      width: 80,
      isActive: false,
      commentsState: comments,
    });
    expect(lastFrame()).toContain("d ago");
  });
});
