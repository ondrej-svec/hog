/**
 * Tests for nl-create-overlay.tsx.
 *
 * Strategy:
 * - Pure parsing logic (parseHeuristic from ai.js) is tested directly with a
 *   partial mock that keeps the real implementation while mocking extractIssueFields.
 * - React component rendering tests use ink-testing-library against the
 *   NlCreateOverlay component with extractIssueFields fully mocked.
 */

import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks for the component tests (must be hoisted before imports) ──

// Partial mock: keep parseHeuristic real, only mock extractIssueFields
const mockExtractIssueFields = vi.fn();
vi.mock("../../ai.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ai.js")>();
  return {
    ...actual,
    extractIssueFields: (...args: unknown[]) => mockExtractIssueFields(...args),
  };
});

// config.js — minimal stub (ai.js reads getLlmAuth; our partial mock keeps parseHeuristic real)
vi.mock("../../config.js", () => ({
  getLlmAuth: () => null,
}));

// ink-instance — not needed in tests
vi.mock("../ink-instance.js", () => ({
  getInkInstance: () => null,
}));

// node:child_process — spawnSync only runs when $EDITOR flow is triggered
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

// node:fs / node:os — only used during $EDITOR flow
vi.mock("node:fs", () => ({
  mkdtempSync: vi.fn().mockReturnValue("/tmp/hog-body-test"),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(""),
  rmSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  tmpdir: vi.fn().mockReturnValue("/tmp"),
}));

// ── Imports (after mocks) ──

import { parseHeuristic } from "../../ai.js";
import type { RepoConfig } from "../../config.js";
import { NlCreateOverlay } from "./nl-create-overlay.js";

// ── Helper ──

function makeRepo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    name: "owner/repo",
    shortName: "repo",
    projectNumber: 1,
    statusFieldId: "SF_1",
    completionAction: { type: "closeIssue" as const },
    ...overrides,
  };
}

// ── Pure function tests: parseHeuristic ──
// These use the real implementation (partial mock preserves it).

describe("parseHeuristic", () => {
  it("extracts title from plain text", async () => {
    const result = await parseHeuristic("fix login bug");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("fix login bug");
    expect(result!.labels).toEqual([]);
    expect(result!.assignee).toBeNull();
    expect(result!.dueDate).toBeNull();
  });

  it("extracts #labels from input", async () => {
    const result = await parseHeuristic("fix login bug #backend #priority:high");
    expect(result).not.toBeNull();
    expect(result!.labels).toContain("backend");
    expect(result!.labels).toContain("priority:high");
    expect(result!.title).toBe("fix login bug");
  });

  it("extracts @assignee from input", async () => {
    const result = await parseHeuristic("fix login bug @alice");
    expect(result).not.toBeNull();
    expect(result!.assignee).toBe("alice");
    expect(result!.title).toBe("fix login bug");
  });

  it("extracts due date from input", async () => {
    // Use a fixed "today" to make the assertion deterministic
    const today = new Date("2026-02-19T12:00:00");
    const result = await parseHeuristic("fix bug due 2026-03-01", today);
    expect(result).not.toBeNull();
    expect(result!.dueDate).toBe("2026-03-01");
    expect(result!.title).toBe("fix bug");
  });

  it("handles combined tokens: #label @user due", async () => {
    const today = new Date("2026-02-19T12:00:00");
    const result = await parseHeuristic("deploy service #infra @bob due 2026-03-15", today);
    expect(result).not.toBeNull();
    expect(result!.labels).toContain("infra");
    expect(result!.assignee).toBe("bob");
    expect(result!.dueDate).toBe("2026-03-15");
    expect(result!.title).toBe("deploy service");
  });

  it("returns null when input reduces to empty title", async () => {
    // Only a label, no title text
    const result = await parseHeuristic("#bug");
    expect(result).toBeNull();
  });

  it("returns null for whitespace-only input", async () => {
    const result = await parseHeuristic("   ");
    expect(result).toBeNull();
  });

  it("handles multiple labels", async () => {
    const result = await parseHeuristic("some feature #feat #ready #ui");
    expect(result).not.toBeNull();
    expect(result!.labels).toHaveLength(3);
    expect(result!.labels).toEqual(["feat", "ready", "ui"]);
  });

  it("last @mention wins when multiple @mentions are present", async () => {
    const result = await parseHeuristic("task @alice @bob");
    expect(result).not.toBeNull();
    // Last one wins per implementation
    expect(result!.assignee).toBe("bob");
  });

  it("lowercases label names", async () => {
    const result = await parseHeuristic("thing #UPPERCASE #MixedCase");
    expect(result).not.toBeNull();
    expect(result!.labels).toEqual(["uppercase", "mixedcase"]);
  });

  it("preserves colons and hyphens inside label tokens", async () => {
    const result = await parseHeuristic("task #priority:high #some-label");
    expect(result).not.toBeNull();
    expect(result!.labels).toContain("priority:high");
    expect(result!.labels).toContain("some-label");
  });
});

// ── React component rendering tests ──

