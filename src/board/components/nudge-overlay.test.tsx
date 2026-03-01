import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { NudgeCandidate } from "../hooks/use-nudges.js";
import type { NudgeAction } from "./nudge-overlay.js";
import { NudgeOverlay } from "./nudge-overlay.js";

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

function renderNudge(candidates: NudgeCandidate[], onAction = vi.fn(), onCancel = vi.fn()) {
  return render(React.createElement(NudgeOverlay, { candidates, onAction, onCancel }));
}

describe("NudgeOverlay", () => {
  it("renders stale issues with age indicators", () => {
    const { lastFrame } = renderNudge([
      makeCandidate({ ageDays: 14, severity: "critical" }),
      makeCandidate({
        issue: {
          number: 43,
          title: "Update docs",
          url: "https://github.com/owner/repo/issues/43",
          state: "open",
          updatedAt: "2026-01-08T00:00:00Z",
          labels: [],
        },
        ageDays: 8,
        severity: "warning",
      }),
    ]);
    const frame = lastFrame()!;
    expect(frame).toContain("Stale Issues (2)");
    expect(frame).toContain("[14d]");
    expect(frame).toContain("#42");
    expect(frame).toContain("#43");
  });

  it("renders keybinding hints", () => {
    const { lastFrame } = renderNudge([makeCandidate()]);
    const frame = lastFrame()!;
    expect(frame).toContain("1/3/7: Snooze");
    expect(frame).toContain("Dismiss");
  });

  it("calls onAction with dismiss on Escape", () => {
    const onAction = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = renderNudge([makeCandidate()], onAction, onCancel);

    stdin.write("\u001B"); // Escape
    expect(onAction).toHaveBeenCalledWith({ type: "dismiss" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onAction with snooze on digit key", () => {
    const onAction = vi.fn();
    const { stdin } = renderNudge([makeCandidate()], onAction);

    stdin.write("7");
    expect(onAction).toHaveBeenCalledWith({
      type: "snooze",
      repo: "owner/repo",
      issueNumber: 42,
      days: 7,
    });
  });

  it("renders multiple candidates", () => {
    const candidates = [
      makeCandidate({ ageDays: 14 }),
      makeCandidate({
        issue: {
          number: 99,
          title: "Second issue",
          url: "https://github.com/owner/repo/issues/99",
          state: "open",
          updatedAt: "2026-01-08T00:00:00Z",
          labels: [],
        },
        ageDays: 8,
        severity: "warning",
      }),
    ];
    const { lastFrame } = renderNudge(candidates);
    const frame = lastFrame()!;
    expect(frame).toContain("#42");
    expect(frame).toContain("#99");
    expect(frame).toContain("[14d]");
    expect(frame).toContain("[8d]");
  });
});
