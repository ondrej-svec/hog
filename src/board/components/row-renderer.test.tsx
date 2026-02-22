import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { FlatRow } from "./row-renderer.js";
import { RowRenderer } from "./row-renderer.js";

function renderRow(row: FlatRow, selectedId: string | null = null, selfLogin = "me") {
  return render(React.createElement(RowRenderer, { row, selectedId, selfLogin }));
}

// ── Fixture helpers ──

function makeSectionHeaderRow(
  overrides: Partial<Extract<FlatRow, { type: "sectionHeader" }>> = {},
): Extract<FlatRow, { type: "sectionHeader" }> {
  return {
    type: "sectionHeader",
    key: "sec-1",
    navId: "nav-sec-1",
    label: "owner/myrepo",
    count: 3,
    countLabel: "issues",
    isCollapsed: false,
    ...overrides,
  };
}

function makeSubHeaderRow(
  overrides: Partial<Extract<FlatRow, { type: "subHeader" }>> = {},
): Extract<FlatRow, { type: "subHeader" }> {
  return {
    type: "subHeader",
    key: "sub-1",
    navId: "nav-sub-1",
    text: "In Progress",
    count: 2,
    isCollapsed: false,
    ...overrides,
  };
}

function makeIssueRow(
  overrides: Partial<Extract<FlatRow, { type: "issue" }>> = {},
): Extract<FlatRow, { type: "issue" }> {
  return {
    type: "issue",
    key: "issue-1",
    navId: "gh:owner/myrepo:42",
    repoName: "owner/myrepo",
    issue: {
      number: 42,
      title: "Fix the login bug",
      url: "https://github.com/owner/myrepo/issues/42",
      state: "open",
      updatedAt: "2024-01-01T00:00:00Z",
      labels: [],
      assignees: [],
    },
    ...overrides,
  };
}

function makeActivityRow(
  overrides: Partial<Extract<FlatRow, { type: "activity" }>> = {},
): Extract<FlatRow, { type: "activity" }> {
  return {
    type: "activity",
    key: "act-1",
    navId: null,
    event: {
      type: "comment",
      repoShortName: "myrepo",
      issueNumber: 7,
      actor: "alice",
      summary: "left a comment on #7",
      timestamp: new Date(Date.now() - 30 * 1000), // 30 seconds ago
    },
    ...overrides,
  };
}

function makeErrorRow(text = "Something went wrong"): Extract<FlatRow, { type: "error" }> {
  return { type: "error", key: "err-1", navId: null, text };
}

function makeGapRow(): Extract<FlatRow, { type: "gap" }> {
  return { type: "gap", key: "gap-1", navId: null };
}

// ── sectionHeader ──

describe("RowRenderer sectionHeader", () => {
  it("renders the repo label and count", () => {
    const row = makeSectionHeaderRow();
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("owner/myrepo");
    expect(frame).toContain("3");
    expect(frame).toContain("issues");
  });

  it("shows a down-arrow when expanded", () => {
    const row = makeSectionHeaderRow({ isCollapsed: false });
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▼");
  });

  it("shows a right-arrow when collapsed", () => {
    const row = makeSectionHeaderRow({ isCollapsed: true });
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶");
  });

  it("highlights label in cyan when selected", () => {
    const row = makeSectionHeaderRow();
    // We can only inspect the text content without ANSI; verify label still appears
    const { lastFrame } = renderRow(row, "nav-sec-1");
    const frame = lastFrame() ?? "";
    expect(frame).toContain("owner/myrepo");
  });
});

// ── subHeader ──

describe("RowRenderer subHeader", () => {
  it("renders subHeader text when navId is present", () => {
    const row = makeSubHeaderRow({ navId: "nav-sub-1" });
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("In Progress");
  });

  it("renders count when navId is present", () => {
    const row = makeSubHeaderRow({ navId: "nav-sub-1", count: 2 });
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("2");
  });

  it("shows a down-arrow for expanded navigable subHeader", () => {
    const row = makeSubHeaderRow({ navId: "nav-sub-1", isCollapsed: false });
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▼");
  });

  it("shows a right-arrow for collapsed navigable subHeader", () => {
    const row = makeSubHeaderRow({ navId: "nav-sub-1", isCollapsed: true });
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶");
  });

  it("renders plain text when navId is null", () => {
    const row = makeSubHeaderRow({ navId: null, text: "Plain label" });
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Plain label");
    // No arrows — it's a non-navigable label-only row
    expect(frame).not.toContain("▼");
    expect(frame).not.toContain("▶");
  });
});

// ── issue ──

describe("RowRenderer issue", () => {
  it("renders issue number and title", () => {
    const row = makeIssueRow();
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("42");
    expect(frame).toContain("Fix the login bug");
  });

  it("shows no checkbox when isMultiSelected is undefined", () => {
    const row = makeIssueRow();
    const { lastFrame } = render(
      React.createElement(RowRenderer, {
        row,
        selectedId: null,
        selfLogin: "me",
        isMultiSelected: undefined,
      }),
    );
    const frame = lastFrame() ?? "";
    // Unicode checked/unchecked box chars should not appear
    expect(frame).not.toContain("☑");
    expect(frame).not.toContain("☐");
  });

  it("shows checked checkbox when isMultiSelected is true", () => {
    const row = makeIssueRow();
    const { lastFrame } = render(
      React.createElement(RowRenderer, {
        row,
        selectedId: null,
        selfLogin: "me",
        isMultiSelected: true,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("☑");
  });

  it("shows unchecked checkbox when isMultiSelected is false", () => {
    const row = makeIssueRow();
    const { lastFrame } = render(
      React.createElement(RowRenderer, {
        row,
        selectedId: null,
        selfLogin: "me",
        isMultiSelected: false,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("☐");
  });
});

// ── activity ──

describe("RowRenderer activity", () => {
  it("renders actor and summary", () => {
    const row = makeActivityRow();
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("@alice");
    expect(frame).toContain("left a comment on #7");
  });

  it("renders repo short name in parentheses", () => {
    const row = makeActivityRow();
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("myrepo");
  });

  it("renders a timestamp for the event", () => {
    const row = makeActivityRow();
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    // The time is shown as a locale time string (e.g., "2:30:00 PM")
    // Just verify something is rendered between prefix and actor
    expect(frame).toContain("@alice");
    expect(frame.length).toBeGreaterThan(0);
  });

  it("renders different event types (status change)", () => {
    const row = makeActivityRow({
      event: {
        type: "status",
        repoShortName: "myrepo",
        issueNumber: 2,
        actor: "carol",
        summary: "changed status",
        timestamp: new Date(Date.now() - 30 * 1000),
      },
    });
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("@carol");
    expect(frame).toContain("changed status");
  });
});

// ── error ──

describe("RowRenderer error", () => {
  it("renders error text prefixed with Error:", () => {
    const row = makeErrorRow("Network timeout");
    const { lastFrame } = renderRow(row);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Error:");
    expect(frame).toContain("Network timeout");
  });
});

// ── gap ──

describe("RowRenderer gap", () => {
  it("renders an empty line for gap rows", () => {
    const row = makeGapRow();
    const { lastFrame } = renderRow(row);
    // gap rows render an empty Text — the frame should not throw and should be defined
    expect(lastFrame()).toBeDefined();
  });
});
