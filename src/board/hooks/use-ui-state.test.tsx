import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React, { useRef } from "react";
import { describe, expect, it } from "vitest";
import { canAct, canNavigate, isOverlay, useUIState } from "./use-ui-state.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Pure function tests ──

describe("canNavigate", () => {
  it("returns true for normal mode", () => {
    expect(canNavigate({ mode: "normal", helpVisible: false, previousMode: "normal" })).toBe(true);
  });

  it("returns true for multiSelect mode", () => {
    expect(canNavigate({ mode: "multiSelect", helpVisible: false, previousMode: "normal" })).toBe(
      true,
    );
  });

  it("returns true for focus mode", () => {
    expect(canNavigate({ mode: "focus", helpVisible: false, previousMode: "normal" })).toBe(true);
  });

  it("returns false for overlay:comment", () => {
    expect(
      canNavigate({ mode: "overlay:comment", helpVisible: false, previousMode: "normal" }),
    ).toBe(false);
  });

  it("returns false for overlay:status", () => {
    expect(
      canNavigate({ mode: "overlay:status", helpVisible: false, previousMode: "normal" }),
    ).toBe(false);
  });

  it("returns false for search", () => {
    expect(canNavigate({ mode: "search", helpVisible: false, previousMode: "normal" })).toBe(false);
  });
});

describe("canAct", () => {
  it("returns true only for normal mode", () => {
    expect(canAct({ mode: "normal", helpVisible: false, previousMode: "normal" })).toBe(true);
    expect(canAct({ mode: "search", helpVisible: false, previousMode: "normal" })).toBe(false);
    expect(canAct({ mode: "multiSelect", helpVisible: false, previousMode: "normal" })).toBe(false);
    expect(canAct({ mode: "focus", helpVisible: false, previousMode: "normal" })).toBe(false);
    expect(canAct({ mode: "overlay:comment", helpVisible: false, previousMode: "normal" })).toBe(
      false,
    );
  });
});

describe("isOverlay", () => {
  it("returns true for overlay modes and search", () => {
    expect(isOverlay({ mode: "overlay:comment", helpVisible: false, previousMode: "normal" })).toBe(
      true,
    );
    expect(isOverlay({ mode: "overlay:status", helpVisible: false, previousMode: "normal" })).toBe(
      true,
    );
    expect(isOverlay({ mode: "overlay:create", helpVisible: false, previousMode: "normal" })).toBe(
      true,
    );
    expect(isOverlay({ mode: "search", helpVisible: false, previousMode: "normal" })).toBe(true);
  });

  it("returns false for non-overlay modes", () => {
    expect(isOverlay({ mode: "normal", helpVisible: false, previousMode: "normal" })).toBe(false);
    expect(isOverlay({ mode: "multiSelect", helpVisible: false, previousMode: "normal" })).toBe(
      false,
    );
    expect(isOverlay({ mode: "focus", helpVisible: false, previousMode: "normal" })).toBe(false);
  });
});

// ── Hook integration tests ──

function UIStateTester() {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const ui = useUIState();

  // Expose transition functions via global for testing
  (globalThis as Record<string, unknown>)["__uiState"] = ui;

  return (
    <Box flexDirection="column">
      <Text>mode:{ui.state.mode}</Text>
      <Text>help:{ui.state.helpVisible ? "yes" : "no"}</Text>
      <Text>canNav:{ui.canNavigate ? "yes" : "no"}</Text>
      <Text>canAct:{ui.canAct ? "yes" : "no"}</Text>
      <Text>isOverlay:{ui.isOverlay ? "yes" : "no"}</Text>
      <Text>renders:{renderCountRef.current}</Text>
    </Box>
  );
}

describe("useUIState hook", () => {
  it("should start in normal mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:normal");
    expect(frame).toContain("help:no");
    expect(frame).toContain("canNav:yes");
    expect(frame).toContain("canAct:yes");
    expect(frame).toContain("isOverlay:no");

    instance.unmount();
  });

  it("should not render-loop", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(100);

    const frame = instance.lastFrame()!;
    const count = parseInt(frame.match(/renders:(\d+)/)![1]!, 10);
    expect(count).toBeLessThan(5);

    instance.unmount();
  });

  it("should transition to search mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();

    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:search");
    expect(frame).toContain("canNav:no");
    expect(frame).toContain("canAct:no");
    expect(frame).toContain("isOverlay:yes");

    instance.unmount();
  });

  it("should return to normal on exitOverlay", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterComment();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:comment");

    ui.exitOverlay();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:normal");

    instance.unmount();
  });

  it("should stack help on any mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    // Enter comment overlay
    ui.enterComment();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:comment");

    // Toggle help on top
    ui.toggleHelp();
    await delay(50);
    let frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:comment"); // mode unchanged
    expect(frame).toContain("help:yes"); // help visible

    // Close help via exitOverlay
    ui.exitOverlay();
    await delay(50);
    frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:comment"); // still in comment
    expect(frame).toContain("help:no"); // help closed

    // Close overlay returns to normal
    ui.exitOverlay();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:normal");

    instance.unmount();
  });

  it("should block transitions from non-normal to overlay", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    // Enter search first
    ui.enterSearch();
    await delay(50);

    // Trying to enter comment from search should be blocked
    ui.enterComment();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search"); // still search

    instance.unmount();
  });

  it("should transition to focus mode from normal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterFocus();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:focus");
    expect(frame).toContain("canNav:yes");
    expect(frame).toContain("canAct:no");
    expect(frame).toContain("isOverlay:no");

    instance.unmount();
  });

  it("should block enterFocus from non-normal mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.enterFocus();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search"); // blocked

    instance.unmount();
  });

  it("should return from focus to normal via exitToNormal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterFocus();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:focus");

    ui.exitToNormal();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:normal");

    instance.unmount();
  });

  it("should handle exitToNormal from any state", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    // Enter comment with help open
    ui.enterComment();
    ui.toggleHelp();
    await delay(50);

    // exitToNormal clears everything
    ui.exitToNormal();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:normal");
    expect(frame).toContain("help:no");

    instance.unmount();
  });
});
