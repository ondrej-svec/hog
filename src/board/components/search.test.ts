import { describe, expect, it } from "vitest";
import type { GitHubIssue } from "../../github.js";
import { matchesSearch } from "./dashboard.js";

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Fix the login bug",
    url: "https://github.com/owner/repo/issues/42",
    state: "open",
    updatedAt: new Date().toISOString(),
    labels: [],
    assignees: [],
    ...overrides,
  };
}

describe("matchesSearch", () => {
  it("returns true for empty query", () => {
    expect(matchesSearch(makeIssue(), "")).toBe(true);
    expect(matchesSearch(makeIssue(), "   ")).toBe(true);
  });

  it("matches title substring (case-insensitive)", () => {
    const issue = makeIssue({ title: "Fix the login bug" });
    expect(matchesSearch(issue, "login")).toBe(true);
    expect(matchesSearch(issue, "LOGIN")).toBe(true);
    expect(matchesSearch(issue, "payment")).toBe(false);
  });

  it("matches full label name", () => {
    const issue = makeIssue({ labels: [{ name: "bug" }] });
    expect(matchesSearch(issue, "bug")).toBe(true);
    expect(matchesSearch(issue, "feature")).toBe(false);
  });

  it("matches label value without prefix (high → priority:high)", () => {
    const issue = makeIssue({ labels: [{ name: "priority:high" }] });
    expect(matchesSearch(issue, "high")).toBe(true);
    expect(matchesSearch(issue, "low")).toBe(false);
  });

  it("matches size label value (M → size:M)", () => {
    const issue = makeIssue({ labels: [{ name: "size:M" }] });
    expect(matchesSearch(issue, "size:m")).toBe(true);
    expect(matchesSearch(issue, "M")).toBe(true);
  });

  it("matches projectStatus substring", () => {
    const issue = makeIssue({ projectStatus: "In Progress" });
    expect(matchesSearch(issue, "in progress")).toBe(true);
    expect(matchesSearch(issue, "progress")).toBe(true);
    expect(matchesSearch(issue, "backlog")).toBe(false);
  });

  it("matches assignee login without @ prefix", () => {
    const issue = makeIssue({ assignees: [{ login: "alice" }] });
    expect(matchesSearch(issue, "alice")).toBe(true);
    expect(matchesSearch(issue, "bob")).toBe(false);
  });

  it("matches assignee login with @ prefix", () => {
    const issue = makeIssue({ assignees: [{ login: "alice" }] });
    expect(matchesSearch(issue, "@alice")).toBe(true);
    expect(matchesSearch(issue, "@bob")).toBe(false);
  });

  it("matches exact issue number with # prefix", () => {
    const issue = makeIssue({ number: 123 });
    expect(matchesSearch(issue, "#123")).toBe(true);
    expect(matchesSearch(issue, "#456")).toBe(false);
  });

  it("'unassigned' keyword matches issues with no assignees", () => {
    expect(matchesSearch(makeIssue({ assignees: [] }), "unassigned")).toBe(true);
    expect(matchesSearch(makeIssue({ assignees: [{ login: "alice" }] }), "unassigned")).toBe(false);
  });

  it("'assigned' keyword matches issues with at least one assignee", () => {
    expect(matchesSearch(makeIssue({ assignees: [{ login: "alice" }] }), "assigned")).toBe(true);
    expect(matchesSearch(makeIssue({ assignees: [] }), "assigned")).toBe(false);
  });

  it("ANDs multiple tokens together", () => {
    const issue = makeIssue({
      title: "Auth timeout",
      labels: [{ name: "priority:high" }, { name: "bug" }],
    });
    expect(matchesSearch(issue, "timeout high")).toBe(true);
    expect(matchesSearch(issue, "timeout low")).toBe(false);
    expect(matchesSearch(issue, "high bug")).toBe(true);
    expect(matchesSearch(issue, "high feature")).toBe(false);
  });

  it("combines assignee, label, and title tokens", () => {
    const issue = makeIssue({
      title: "dark mode",
      labels: [{ name: "feature" }],
      assignees: [{ login: "bob" }],
    });
    expect(matchesSearch(issue, "dark feature @bob")).toBe(true);
    expect(matchesSearch(issue, "dark feature @alice")).toBe(false);
  });
});
