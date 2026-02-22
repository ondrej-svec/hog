import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { PanelId, UsePanelFocusResult } from "./use-panel-focus.js";
import { usePanelFocus } from "./use-panel-focus.js";

// Test component that renders panel focus state and exposes the hook result
function panelFocusTester({ initialPanel }: { readonly initialPanel?: PanelId }) {
  const focus = usePanelFocus(initialPanel);
  (globalThis as Record<string, unknown>)["__testFocus"] = focus;
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, null, `active:${focus.activePanelId}`),
    React.createElement(Text, null, `is0:${String(focus.isPanelActive(0))}`),
    React.createElement(Text, null, `is1:${String(focus.isPanelActive(1))}`),
    React.createElement(Text, null, `is2:${String(focus.isPanelActive(2))}`),
    React.createElement(Text, null, `is3:${String(focus.isPanelActive(3))}`),
    React.createElement(Text, null, `is4:${String(focus.isPanelActive(4))}`),
  );
}

function wait(ms = 50) {
  return new Promise((r) => setTimeout(r, ms));
}

function getTestFocus(): UsePanelFocusResult {
  return (globalThis as Record<string, unknown>)["__testFocus"] as UsePanelFocusResult;
}

describe("usePanelFocus", () => {
  it("defaults to panel 3 (Issues)", async () => {
    const instance = render(React.createElement(panelFocusTester, {}));
    await wait();
    expect(instance.lastFrame()).toContain("active:3");
    instance.unmount();
  });

  it("can be initialized with a different panel", async () => {
    const instance = render(React.createElement(panelFocusTester, { initialPanel: 1 }));
    await wait();
    expect(instance.lastFrame()).toContain("active:1");
    instance.unmount();
  });

  it("focusPanel updates activePanelId", async () => {
    const instance = render(React.createElement(panelFocusTester, {}));
    await wait();
    getTestFocus().focusPanel(2);
    await wait();
    expect(instance.lastFrame()).toContain("active:2");
    instance.unmount();
  });

  it("isPanelActive returns true for active panel", async () => {
    const instance = render(React.createElement(panelFocusTester, { initialPanel: 1 }));
    await wait();
    expect(instance.lastFrame()).toContain("is1:true");
    instance.unmount();
  });

  it("isPanelActive returns false for inactive panel", async () => {
    const instance = render(React.createElement(panelFocusTester, { initialPanel: 1 }));
    await wait();
    expect(instance.lastFrame()).toContain("is2:false");
    instance.unmount();
  });

  it("isPanelActive updates after focusPanel", async () => {
    const instance = render(React.createElement(panelFocusTester, { initialPanel: 1 }));
    await wait();
    getTestFocus().focusPanel(0);
    await wait();
    const frame = instance.lastFrame()!;
    expect(frame).toContain("is0:true");
    expect(frame).toContain("is1:false");
    instance.unmount();
  });

  it("focusPanel supports all valid panel IDs (0-4)", async () => {
    const instance = render(React.createElement(panelFocusTester, {}));
    await wait();
    for (const id of [0, 1, 2, 3, 4] as const) {
      getTestFocus().focusPanel(id);
      await wait();
      expect(instance.lastFrame()).toContain(`active:${id}`);
    }
    instance.unmount();
  });
});
