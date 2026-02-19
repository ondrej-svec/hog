import { describe, expect, it } from "vitest";
import type { GitHubIssue, LabelOption, StatusOption } from "../../github.js";
import { buildEditorFile, parseFrontMatter } from "./edit-issue-overlay.js";

// ── Test fixtures ──

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Fix login bug",
    url: "https://github.com/owner/repo/issues/42",
    state: "open",
    updatedAt: "2024-01-01T00:00:00Z",
    labels: [],
    assignees: [],
    body: "This is the issue body.",
    projectStatus: "In Progress",
    ...overrides,
  };
}

const statusOptions: StatusOption[] = [
  { id: "opt1", name: "Backlog" },
  { id: "opt2", name: "In Progress" },
  { id: "opt3", name: "Done" },
];

const repoLabels: LabelOption[] = [
  { name: "bug", color: "d73a4a" },
  { name: "enhancement", color: "a2eeef" },
];

// ── buildEditorFile tests ──

describe("buildEditorFile", () => {
  it("contains the issue title", () => {
    const issue = makeIssue({ title: "My Issue Title" });
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("title: My Issue Title");
  });

  it("contains the current status", () => {
    const issue = makeIssue({ projectStatus: "Backlog" });
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("status: Backlog");
  });

  it("lists available statuses in a comment", () => {
    const issue = makeIssue();
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("Backlog");
    expect(result).toContain("In Progress");
    expect(result).toContain("Done");
  });

  it("includes current labels as YAML list items", () => {
    const issue = makeIssue({
      labels: [{ name: "bug" }, { name: "enhancement" }],
    });
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("  - bug");
    expect(result).toContain("  - enhancement");
  });

  it("uses placeholder comment when no labels are set", () => {
    const issue = makeIssue({ labels: [] });
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("# - label-name");
  });

  it("contains the current assignee", () => {
    const issue = makeIssue({ assignees: [{ login: "jdoe" }] });
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("assignee: jdoe");
  });

  it("includes empty assignee when no assignees", () => {
    const issue = makeIssue({ assignees: [] });
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("assignee: ");
  });

  it("includes the issue body after the closing ---", () => {
    const issue = makeIssue({ body: "Detailed description here." });
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("---\n\nDetailed description here.");
  });

  it("handles missing body gracefully", () => {
    const issue = makeIssue();
    // Manually strip body to simulate optional field
    const { body: _body, ...issueWithoutBody } = issue;
    const issueNoBody = issueWithoutBody as GitHubIssue;
    const result = buildEditorFile(issueNoBody, "owner/repo", statusOptions, repoLabels);
    // Should not throw; body section just ends after ---
    expect(result).toContain("---");
  });

  it("includes the repo name and issue number in comments", () => {
    const issue = makeIssue({ number: 99 });
    const result = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    expect(result).toContain("owner/repo#99");
  });
});

// ── parseFrontMatter tests ──

describe("parseFrontMatter", () => {
  it("parses title correctly", () => {
    const content = `title: My Title
status: In Progress
labels:
assignee:
---

Body text here.`;
    const result = parseFrontMatter(content);
    expect(result.title).toBe("My Title");
  });

  it("parses status correctly", () => {
    const content = `title: My Title
status: Backlog
labels:
assignee:
---`;
    const result = parseFrontMatter(content);
    expect(result.status).toBe("Backlog");
  });

  it("parses labels correctly", () => {
    const content = `title: My Title
status:
labels:
  - bug
  - enhancement
assignee:
---`;
    const result = parseFrontMatter(content);
    expect(result.labels).toEqual(["bug", "enhancement"]);
  });

  it("returns empty array for labels when none are present", () => {
    const content = `title: My Title
status:
labels:
assignee:
---`;
    const result = parseFrontMatter(content);
    expect(result.labels).toEqual([]);
  });

  it("parses assignee correctly", () => {
    const content = `title: My Title
status:
labels:
assignee: jdoe
---`;
    const result = parseFrontMatter(content);
    expect(result.assignee).toBe("jdoe");
  });

  it("body is everything after the closing ---", () => {
    const content = `title: My Title
status:
labels:
assignee:
---

This is the body.
It spans multiple lines.`;
    const result = parseFrontMatter(content);
    expect(result.body).toBe("This is the body.\nIt spans multiple lines.");
  });

  it("handles comment lines (# ...) by skipping them", () => {
    const content = `# This is a comment
# Another comment
title: Commented Title
status: Done
labels:
assignee:
---`;
    const result = parseFrontMatter(content);
    expect(result.title).toBe("Commented Title");
    expect(result.status).toBe("Done");
  });

  it("ignores label-like comment lines inside labels block", () => {
    const content = `title: My Title
status:
labels:
  - real-label
  # - commented-label
assignee:
---`;
    const result = parseFrontMatter(content);
    expect(result.labels).toEqual(["real-label"]);
    expect(result.labels).not.toContain("# - commented-label");
  });

  it("returns empty strings for missing fields", () => {
    const content = `---
---`;
    const result = parseFrontMatter(content);
    expect(result.title).toBe("");
    expect(result.status).toBe("");
    expect(result.assignee).toBe("");
    expect(result.body).toBe("");
    expect(result.labels).toEqual([]);
  });

  it("handles the full editor file format produced by buildEditorFile", () => {
    const issue = makeIssue({
      title: "Fix login bug",
      projectStatus: "In Progress",
      labels: [{ name: "bug" }],
      assignees: [{ login: "alice" }],
      body: "Something is broken.",
    });
    const editorContent = buildEditorFile(issue, "owner/repo", statusOptions, repoLabels);
    const result = parseFrontMatter(editorContent);
    expect(result.title).toBe("Fix login bug");
    expect(result.status).toBe("In Progress");
    expect(result.labels).toEqual(["bug"]);
    expect(result.assignee).toBe("alice");
    expect(result.body).toBe("Something is broken.");
  });

  it("returns empty body when no closing --- is present", () => {
    const content = `title: My Title
status:
labels:
assignee: `;
    const result = parseFrontMatter(content);
    expect(result.body).toBe("");
  });
});
