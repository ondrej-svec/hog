import { describe, expect, it } from "vitest";
import type { GitHubIssue } from "../../github.js";
import { matchesSearch, tokenizeQuery } from "../board-tree.js";

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

  it("matches custom project field values (Workstream, Size, etc.)", () => {
    const issue = makeIssue({
      customFields: { Workstream: "Platform", Size: "M", Priority: "High" },
    });
    expect(matchesSearch(issue, "Platform")).toBe(true);
    expect(matchesSearch(issue, "platform")).toBe(true); // case-insensitive
    expect(matchesSearch(issue, "M")).toBe(true);
    expect(matchesSearch(issue, "High")).toBe(true);
    expect(matchesSearch(issue, "Frontend")).toBe(false);
  });

  it("combines custom field + label + title tokens", () => {
    const issue = makeIssue({
      title: "auth timeout",
      labels: [{ name: "bug" }],
      customFields: { Workstream: "Platform" },
    });
    expect(matchesSearch(issue, "auth platform")).toBe(true);
    expect(matchesSearch(issue, "auth frontend")).toBe(false);
    expect(matchesSearch(issue, "bug platform")).toBe(true);
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

  describe("field:value search", () => {
    it("matches custom field by name:value (workstream:Aimee)", () => {
      const issue = makeIssue({
        customFields: { Workstream: "Aimee", Size: "M" },
      });
      expect(matchesSearch(issue, "workstream:Aimee")).toBe(true);
      expect(matchesSearch(issue, "workstream:aimee")).toBe(true);
      expect(matchesSearch(issue, "Workstream:Aimee")).toBe(true);
      expect(matchesSearch(issue, "workstream:Platform")).toBe(false);
    });

    it("matches custom field with quoted multi-word value", () => {
      const issue = makeIssue({
        customFields: { Workstream: "Product Design" },
      });
      expect(matchesSearch(issue, 'workstream:"Product Design"')).toBe(true);
      expect(matchesSearch(issue, 'workstream:"product design"')).toBe(true);
      expect(matchesSearch(issue, 'workstream:"Product"')).toBe(true); // substring
      expect(matchesSearch(issue, 'workstream:"Engineering"')).toBe(false);
    });

    it("matches status: field alias against projectStatus", () => {
      const issue = makeIssue({ projectStatus: "In Progress" });
      expect(matchesSearch(issue, "status:progress")).toBe(true);
      expect(matchesSearch(issue, 'status:"In Progress"')).toBe(true);
      expect(matchesSearch(issue, "status:backlog")).toBe(false);
    });

    it("matches label: field alias", () => {
      const issue = makeIssue({ labels: [{ name: "priority:high" }] });
      expect(matchesSearch(issue, "label:high")).toBe(true);
      expect(matchesSearch(issue, "label:priority")).toBe(true);
      expect(matchesSearch(issue, "label:low")).toBe(false);
    });

    it("matches assignee: field alias", () => {
      const issue = makeIssue({ assignees: [{ login: "alice" }] });
      expect(matchesSearch(issue, "assignee:alice")).toBe(true);
      expect(matchesSearch(issue, "assignee:bob")).toBe(false);
    });

    it("combines field:value with plain tokens", () => {
      const issue = makeIssue({
        title: "Auth timeout",
        customFields: { Workstream: "Platform" },
      });
      expect(matchesSearch(issue, "auth workstream:Platform")).toBe(true);
      expect(matchesSearch(issue, "auth workstream:Frontend")).toBe(false);
      expect(matchesSearch(issue, "payment workstream:Platform")).toBe(false);
    });

    it("matches partial field name (case-insensitive)", () => {
      const issue = makeIssue({
        customFields: { "Target Workstream": "Platform" },
      });
      expect(matchesSearch(issue, "workstream:Platform")).toBe(true);
    });

    it("does not match field:value when field exists but value differs", () => {
      const issue = makeIssue({
        customFields: { Workstream: "Platform" },
      });
      expect(matchesSearch(issue, "workstream:Frontend")).toBe(false);
    });
  });
});

describe("tokenizeQuery", () => {
  it("parses plain tokens", () => {
    expect(tokenizeQuery("bug login")).toEqual([
      { type: "plain", value: "bug" },
      { type: "plain", value: "login" },
    ]);
  });

  it("parses field:value tokens", () => {
    expect(tokenizeQuery("workstream:Aimee")).toEqual([
      { type: "field", field: "workstream", value: "aimee" },
    ]);
  });

  it('parses field:"quoted value" tokens', () => {
    expect(tokenizeQuery('workstream:"Product Design"')).toEqual([
      { type: "field", field: "workstream", value: "product design" },
    ]);
  });

  it("parses mixed plain and field tokens", () => {
    expect(tokenizeQuery('auth workstream:Platform status:"In Progress"')).toEqual([
      { type: "plain", value: "auth" },
      { type: "field", field: "workstream", value: "platform" },
      { type: "field", field: "status", value: "in progress" },
    ]);
  });

  it("preserves special prefixes as plain tokens", () => {
    expect(tokenizeQuery("#123 @alice")).toEqual([
      { type: "plain", value: "#123" },
      { type: "plain", value: "@alice" },
    ]);
  });

  it("returns empty array for empty/whitespace query", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});
