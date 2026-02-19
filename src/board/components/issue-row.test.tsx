import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { GitHubIssue } from "../../github.js";
import type { IssueRowProps } from "./issue-row.js";
import { IssueRow } from "./issue-row.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Fix the login bug",
    url: "https://github.com/owner/repo/issues/42",
    state: "open",
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    labels: [],
    assignees: [],
    ...overrides,
  };
}

function renderRow(overrides: Partial<IssueRowProps> = {}) {
  const props: IssueRowProps = {
    issue: makeIssue(),
    selfLogin: "alice",
    isSelected: false,
    ...overrides,
  };
  return render(React.createElement(IssueRow, props));
}

describe("IssueRow", () => {
  it("renders the issue number", async () => {
    const { lastFrame } = renderRow();
    await delay(50);
    expect(lastFrame()).toContain("#42");
  });

  it("renders the issue title", async () => {
    const { lastFrame } = renderRow();
    await delay(50);
    expect(lastFrame()).toContain("Fix the login bug");
  });

  it("truncates long titles to 42 characters", async () => {
    const longTitle = "A".repeat(50);
    const { lastFrame } = renderRow({ issue: makeIssue({ title: longTitle }) });
    await delay(50);
    const frame = lastFrame() ?? "";
    // Truncated to 41 chars + ellipsis character
    expect(frame).not.toContain(longTitle);
    expect(frame).toContain("A".repeat(41));
  });

  it("shows 'unassigned' when there are no assignees", async () => {
    const { lastFrame } = renderRow({ issue: makeIssue({ assignees: [] }) });
    await delay(50);
    expect(lastFrame()).toContain("unassigned");
  });

  it("shows assignee login when issue has one assignee", async () => {
    const { lastFrame } = renderRow({
      issue: makeIssue({ assignees: [{ login: "bob" }] }),
    });
    await delay(50);
    expect(lastFrame()).toContain("bob");
  });

  it("shows multiple assignee logins joined by comma", async () => {
    const { lastFrame } = renderRow({
      issue: makeIssue({ assignees: [{ login: "bob" }, { login: "carol" }] }),
    });
    await delay(50);
    expect(lastFrame()).toContain("bob, carol");
  });

  it("shows '> ' selection arrow when isSelected=true", async () => {
    const { lastFrame } = renderRow({ isSelected: true });
    await delay(50);
    expect(lastFrame()).toContain("▶");
  });

  it("does not show selection arrow when isSelected=false", async () => {
    const { lastFrame } = renderRow({ isSelected: false });
    await delay(50);
    expect(lastFrame()).not.toContain("▶");
  });

  it("renders label names", async () => {
    const { lastFrame } = renderRow({
      issue: makeIssue({ labels: [{ name: "bug" }] }),
    });
    await delay(50);
    expect(lastFrame()).toContain("bug");
  });

  it("renders at most 2 labels", async () => {
    const { lastFrame } = renderRow({
      issue: makeIssue({
        labels: [{ name: "bug" }, { name: "enhancement" }, { name: "urgent" }],
      }),
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("bug");
    expect(frame).toContain("enhancement");
    expect(frame).not.toContain("urgent");
  });

  it("shows updatedAt as a relative time (e.g. '2h')", async () => {
    const { lastFrame } = renderRow();
    await delay(50);
    expect(lastFrame()).toContain("2h");
  });

  it("shows 'now' for an issue updated less than 60 seconds ago", async () => {
    const { lastFrame } = renderRow({
      issue: makeIssue({ updatedAt: new Date(Date.now() - 10_000).toISOString() }),
    });
    await delay(50);
    expect(lastFrame()).toContain("now");
  });

  it("shows 'Xm' for issue updated X minutes ago", async () => {
    const { lastFrame } = renderRow({
      issue: makeIssue({ updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() }),
    });
    await delay(50);
    expect(lastFrame()).toContain("5m");
  });

  it("shows 'Xd' for issues updated multiple days ago", async () => {
    const { lastFrame } = renderRow({
      issue: makeIssue({ updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() }),
    });
    await delay(50);
    expect(lastFrame()).toContain("3d");
  });

  it("shows 'today' target date label for due today", async () => {
    // Use midnight of today so Math.ceil((d - now) / 86400000) === 0
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { lastFrame } = renderRow({
      issue: makeIssue({ targetDate: today.toISOString() }),
    });
    await delay(50);
    expect(lastFrame()).toContain("today");
  });

  it("shows 'X d overdue' when target date is in the past", async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const { lastFrame } = renderRow({
      issue: makeIssue({ targetDate: past.toISOString() }),
    });
    await delay(50);
    expect(lastFrame()).toContain("overdue");
  });

  it("shows 'in Xd' for a target date within 7 days", async () => {
    const future = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const { lastFrame } = renderRow({
      issue: makeIssue({ targetDate: future.toISOString() }),
    });
    await delay(50);
    expect(lastFrame()).toContain("in 4d");
  });

  it("does not show target date text when targetDate is absent", async () => {
    const { lastFrame } = renderRow({ issue: makeIssue() });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("overdue");
    expect(frame).not.toContain("today");
    expect(frame).not.toContain("tomorrow");
  });

  it("shows self assignee differently (selfLogin matches assignee)", async () => {
    // When selfLogin matches an assignee the row renders without 'unassigned'
    const { lastFrame } = renderRow({
      issue: makeIssue({ assignees: [{ login: "alice" }] }),
      selfLogin: "alice",
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("alice");
    expect(frame).not.toContain("unassigned");
  });
});
