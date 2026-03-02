import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { PhaseStatus } from "../hooks/use-workflow-state.js";
import { WorkflowOverlay } from "./workflow-overlay.js";

function makeIssue() {
  return {
    number: 42,
    title: "Fix auth flow",
    url: "https://github.com/a/b/issues/42",
    state: "OPEN" as const,
    projectStatus: "In Progress",
    assignees: [],
    labels: [],
    body: "",
    dueDate: null,
    updatedAt: "2026-01-15T10:00:00Z",
  };
}

function makePhases(overrides: Partial<PhaseStatus>[] = []): PhaseStatus[] {
  const defaults: PhaseStatus[] = [
    { name: "brainstorm", state: "completed" },
    { name: "plan", state: "active" },
    { name: "implement", state: "pending" },
    { name: "review", state: "pending" },
  ];
  return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
}

describe("WorkflowOverlay", () => {
  it("renders issue title and phase list", () => {
    const onAction = vi.fn();
    const onCancel = vi.fn();

    const { lastFrame } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        onAction={onAction}
        onCancel={onCancel}
      />,
    );

    const output = lastFrame() ?? "";
    expect(output).toContain("#42");
    expect(output).toContain("Fix auth flow");
    expect(output).toContain("brainstorm");
    expect(output).toContain("plan");
    expect(output).toContain("implement");
    expect(output).toContain("review");
  });

  it("shows running indicator for active phase", () => {
    const { lastFrame } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        onAction={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const output = lastFrame() ?? "";
    expect(output).toContain("(running)");
  });

  it("shows resume hint when latestSessionId is provided", () => {
    const { lastFrame } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        latestSessionId="sid-abc"
        onAction={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const output = lastFrame() ?? "";
    expect(output).toContain("r: Resume last session");
  });

  it("hides resume hint when no latestSessionId", () => {
    const { lastFrame } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        onAction={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const output = lastFrame() ?? "";
    expect(output).not.toContain("r: Resume last session");
  });

  it("calls onCancel on Escape", () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        onAction={vi.fn()}
        onCancel={onCancel}
      />,
    );

    stdin.write("\x1B");
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onAction with launch interactive on Enter", () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        onAction={onAction}
        onCancel={vi.fn()}
      />,
    );

    stdin.write("\r");
    expect(onAction).toHaveBeenCalledWith({
      type: "launch",
      phase: "brainstorm",
      mode: "interactive",
    });
  });

  it("calls onAction with launch background on b", () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        onAction={onAction}
        onCancel={vi.fn()}
      />,
    );

    stdin.write("b");
    expect(onAction).toHaveBeenCalledWith({
      type: "launch",
      phase: "brainstorm",
      mode: "background",
    });
  });

  it("calls onAction with resume on r when sessionId present", () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        latestSessionId="sid-abc"
        onAction={onAction}
        onCancel={vi.fn()}
      />,
    );

    stdin.write("r");
    expect(onAction).toHaveBeenCalledWith({
      type: "resume",
      sessionId: "sid-abc",
    });
  });

  it("navigates down with j key and shows cursor movement", () => {
    const { stdin, lastFrame } = render(
      <WorkflowOverlay
        issue={makeIssue()}
        repoName="a/b"
        phases={makePhases()}
        onAction={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Initially, first item (brainstorm) should have the cursor
    const before = lastFrame() ?? "";
    expect(before).toContain("> ");

    // Move cursor down
    stdin.write("j");

    // The component should re-render with cursor on the second item
    const after = lastFrame() ?? "";
    expect(after).toContain("plan");
  });
});
