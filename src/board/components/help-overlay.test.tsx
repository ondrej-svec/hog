import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { HelpOverlay } from "./help-overlay.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderHelpOverlay(currentMode: string, onClose: () => void) {
  return render(
    React.createElement(HelpOverlay, {
      currentMode: currentMode as Parameters<typeof HelpOverlay>[0]["currentMode"],
      onClose,
    }),
  );
}

describe("HelpOverlay", () => {
  it("renders the Keyboard Shortcuts heading", () => {
    const { lastFrame } = renderHelpOverlay("normal", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Keyboard Shortcuts");
  });

  it("shows the current mode in the header", () => {
    const { lastFrame } = renderHelpOverlay("normal", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("mode: normal");
  });

  it("renders the Navigation category with j/k shortcut", () => {
    const { lastFrame } = renderHelpOverlay("normal", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Navigation");
    expect(frame).toContain("j / Down");
    expect(frame).toContain("Move down");
  });

  it("renders the View category with search and focus shortcuts", () => {
    const { lastFrame } = renderHelpOverlay("normal", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("View");
    expect(frame).toContain("/");
    expect(frame).toContain("Search (inline filter)");
    expect(frame).toContain("f");
    expect(frame).toContain("Focus mode");
  });

  it("renders the Actions category with pick and assign shortcuts", () => {
    const { lastFrame } = renderHelpOverlay("normal", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Actions");
    expect(frame).toContain("p");
    expect(frame).toContain("Pick issue (assign + TickTick)");
    expect(frame).toContain("a");
    expect(frame).toContain("Assign to self");
  });

  it("renders the Board category with quit shortcut", () => {
    const { lastFrame } = renderHelpOverlay("normal", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Board");
    expect(frame).toContain("q");
    expect(frame).toContain("Quit");
  });

  it("shows the close hint at the bottom", () => {
    const { lastFrame } = renderHelpOverlay("normal", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Press ? or Esc to close");
  });

  it("shows mode-specific content for search mode", () => {
    const { lastFrame } = renderHelpOverlay("search", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("mode: search");
    expect(frame).toContain("Keyboard Shortcuts");
  });

  it("shows mode-specific content for focus mode", () => {
    const { lastFrame } = renderHelpOverlay("focus", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("mode: focus");
    expect(frame).toContain("Keyboard Shortcuts");
  });

  it("shows mode-specific content for overlay:comment mode", () => {
    const { lastFrame } = renderHelpOverlay("overlay:comment", vi.fn());
    const frame = lastFrame() ?? "";
    expect(frame).toContain("mode: overlay:comment");
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const { stdin } = renderHelpOverlay("normal", onClose);
    await delay(50);

    stdin.write("\x1b"); // Escape key
    await delay(50);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose for non-escape keys", async () => {
    const onClose = vi.fn();
    const { stdin } = renderHelpOverlay("normal", onClose);
    await delay(50);

    stdin.write("q");
    await delay(50);

    expect(onClose).not.toHaveBeenCalled();
  });
});
