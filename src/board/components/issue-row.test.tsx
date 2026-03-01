import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { GitHubIssue } from "../../github.js";
import type { IssueRowProps } from "./issue-row.js";
import { IssueRow, abbreviatePhase, ageColor } from "./issue-row.js";

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
    panelWidth: 80,
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

  it("truncates long titles to fit available panel width", async () => {
    const longTitle = "A".repeat(200);
    // panelWidth=80 → innerW=78, titleW=78-35=43 → truncated to 42 A's + ellipsis
    const { lastFrame } = renderRow({ issue: makeIssue({ title: longTitle }), panelWidth: 80 });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain(longTitle);
    expect(frame).toContain("A".repeat(30)); // at least 30 A's visible (titleW=33 for panelWidth=80)
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

  it("renders at most 2 labels (compact abbreviations)", async () => {
    const { lastFrame } = renderRow({
      issue: makeIssue({
        labels: [{ name: "bug" }, { name: "enhancement" }, { name: "urgent" }],
      }),
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("bug"); // "bug" abbrev = "bug"
    expect(frame).toContain("enh"); // "enhancement" abbrev = "enh"
    expect(frame).not.toContain("urg!"); // 3rd label not shown
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

  it("shows phase indicator when provided", async () => {
    const { lastFrame } = renderRow({ phaseIndicator: "implement" });
    await delay(50);
    expect(lastFrame()).toContain("im");
  });

  it("does not show phase indicator when not provided", async () => {
    const { lastFrame } = renderRow();
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain(" im");
    expect(frame).not.toContain(" pl");
  });

  it("shows age suffix when above warning threshold", async () => {
    const { lastFrame } = renderRow({
      statusAgeDays: 10,
      stalenessConfig: { warningDays: 7, criticalDays: 14 },
    });
    await delay(50);
    expect(lastFrame()).toContain("[10d]");
  });

  it("does not show age suffix when below warning threshold", async () => {
    const { lastFrame } = renderRow({
      statusAgeDays: 3,
      stalenessConfig: { warningDays: 7, criticalDays: 14 },
    });
    await delay(50);
    expect(lastFrame()).not.toContain("[3d]");
  });

  it("does not show age suffix when statusAgeDays not provided", async () => {
    const { lastFrame } = renderRow();
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).not.toMatch(/\[\d+d\]/);
  });
});

describe("abbreviatePhase", () => {
  it("abbreviates known phases", () => {
    expect(abbreviatePhase("research")).toBe("rs");
    expect(abbreviatePhase("brainstorm")).toBe("bs");
    expect(abbreviatePhase("plan")).toBe("pl");
    expect(abbreviatePhase("implement")).toBe("im");
    expect(abbreviatePhase("review")).toBe("rv");
    expect(abbreviatePhase("compound")).toBe("cp");
  });

  it("falls back to first 2 chars for unknown phases", () => {
    expect(abbreviatePhase("custom-phase")).toBe("cu");
  });
});

describe("ageColor", () => {
  it("returns undefined below warning threshold", () => {
    expect(ageColor(3, { warningDays: 7, criticalDays: 14 })).toBeUndefined();
  });

  it("returns yellow at warning threshold", () => {
    expect(ageColor(7, { warningDays: 7, criticalDays: 14 })).toBe("yellow");
    expect(ageColor(10, { warningDays: 7, criticalDays: 14 })).toBe("yellow");
  });

  it("returns red at critical threshold", () => {
    expect(ageColor(14, { warningDays: 7, criticalDays: 14 })).toBe("red");
    expect(ageColor(21, { warningDays: 7, criticalDays: 14 })).toBe("red");
  });

  it("uses default thresholds (7/14) when config not provided", () => {
    expect(ageColor(3)).toBeUndefined();
    expect(ageColor(7)).toBe("yellow");
    expect(ageColor(14)).toBe("red");
  });
});
