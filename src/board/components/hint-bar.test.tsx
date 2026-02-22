import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { HintBarProps } from "./hint-bar.js";
import { HintBar } from "./hint-bar.js";

function renderHintBar(props: HintBarProps) {
  return render(React.createElement(HintBar, props));
}

describe("HintBar", () => {
  it("normal mode (panel 3): shows move and quit shortcuts", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "normal",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("j/k:move");
    expect(frame).toContain("q:quit");
  });

  it("search mode: shows [SEARCH] label", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "search",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[SEARCH]");
  });

  it("multiSelect mode: shows [MULTI-SELECT] with count", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "multiSelect",
      activePanelId: 3,
      multiSelectCount: 3,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[MULTI-SELECT]");
    expect(frame).toContain("3 selected");
  });

  it("focus mode: shows [FOCUS] label", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "focus",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[FOCUS]");
  });

  it("overlay:fuzzyPicker mode: shows fuzzy picker navigation hints", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "overlay:fuzzyPicker",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("↑↓/Ctrl-J/K:nav");
    expect(frame).toContain("Enter:jump");
    expect(frame).toContain("Esc:close");
  });

  it("overlay:status mode: shows generic overlay hints", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "overlay:status",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("j/k:nav");
    expect(frame).toContain("Enter:select");
    expect(frame).toContain("Esc:cancel");
  });

  it("overlay:comment mode: shows generic overlay hints", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "overlay:comment",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("j/k:nav");
    expect(frame).toContain("Esc:cancel");
  });

  it("normal mode (panel 3) with hasUndoable=true: shows u:undo shortcut", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "normal",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
      hasUndoable: true,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("u:undo");
  });

  it("normal mode (panel 3) with hasUndoable=false: does not show u:undo", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "normal",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
      hasUndoable: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("u:undo");
  });

  it("normal mode with searchQuery: shows filter with query", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "normal",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "my query",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    // Filter text may wrap across lines in narrow terminal; check for key parts
    expect(frame).toContain("filter:");
    expect(frame).toContain("my");
    expect(frame).toContain("query");
  });

  it("normal mode with mineOnly: shows filter:@me", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "normal",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: true,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("filter:@me");
  });

  it("search mode with searchQuery: shows the query", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "search",
      activePanelId: 3,
      multiSelectCount: 0,
      searchQuery: "bug",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[SEARCH]");
    expect(frame).toContain('"bug"');
  });

  it("normal mode panel 1 (Repos): shows repos navigation hints", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "normal",
      activePanelId: 1,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("j/k:move");
    expect(frame).toContain("Enter:filter");
  });

  it("normal mode panel 4 (Activity): shows activity navigation hints", () => {
    const { lastFrame } = renderHintBar({
      uiMode: "normal",
      activePanelId: 4,
      multiSelectCount: 0,
      searchQuery: "",
      mineOnly: false,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("j/k:scroll");
    expect(frame).toContain("Enter:jump");
  });
});
