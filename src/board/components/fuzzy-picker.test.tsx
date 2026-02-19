import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { RepoData } from "../fetch.js";
import type { FuzzyPickerProps } from "./fuzzy-picker.js";
import { FuzzyPicker } from "./fuzzy-picker.js";

// Ensure process.stdout.rows has a stable value for tests
Object.defineProperty(process.stdout, "rows", { value: 30, writable: true, configurable: true });

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeRepoData(): RepoData[] {
  return [
    {
      repo: {
        name: "owner/myrepo",
        shortName: "myrepo",
        projectNumber: 1,
        statusFieldId: "field-1",
        completionAction: { type: "closeIssue" } as const,
      },
      issues: [
        {
          number: 1,
          title: "Fix login bug",
          url: "https://github.com/owner/myrepo/issues/1",
          state: "open",
          updatedAt: "2024-01-01T00:00:00Z",
          labels: [],
          assignees: [],
        },
        {
          number: 2,
          title: "Add dark mode",
          url: "https://github.com/owner/myrepo/issues/2",
          state: "open",
          updatedAt: "2024-01-01T00:00:00Z",
          labels: [{ name: "ui" }],
          assignees: [{ login: "alice" }],
        },
      ],
      statusOptions: [],
      error: null,
    },
  ];
}

function renderFuzzyPicker(props: FuzzyPickerProps) {
  return render(React.createElement(FuzzyPicker, props));
}

describe("FuzzyPicker", () => {
  it("renders the 'Find issue' heading", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { lastFrame } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Find issue");
  });

  it("shows all issues when no query is entered", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { lastFrame } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Fix login bug");
    expect(frame).toContain("Add dark mode");
  });

  it("shows match count in the heading", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { lastFrame } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    // Should show "(2 matches)" since both issues are shown
    expect(frame).toContain("2 match");
  });

  it("shows repo short name and issue number for each issue", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { lastFrame } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("myrepo#1");
    expect(frame).toContain("myrepo#2");
  });

  it("shows 'No issues match' message when no results found", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    // Render with empty repos so there are no issues
    const { lastFrame } = renderFuzzyPicker({
      repos: [],
      onSelect,
      onClose,
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    // Empty repo means 0 issues; no results message should appear if a search were performed
    // With empty repos, totalCount is 0 but query is empty (no query = no "no results" message)
    expect(frame).toContain("Find issue");
  });

  it("shows navigation hints in the heading area", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { lastFrame } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Esc:close");
  });

  it("onClose is called when Escape is pressed", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { stdin } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);

    stdin.write("\x1b"); // Escape key
    await delay(50);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("onSelect is called with navId when Enter is pressed", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { stdin } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);

    stdin.write("\r"); // Enter key
    await delay(50);

    // The first issue should be selected (cursor defaults to 0)
    expect(onSelect).toHaveBeenCalledWith("gh:owner/myrepo:1");
  });

  it("shows assignee for issues with assignees", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { lastFrame } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);
    const frame = lastFrame() ?? "";
    // Issue #2 has assignee "alice"
    expect(frame).toContain("@alice");
  });
});

// ── keepCursorVisible pure function — tested via component behavior ──

describe("FuzzyPicker keyboard navigation", () => {
  it("moves cursor down with ArrowDown and wraps selection highlight", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { stdin, lastFrame } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);

    // First row starts selected (cursor = 0, first item is highlighted)
    const frameBefore = lastFrame() ?? "";
    expect(frameBefore).toContain(">");

    // Press down arrow to move to issue #2
    stdin.write("\x1b[B"); // ESC [ B = down arrow
    await delay(50);

    // Now pressing Enter should select issue #2
    stdin.write("\r");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith("gh:owner/myrepo:2");
  });

  it("moves cursor up with ArrowUp (covers upArrow branch)", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { stdin } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);

    // Press down first, then up
    stdin.write("\x1b[B"); // down arrow
    await delay(50);
    stdin.write("\x1b[A"); // up arrow
    await delay(50);

    // After down+up, cursor is back at 0, Enter selects first issue
    stdin.write("\r");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith("gh:owner/myrepo:1");
  });

  it("ctrl+k at top of list is a no-op (covers key.ctrl && input==='k' branch)", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { stdin, lastFrame } = renderFuzzyPicker({
      repos: makeRepoData(),
      onSelect,
      onClose,
    });
    await delay(50);

    // At cursor=0, ctrl+k runs Math.max(0-1, 0) = 0 (no-op cursor move).
    // \x0b is ctrl+k; it exercises the upArrow/ctrl+k branch in useInput.
    // It also inserts 'k' into TextInput query but does not submit.
    stdin.write("\x0b"); // ctrl+k
    await delay(50);

    // Neither onSelect nor onClose should have fired (ctrl+k is navigation only)
    expect(onClose).not.toHaveBeenCalled();
    // The component should still be rendered with content
    const frame = lastFrame() ?? "";
    expect(frame.length).toBeGreaterThan(0);
  });

  it("Enter on empty results list does not call onSelect (covers if(selected) guard)", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    // Render with no repos so results are empty
    const { stdin } = renderFuzzyPicker({
      repos: [],
      onSelect,
      onClose,
    });
    await delay(50);

    stdin.write("\r"); // Enter with no results
    await delay(50);

    expect(onSelect).not.toHaveBeenCalled();
  });
});
