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

  it("should transition to overlay:fuzzyPicker mode from normal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterFuzzyPicker();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:fuzzyPicker");
    expect(frame).toContain("canNav:no");
    expect(frame).toContain("isOverlay:yes");

    instance.unmount();
  });

  it("should block enterFuzzyPicker from non-normal mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.enterFuzzyPicker();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search"); // blocked

    instance.unmount();
  });

  it("should transition to overlay:editIssue mode from normal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterEditIssue();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:editIssue");
    expect(frame).toContain("canNav:no");
    expect(frame).toContain("isOverlay:yes");

    instance.unmount();
  });

  it("should block enterEditIssue from non-normal mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.enterEditIssue();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search"); // blocked

    instance.unmount();
  });

  it("should return from overlay:fuzzyPicker to normal on exitOverlay", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterFuzzyPicker();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:fuzzyPicker");

    ui.exitOverlay();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:normal");

    instance.unmount();
  });

  it("should return from overlay:editIssue to normal on exitOverlay", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterEditIssue();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:editIssue");

    ui.exitOverlay();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:normal");

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

  it("should transition to overlay:status from normal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterStatus();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:status");
    expect(frame).toContain("canNav:no");
    expect(frame).toContain("isOverlay:yes");

    instance.unmount();
  });

  it("should block enterStatus from non-normal non-bulkAction mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.enterStatus();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search");

    instance.unmount();
  });

  it("should transition to overlay:status from overlay:bulkAction with previousMode=multiSelect", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    // Get into multiSelect → bulkAction path
    ui.enterMultiSelect();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:multiSelect");

    ui.enterBulkAction();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:bulkAction");

    ui.enterStatus();
    await delay(50);
    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:status");

    // exitOverlay should return to multiSelect (the previousMode set by bulkAction→status)
    ui.exitOverlay();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:multiSelect");

    instance.unmount();
  });

  it("should transition to overlay:create from normal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterCreate();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:create");
    expect(frame).toContain("canNav:no");
    expect(frame).toContain("isOverlay:yes");

    instance.unmount();
  });

  it("should block enterCreate from non-normal mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.enterCreate();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search");

    instance.unmount();
  });

  it("should transition to overlay:createNl from normal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterCreateNl();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:createNl");
    expect(frame).toContain("canNav:no");
    expect(frame).toContain("isOverlay:yes");

    instance.unmount();
  });

  it("should block enterCreateNl from non-normal mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.enterCreateNl();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search");

    instance.unmount();
  });

  it("should transition to overlay:label from normal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterLabel();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:label");
    expect(frame).toContain("canNav:no");
    expect(frame).toContain("isOverlay:yes");

    instance.unmount();
  });

  it("should block enterLabel from non-normal mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.enterLabel();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search");

    instance.unmount();
  });

  it("should transition to multiSelect from normal", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterMultiSelect();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:multiSelect");
    expect(frame).toContain("canNav:yes");
    expect(frame).toContain("canAct:no");
    expect(frame).toContain("isOverlay:no");

    instance.unmount();
  });

  it("should allow enterMultiSelect when already in multiSelect mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterMultiSelect();
    await delay(50);
    ui.enterMultiSelect();
    await delay(50);

    expect(instance.lastFrame()!).toContain("mode:multiSelect");

    instance.unmount();
  });

  it("should block enterMultiSelect from non-normal non-multiSelect mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.enterMultiSelect();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search");

    instance.unmount();
  });

  it("should transition to overlay:bulkAction from multiSelect", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterMultiSelect();
    await delay(50);

    ui.enterBulkAction();
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:overlay:bulkAction");
    expect(frame).toContain("canNav:no");
    expect(frame).toContain("isOverlay:yes");

    instance.unmount();
  });

  it("should block enterBulkAction from non-multiSelect mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterBulkAction();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:normal");

    instance.unmount();
  });

  it("should transition to overlay:confirmPick from any mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    // From normal
    ui.enterConfirmPick();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:confirmPick");

    instance.unmount();
  });

  it("should transition to overlay:confirmPick from overlay:create", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    ui.enterCreate();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:create");

    ui.enterConfirmPick();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:confirmPick");

    instance.unmount();
  });

  it("should clear multiSelect and return to normal via clearMultiSelect", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterMultiSelect();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:multiSelect");

    ui.clearMultiSelect();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:normal");

    instance.unmount();
  });

  it("should do nothing when clearMultiSelect is called from non-multiSelect mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;
    ui.enterSearch();
    await delay(50);

    ui.clearMultiSelect();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:search");

    instance.unmount();
  });

  it("should toggle helpVisible on and off", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    // Start: help off
    expect(instance.lastFrame()!).toContain("help:no");

    // Toggle on
    ui.toggleHelp();
    await delay(50);
    expect(instance.lastFrame()!).toContain("help:yes");

    // Toggle off again
    ui.toggleHelp();
    await delay(50);
    expect(instance.lastFrame()!).toContain("help:no");

    instance.unmount();
  });

  it("should toggle help while in multiSelect mode without changing mode", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    ui.enterMultiSelect();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:multiSelect");

    ui.toggleHelp();
    await delay(50);
    const frame = instance.lastFrame()!;
    expect(frame).toContain("mode:multiSelect");
    expect(frame).toContain("help:yes");

    ui.exitOverlay();
    await delay(50);
    const afterExit = instance.lastFrame()!;
    expect(afterExit).toContain("mode:multiSelect");
    expect(afterExit).toContain("help:no");

    instance.unmount();
  });

  it("should exitOverlay from normal mode returning to previousMode (normal)", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    // exitOverlay when already at normal just stays normal
    ui.exitOverlay();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:normal");

    instance.unmount();
  });

  it("should return from overlay:bulkAction to multiSelect on exitOverlay", async () => {
    const instance = render(React.createElement(UIStateTester));
    await delay(50);

    const ui = (globalThis as Record<string, unknown>)["__uiState"] as ReturnType<
      typeof useUIState
    >;

    ui.enterMultiSelect();
    await delay(50);
    ui.enterBulkAction();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:overlay:bulkAction");

    ui.exitOverlay();
    await delay(50);
    expect(instance.lastFrame()!).toContain("mode:multiSelect");

    instance.unmount();
  });
});
