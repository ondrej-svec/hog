import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { NudgeCandidate } from "../hooks/use-nudges.js";
import type { TriageAction } from "./triage-overlay.js";
import { TriageOverlay } from "./triage-overlay.js";

function makeCandidate(overrides: Partial<NudgeCandidate> = {}): NudgeCandidate {
  return {
    repo: "owner/repo",
    issue: {
      number: 42,
      title: "Fix auth flow",
      url: "https://github.com/owner/repo/issues/42",
      state: "open",
      updatedAt: "2026-01-01T00:00:00Z",
      labels: [],
    },
    ageDays: 14,
    severity: "critical",
    ...overrides,
  };
}

function renderTriage(candidates: NudgeCandidate[], onAction = vi.fn(), onCancel = vi.fn()) {
  return render(React.createElement(TriageOverlay, { candidates, onAction, onCancel }));
}

describe("TriageOverlay", () => {
  it("renders triage overlay with issue count", () => {
    const { lastFrame } = renderTriage([makeCandidate()]);
    const frame = lastFrame()!;
    expect(frame).toContain("Triage (1 stale issue");
    expect(frame).toContain("#42");
    expect(frame).toContain("[14d]");
  });

  it("shows current phase", () => {
    const { lastFrame } = renderTriage([makeCandidate()]);
    const frame = lastFrame()!;
    expect(frame).toContain("Phase: research");
  });

  it("shows default phase as research", () => {
    const { lastFrame } = renderTriage([makeCandidate()]);
    expect(lastFrame()!).toContain("Phase: research");
  });

  it("shows unchecked checkbox by default", () => {
    const { lastFrame } = renderTriage([makeCandidate()]);
    expect(lastFrame()!).toContain("[ ]");
  });

  it("launches background agent on Enter", () => {
    const onAction = vi.fn();
    const { stdin } = renderTriage([makeCandidate()], onAction);

    stdin.write("\r");
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "launch",
        phase: "research",
        mode: "background",
      }),
    );
  });

  it("launches interactively on i", () => {
    const onAction = vi.fn();
    const { stdin } = renderTriage([makeCandidate()], onAction);

    stdin.write("i");
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "launch",
        mode: "interactive",
      }),
    );
  });

  it("snoozes issue on s", () => {
    const onAction = vi.fn();
    const { stdin } = renderTriage([makeCandidate()], onAction);

    stdin.write("s");
    expect(onAction).toHaveBeenCalledWith({
      type: "snooze",
      repo: "owner/repo",
      issueNumber: 42,
      days: 7,
    });
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    const { stdin } = renderTriage([makeCandidate()], vi.fn(), onCancel);

    stdin.write("\u001B");
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders keybinding hints", () => {
    const { lastFrame } = renderTriage([makeCandidate()]);
    const frame = lastFrame()!;
    expect(frame).toContain("Space: Toggle selection");
    expect(frame).toContain("Tab: Cycle phase");
    expect(frame).toContain("Enter: Launch");
  });
});