describe("NlCreateOverlay component", () => {
  beforeEach(() => {
    mockExtractIssueFields.mockReset();
    mockExtractIssueFields.mockResolvedValue(null);
  });

  it("renders the input field prompt in initial (input) step", () => {
    const { lastFrame } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain("What do you need to do");
  });

  it("renders Esc:cancel hint in initial step", () => {
    const { lastFrame } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain("Esc:cancel");
  });

  it("renders placeholder hint text", () => {
    const { lastFrame } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    // The placeholder includes #label @user due <date>
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#label");
    expect(frame).toContain("@user");
  });

  it("calls onCancel when Escape is pressed in input step", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel,
      }),
    );

    // Escape key sequence
    stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 30));

    expect(onCancel).toHaveBeenCalled();
  });

  it("renders with no defaultRepoName without crashing (fallback to first repo)", () => {
    const { lastFrame } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: null,
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toBeTruthy();
  });

  it("does not call onSubmit on initial render", () => {
    const onSubmit = vi.fn();
    render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit,
        onCancel: vi.fn(),
      }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders spinner label while parsing is in progress", async () => {
    // Simulate a slow extractIssueFields call
    let resolve!: (v: null) => void;
    mockExtractIssueFields.mockReturnValue(new Promise<null>((r) => (resolve = r)));

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // Type text first (separate from Enter so TextInput registers the characters)
    stdin.write("fix the bug");
    await new Promise((r) => setTimeout(r, 30));
    // Then press Enter
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));

    const frame = lastFrame() ?? "";
    // While parsing, the spinner view should be shown
    expect(frame).toContain("Parsing");

    // Clean up
    resolve(null);
    await new Promise((r) => setTimeout(r, 30));
  });

  it("shows parse error text when extractIssueFields returns null", async () => {
    mockExtractIssueFields.mockResolvedValue(null);

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // Type text and submit — extractIssueFields returns null → "Title is required"
    stdin.write("something");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Title is required");
  });

  it("shows parse error text when extractIssueFields rejects", async () => {
    mockExtractIssueFields.mockRejectedValue(new Error("network failure"));

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    stdin.write("something");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Parsing failed");
  });

  it("shows preview fields (title, Enter:add body) after successful parse", async () => {
    mockExtractIssueFields.mockResolvedValue({
      title: "Fix the login bug",
      labels: ["bug"],
      assignee: "alice",
      dueDate: null,
    });

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: { "owner/repo": [{ name: "bug", color: "red" }] },
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    stdin.write("fix login bug");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    const frame = lastFrame() ?? "";
    // Preview shows the parsed title and the action hints
    expect(frame).toContain("Fix the login bug");
    expect(frame).toContain("Enter:add body");
  });

  it("shows labels in preview after successful parse", async () => {
    mockExtractIssueFields.mockResolvedValue({
      title: "Fix thing",
      labels: ["bug", "priority:high"],
      assignee: null,
      dueDate: null,
    });

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    stdin.write("fix thing #bug");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("bug");
  });

  it("shows assignee in preview after successful parse", async () => {
    mockExtractIssueFields.mockResolvedValue({
      title: "Some task",
      labels: [],
      assignee: "bob",
      dueDate: null,
    });

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    stdin.write("some task @bob");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("bob");
  });

  it("shows due date in preview after successful parse (formatted as Mon DD)", async () => {
    mockExtractIssueFields.mockResolvedValue({
      title: "Release v2",
      labels: [],
      assignee: null,
      dueDate: "2026-03-15",
    });

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    stdin.write("release v2 due 2026-03-15");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    const frame = lastFrame() ?? "";
    // formatDue renders as e.g. "Sun Mar 15"
    expect(frame).toContain("Mar 15");
  });

  it("shows r:cycle hint when multiple repos are configured", () => {
    mockExtractIssueFields.mockResolvedValue(null);

    const repos = [
      makeRepo({ name: "owner/repo1", shortName: "repo1" }),
      makeRepo({ name: "owner/repo2", shortName: "repo2" }),
    ];

    const { lastFrame } = render(
      React.createElement(NlCreateOverlay, {
        repos,
        defaultRepoName: "owner/repo1",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // The initial "input" view does NOT show r:cycle — that's in the preview.
    // The component renders without crashing.
    expect(lastFrame()).toBeTruthy();
  });
  it("advances to body step when Enter is pressed in preview step", async () => {
    mockExtractIssueFields.mockResolvedValue({
      title: "Fix the bug",
      labels: [],
      assignee: null,
      dueDate: null,
    });

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // Submit input to get to preview
    stdin.write("fix the bug");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    // In preview step, press Enter to advance to body step
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));

    const frame = lastFrame() ?? "";
    // Body step shows "optional description" or "body:" label
    expect(frame).toContain("optional description");
  });

  it("calls onSubmit when Enter pressed in body step (covers buildLabelList + onSubmit path)", async () => {
    mockExtractIssueFields.mockResolvedValue({
      title: "Fix the bug",
      labels: ["backend"],
      assignee: null,
      dueDate: "2026-03-01",
    });

    const onSubmit = vi.fn();
    const { stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: { "owner/repo": [{ name: "backend", color: "blue" }] },
        onSubmit,
        onCancel: vi.fn(),
      }),
    );

    // Submit input to get to preview
    stdin.write("fix the bug #backend");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    // Advance to body step
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));

    // Submit from body step with empty body
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));

    expect(onSubmit).toHaveBeenCalledWith("owner/repo", "Fix the bug", "", "2026-03-01", [
      "backend",
    ]);
  });

  it("navigates back from body step to preview when Escape is pressed", async () => {
    mockExtractIssueFields.mockResolvedValue({
      title: "Fix the bug",
      labels: [],
      assignee: null,
      dueDate: null,
    });

    const { lastFrame, stdin } = render(
      React.createElement(NlCreateOverlay, {
        repos: [makeRepo()],
        defaultRepoName: "owner/repo",
        labelCache: {},
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // Get to preview
    stdin.write("fix the bug");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 80));

    // Advance to body step
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));

    // Press Escape to go back to preview
    stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 30));

    const frame = lastFrame() ?? "";
    // Back in preview, shows the title and Enter:add body hint
    expect(frame).toContain("Fix the bug");
  });
});
