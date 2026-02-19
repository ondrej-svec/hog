import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubIssue } from "../../github.js";
import { useKeyboard } from "./use-keyboard.js";
import type { UseMultiSelectResult } from "./use-multi-select.js";
import type { UseNavigationResult } from "./use-navigation.js";
import type { UseUIStateResult } from "./use-ui-state.js";

// ── Mock ink's useInput ──
// We capture every (handler, options) pair registered during a render so we
// can invoke them directly in tests without needing a real TTY.

type InputHandler = (
  input: string,
  key: {
    downArrow: boolean;
    upArrow: boolean;
    tab: boolean;
    shift: boolean;
    return: boolean;
    escape: boolean;
  },
) => void;

interface RegisteredHandler {
  handler: InputHandler;
  options: { isActive: boolean };
}

const registeredHandlers: RegisteredHandler[] = [];

vi.mock("ink", () => ({
  useInput: (handler: InputHandler, options: { isActive: boolean }) => {
    registeredHandlers.push({ handler, options });
  },
}));

// ── Helpers ──

const noKey = {
  downArrow: false,
  upArrow: false,
  tab: false,
  shift: false,
  return: false,
  escape: false,
};

// ── Fixture factories ──

function makeUIState(modeOverride: UseUIStateResult["state"]["mode"] = "normal"): UseUIStateResult {
  const mode = modeOverride;
  return {
    state: { mode, helpVisible: false, previousMode: "normal" },
    canNavigate: mode === "normal" || mode === "multiSelect" || mode === "focus",
    canAct: mode === "normal",
    isOverlay: mode.startsWith("overlay:") || mode === "search",
    enterSearch: vi.fn(),
    enterComment: vi.fn(),
    enterStatus: vi.fn(),
    enterCreate: vi.fn(),
    enterCreateNl: vi.fn(),
    enterLabel: vi.fn(),
    enterMultiSelect: vi.fn(),
    enterBulkAction: vi.fn(),
    enterConfirmPick: vi.fn(),
    enterFocus: vi.fn(),
    enterFuzzyPicker: vi.fn(),
    enterEditIssue: vi.fn(),
    toggleHelp: vi.fn(),
    exitOverlay: vi.fn(),
    exitToNormal: vi.fn(),
    clearMultiSelect: vi.fn(),
  };
}

function makeNav(
  selectedId: string | null = "gh:owner/repo:1",
): Pick<
  UseNavigationResult,
  | "moveUp"
  | "moveDown"
  | "prevSection"
  | "nextSection"
  | "toggleSection"
  | "collapseAll"
  | "selectedId"
> {
  return {
    moveUp: vi.fn(),
    moveDown: vi.fn(),
    prevSection: vi.fn(),
    nextSection: vi.fn(),
    toggleSection: vi.fn(),
    collapseAll: vi.fn(),
    selectedId,
  };
}

function makeMultiSelect(count = 0): Pick<UseMultiSelectResult, "count" | "toggle" | "clear"> {
  return {
    count,
    toggle: vi.fn(),
    clear: vi.fn(),
  };
}

function makeActions() {
  return {
    exit: vi.fn(),
    refresh: vi.fn(),
    handleSlack: vi.fn(),
    handleCopyLink: vi.fn(),
    handleOpen: vi.fn(),
    handleEnterFocus: vi.fn(),
    handlePick: vi.fn(),
    handleAssign: vi.fn(),
    handleEnterLabel: vi.fn(),
    handleEnterCreateNl: vi.fn(),
    handleErrorAction: vi.fn().mockReturnValue(false),
    toastInfo: vi.fn(),
    handleToggleMine: vi.fn(),
    handleEnterFuzzyPicker: vi.fn(),
    handleEnterEditIssue: vi.fn(),
    handleUndo: vi.fn(),
    handleToggleLog: vi.fn(),
  };
}

function makeIssue(): GitHubIssue {
  return {
    number: 1,
    title: "Test issue",
    url: "https://github.com/owner/repo/issues/1",
    state: "open",
    updatedAt: "2024-01-01T00:00:00Z",
    labels: [],
  };
}

// ── Test harness ──

interface HarnessOptions {
  mode?: UseUIStateResult["state"]["mode"];
  selectedId?: string | null;
  selectedIssue?: GitHubIssue | null;
  selectedRepoStatusOptionsLength?: number;
  multiSelectCount?: number;
}

interface Harness {
  ui: ReturnType<typeof makeUIState>;
  nav: ReturnType<typeof makeNav>;
  multiSelect: ReturnType<typeof makeMultiSelect>;
  actions: ReturnType<typeof makeActions>;
  onSearchEscape: ReturnType<typeof vi.fn>;
  /** Fire the main keyboard handler (normal / multiSelect / focus input) */
  fire: (input: string, keyOverrides?: Partial<typeof noKey>) => void;
  /** Fire the search-mode handler */
  fireSearch: (input: string, keyOverrides?: Partial<typeof noKey>) => void;
}

function setup(opts: HarnessOptions = {}): Harness {
  const {
    mode = "normal",
    selectedId = "gh:owner/repo:1",
    selectedIssue = makeIssue(),
    selectedRepoStatusOptionsLength = 3,
    multiSelectCount = 0,
  } = opts;

  // Clear captured handlers before each render
  registeredHandlers.length = 0;

  const ui = makeUIState(mode);
  const nav = makeNav(selectedId);
  const multiSelect = makeMultiSelect(multiSelectCount);
  const actions = makeActions();
  const onSearchEscape = vi.fn();

  // Custom hook wrapper that exercises useKeyboard inside a hook context
  function useKeyboardTester() {
    useKeyboard({
      ui,
      nav,
      multiSelect,
      selectedIssue,
      selectedRepoStatusOptionsLength,
      actions: actions as unknown as Parameters<typeof useKeyboard>[0]["actions"],
      onSearchEscape,
    });
    // useInput is mocked — no real Ink output required
    return null;
  }

  const instance = render(React.createElement(useKeyboardTester));
  // Unmount immediately — we only need useInput to have been called
  instance.unmount();

  // Handler [0] = main (normal/multiSelect/focus), handler [1] = search
  const mainHandler = registeredHandlers[0]?.handler;
  const searchHandler = registeredHandlers[1]?.handler;

  function fire(input: string, keyOverrides: Partial<typeof noKey> = {}) {
    mainHandler?.(input, { ...noKey, ...keyOverrides });
  }

  function fireSearch(input: string, keyOverrides: Partial<typeof noKey> = {}) {
    searchHandler?.(input, { ...noKey, ...keyOverrides });
  }

  return { ui, nav, multiSelect, actions, onSearchEscape, fire, fireSearch };
}

// ── Tests ──

describe("useKeyboard", () => {
  beforeEach(() => {
    registeredHandlers.length = 0;
  });

  // ── Help toggle (any mode) ──

  describe("? key — toggles help in any navigable mode", () => {
    it("calls toggleHelp in normal mode", () => {
      const { ui, fire } = setup({ mode: "normal" });
      fire("?");
      expect(ui.toggleHelp).toHaveBeenCalledOnce();
    });

    it("calls toggleHelp in multiSelect mode", () => {
      const { ui, fire } = setup({ mode: "multiSelect" });
      fire("?");
      expect(ui.toggleHelp).toHaveBeenCalledOnce();
    });

    it("calls toggleHelp in focus mode", () => {
      const { ui, fire } = setup({ mode: "focus" });
      fire("?");
      expect(ui.toggleHelp).toHaveBeenCalledOnce();
    });
  });

  // ── Escape handling ──

  describe("Escape key", () => {
    it("calls exitOverlay in normal mode", () => {
      const { ui, fire } = setup({ mode: "normal" });
      fire("", { escape: true });
      expect(ui.exitOverlay).toHaveBeenCalledOnce();
    });

    it("clears multi-select and calls exitOverlay in multiSelect mode", () => {
      const { ui, multiSelect, fire } = setup({ mode: "multiSelect" });
      fire("", { escape: true });
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(ui.exitOverlay).toHaveBeenCalledOnce();
    });

    it("does NOT call exitOverlay in focus mode (FocusMode component handles it)", () => {
      const { ui, fire } = setup({ mode: "focus" });
      fire("", { escape: true });
      expect(ui.exitOverlay).not.toHaveBeenCalled();
    });
  });

  // ── Navigation keys ──

  describe("navigation keys (normal mode)", () => {
    it("j key calls moveDown", () => {
      const { nav, fire } = setup({ mode: "normal" });
      fire("j");
      expect(nav.moveDown).toHaveBeenCalledOnce();
    });

    it("downArrow calls moveDown", () => {
      const { nav, fire } = setup({ mode: "normal" });
      fire("", { downArrow: true });
      expect(nav.moveDown).toHaveBeenCalledOnce();
    });

    it("k key calls moveUp", () => {
      const { nav, fire } = setup({ mode: "normal" });
      fire("k");
      expect(nav.moveUp).toHaveBeenCalledOnce();
    });

    it("upArrow calls moveUp", () => {
      const { nav, fire } = setup({ mode: "normal" });
      fire("", { upArrow: true });
      expect(nav.moveUp).toHaveBeenCalledOnce();
    });

    it("Tab calls nextSection", () => {
      const { nav, fire } = setup({ mode: "normal" });
      fire("", { tab: true });
      expect(nav.nextSection).toHaveBeenCalledOnce();
    });

    it("Shift+Tab calls prevSection", () => {
      const { nav, fire } = setup({ mode: "normal" });
      fire("", { tab: true, shift: true });
      expect(nav.prevSection).toHaveBeenCalledOnce();
    });
  });

  describe("navigation keys (multiSelect mode)", () => {
    it("j key calls moveDown", () => {
      const { nav, fire } = setup({ mode: "multiSelect" });
      fire("j");
      expect(nav.moveDown).toHaveBeenCalledOnce();
    });

    it("k key calls moveUp", () => {
      const { nav, fire } = setup({ mode: "multiSelect" });
      fire("k");
      expect(nav.moveUp).toHaveBeenCalledOnce();
    });

    it("Tab clears multi-select and calls nextSection", () => {
      const { nav, multiSelect, ui, fire } = setup({ mode: "multiSelect" });
      fire("", { tab: true });
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(ui.clearMultiSelect).toHaveBeenCalledOnce();
      expect(nav.nextSection).toHaveBeenCalledOnce();
    });
  });

  describe("navigation keys (focus mode)", () => {
    it("j key calls moveDown", () => {
      const { nav, fire } = setup({ mode: "focus" });
      fire("j");
      expect(nav.moveDown).toHaveBeenCalledOnce();
    });

    it("k key calls moveUp", () => {
      const { nav, fire } = setup({ mode: "focus" });
      fire("k");
      expect(nav.moveUp).toHaveBeenCalledOnce();
    });
  });

  // ── Multi-select mode actions ──

  describe("multiSelect mode actions", () => {
    it("Space toggles the current item", () => {
      const { multiSelect, fire } = setup({
        mode: "multiSelect",
        selectedId: "gh:owner/repo:1",
      });
      fire(" ");
      expect(multiSelect.toggle).toHaveBeenCalledWith("gh:owner/repo:1");
    });

    it("Space does nothing when selected item is a header", () => {
      const { multiSelect, fire } = setup({
        mode: "multiSelect",
        selectedId: "header:repo",
      });
      fire(" ");
      expect(multiSelect.toggle).not.toHaveBeenCalled();
    });

    it("Space does nothing when selected item is a sub-header", () => {
      const { multiSelect, fire } = setup({
        mode: "multiSelect",
        selectedId: "sub:repo:In Progress",
      });
      fire(" ");
      expect(multiSelect.toggle).not.toHaveBeenCalled();
    });

    it("Enter opens bulk action menu when items are selected", () => {
      const { ui, fire } = setup({ mode: "multiSelect", multiSelectCount: 2 });
      fire("", { return: true });
      expect(ui.enterBulkAction).toHaveBeenCalledOnce();
    });

    it("Enter does nothing when no items are selected", () => {
      const { ui, fire } = setup({ mode: "multiSelect", multiSelectCount: 0 });
      fire("", { return: true });
      expect(ui.enterBulkAction).not.toHaveBeenCalled();
    });

    it("m key opens bulk action menu when items are selected", () => {
      const { ui, fire } = setup({ mode: "multiSelect", multiSelectCount: 1 });
      fire("m");
      expect(ui.enterBulkAction).toHaveBeenCalledOnce();
    });

    it("m key does nothing when no items are selected", () => {
      const { ui, fire } = setup({ mode: "multiSelect", multiSelectCount: 0 });
      fire("m");
      expect(ui.enterBulkAction).not.toHaveBeenCalled();
    });

    it("other action keys are ignored in multiSelect mode", () => {
      const { actions, fire } = setup({ mode: "multiSelect" });
      fire("q");
      expect(actions.exit).not.toHaveBeenCalled();
    });
  });

  // ── Normal mode action keys ──

  describe("normal mode — action keys", () => {
    it("/ enters search mode and clears multi-select", () => {
      const { ui, multiSelect, fire } = setup({ mode: "normal" });
      fire("/");
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(ui.enterSearch).toHaveBeenCalledOnce();
    });

    it("q calls exit", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("q");
      expect(actions.exit).toHaveBeenCalledOnce();
    });

    it("r calls refresh (and clears multi-select)", () => {
      const { actions, multiSelect, fire } = setup({ mode: "normal" });
      fire("r");
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(actions.refresh).toHaveBeenCalledOnce();
    });

    it("R calls refresh (and clears multi-select)", () => {
      const { actions, multiSelect, fire } = setup({ mode: "normal" });
      fire("R");
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(actions.refresh).toHaveBeenCalledOnce();
    });

    it("s calls handleSlack", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("s");
      expect(actions.handleSlack).toHaveBeenCalledOnce();
    });

    it("y calls handleCopyLink", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("y");
      expect(actions.handleCopyLink).toHaveBeenCalledOnce();
    });

    it("p calls handlePick", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("p");
      expect(actions.handlePick).toHaveBeenCalledOnce();
    });

    it("a calls handleAssign", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("a");
      expect(actions.handleAssign).toHaveBeenCalledOnce();
    });

    it("u calls handleUndo", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("u");
      expect(actions.handleUndo).toHaveBeenCalledOnce();
    });

    it("L calls handleToggleLog", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("L");
      expect(actions.handleToggleLog).toHaveBeenCalledOnce();
    });

    it("c enters comment mode when an issue is selected", () => {
      const { ui, multiSelect, fire } = setup({ mode: "normal", selectedIssue: makeIssue() });
      fire("c");
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(ui.enterComment).toHaveBeenCalledOnce();
    });

    it("c does nothing when no issue is selected", () => {
      const { ui, fire } = setup({ mode: "normal", selectedIssue: null });
      fire("c");
      expect(ui.enterComment).not.toHaveBeenCalled();
    });

    it("m enters status mode when issue is selected and status options exist", () => {
      const { ui, multiSelect, fire } = setup({
        mode: "normal",
        selectedIssue: makeIssue(),
        selectedRepoStatusOptionsLength: 2,
      });
      fire("m");
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(ui.enterStatus).toHaveBeenCalledOnce();
    });

    it("m shows toast when issue has no project board status options", () => {
      const { ui, actions, fire } = setup({
        mode: "normal",
        selectedIssue: makeIssue(),
        selectedRepoStatusOptionsLength: 0,
      });
      fire("m");
      expect(ui.enterStatus).not.toHaveBeenCalled();
      expect(actions.toastInfo).toHaveBeenCalledWith("Issue not in a project board");
    });

    it("m does nothing when no issue is selected", () => {
      const { ui, actions, fire } = setup({
        mode: "normal",
        selectedIssue: null,
        selectedRepoStatusOptionsLength: 3,
      });
      fire("m");
      expect(ui.enterStatus).not.toHaveBeenCalled();
      expect(actions.toastInfo).not.toHaveBeenCalled();
    });

    it("n enters create mode and clears multi-select", () => {
      const { ui, multiSelect, fire } = setup({ mode: "normal" });
      fire("n");
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(ui.enterCreate).toHaveBeenCalledOnce();
    });

    it("f calls handleEnterFocus", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("f");
      expect(actions.handleEnterFocus).toHaveBeenCalledOnce();
    });

    it("C calls collapseAll", () => {
      const { nav, fire } = setup({ mode: "normal" });
      fire("C");
      expect(nav.collapseAll).toHaveBeenCalledOnce();
    });

    it("l enters label mode when an issue is selected", () => {
      const { actions, multiSelect, fire } = setup({ mode: "normal", selectedIssue: makeIssue() });
      fire("l");
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(actions.handleEnterLabel).toHaveBeenCalledOnce();
    });

    it("l does nothing when no issue is selected", () => {
      const { actions, fire } = setup({ mode: "normal", selectedIssue: null });
      fire("l");
      expect(actions.handleEnterLabel).not.toHaveBeenCalled();
    });

    it("I calls handleEnterCreateNl", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("I");
      expect(actions.handleEnterCreateNl).toHaveBeenCalledOnce();
    });

    it("t calls handleToggleMine", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("t");
      expect(actions.handleToggleMine).toHaveBeenCalledOnce();
    });

    it("F calls handleEnterFuzzyPicker", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("F");
      expect(actions.handleEnterFuzzyPicker).toHaveBeenCalledOnce();
    });

    it("e calls handleEnterEditIssue when issue is selected", () => {
      const { actions, fire } = setup({ mode: "normal", selectedIssue: makeIssue() });
      fire("e");
      expect(actions.handleEnterEditIssue).toHaveBeenCalledOnce();
    });

    it("e does nothing when no issue is selected", () => {
      const { actions, fire } = setup({ mode: "normal", selectedIssue: null });
      fire("e");
      expect(actions.handleEnterEditIssue).not.toHaveBeenCalled();
    });
  });

  // ── Space in normal mode ──

  describe("Space key in normal mode", () => {
    it("on a regular item: toggles selection and enters multiSelect mode", () => {
      const { ui, multiSelect, fire } = setup({
        mode: "normal",
        selectedId: "gh:owner/repo:1",
      });
      fire(" ");
      expect(multiSelect.toggle).toHaveBeenCalledWith("gh:owner/repo:1");
      expect(ui.enterMultiSelect).toHaveBeenCalledOnce();
    });

    it("on a header item: calls toggleSection", () => {
      const { nav, ui, multiSelect, fire } = setup({
        mode: "normal",
        selectedId: "header:repo",
      });
      fire(" ");
      expect(nav.toggleSection).toHaveBeenCalledOnce();
      expect(multiSelect.toggle).not.toHaveBeenCalled();
      expect(ui.enterMultiSelect).not.toHaveBeenCalled();
    });

    it("on a sub-header item: calls toggleSection", () => {
      const { nav, multiSelect, fire } = setup({
        mode: "normal",
        selectedId: "sub:repo:Backlog",
      });
      fire(" ");
      expect(nav.toggleSection).toHaveBeenCalledOnce();
      expect(multiSelect.toggle).not.toHaveBeenCalled();
    });

    it("when nothing is selected: does nothing", () => {
      const { nav, ui, multiSelect, fire } = setup({
        mode: "normal",
        selectedId: null,
      });
      fire(" ");
      expect(multiSelect.toggle).not.toHaveBeenCalled();
      expect(ui.enterMultiSelect).not.toHaveBeenCalled();
      expect(nav.toggleSection).not.toHaveBeenCalled();
    });
  });

  // ── Enter in normal mode ──

  describe("Enter key in normal mode", () => {
    it("on a regular item: calls handleOpen", () => {
      const { actions, fire } = setup({ mode: "normal", selectedId: "gh:owner/repo:1" });
      fire("", { return: true });
      expect(actions.handleOpen).toHaveBeenCalledOnce();
    });

    it("on a header: calls toggleSection", () => {
      const { nav, actions, fire } = setup({ mode: "normal", selectedId: "header:repo" });
      fire("", { return: true });
      expect(nav.toggleSection).toHaveBeenCalledOnce();
      expect(actions.handleOpen).not.toHaveBeenCalled();
    });

    it("on a sub-header: calls toggleSection", () => {
      const { nav, actions, fire } = setup({
        mode: "normal",
        selectedId: "sub:repo:In Progress",
      });
      fire("", { return: true });
      expect(nav.toggleSection).toHaveBeenCalledOnce();
      expect(actions.handleOpen).not.toHaveBeenCalled();
    });
  });

  // ── Toast error action keys (d / r) ──

  describe("toast error action keys", () => {
    it("d calls handleErrorAction('dismiss')", () => {
      const { actions, fire } = setup({ mode: "normal" });
      fire("d");
      expect(actions.handleErrorAction).toHaveBeenCalledWith("dismiss");
    });

    it("r calls handleErrorAction('retry') — returns true stops propagation", () => {
      const { actions, fire } = setup({ mode: "normal" });
      actions.handleErrorAction.mockReturnValue(true);
      fire("r");
      expect(actions.handleErrorAction).toHaveBeenCalledWith("retry");
      // When handleErrorAction returns true the handler returns early, so refresh is NOT called
      expect(actions.refresh).not.toHaveBeenCalled();
    });

    it("r falls through to refresh when handleErrorAction('retry') returns false", () => {
      const { actions, multiSelect, fire } = setup({ mode: "normal" });
      actions.handleErrorAction.mockReturnValue(false);
      fire("r");
      expect(actions.handleErrorAction).toHaveBeenCalledWith("retry");
      expect(multiSelect.clear).toHaveBeenCalledOnce();
      expect(actions.refresh).toHaveBeenCalledOnce();
    });
  });

  // ── Search mode handler ──

  describe("search mode — Escape via search handler", () => {
    it("calls onSearchEscape when Escape is pressed", () => {
      const { onSearchEscape, fireSearch } = setup({ mode: "search" });
      fireSearch("", { escape: true });
      expect(onSearchEscape).toHaveBeenCalledOnce();
    });

    it("does not call onSearchEscape for non-Escape keys", () => {
      const { onSearchEscape, fireSearch } = setup({ mode: "search" });
      fireSearch("a", {});
      expect(onSearchEscape).not.toHaveBeenCalled();
    });
  });

  // ── isActive flags for the two useInput registrations ──

  describe("useInput isActive flags", () => {
    it("main handler is active in normal mode", () => {
      setup({ mode: "normal" });
      expect(registeredHandlers[0]?.options.isActive).toBe(true);
    });

    it("main handler is active in multiSelect mode", () => {
      setup({ mode: "multiSelect" });
      expect(registeredHandlers[0]?.options.isActive).toBe(true);
    });

    it("main handler is active in focus mode", () => {
      setup({ mode: "focus" });
      expect(registeredHandlers[0]?.options.isActive).toBe(true);
    });

    it("main handler is NOT active in search mode", () => {
      setup({ mode: "search" });
      expect(registeredHandlers[0]?.options.isActive).toBe(false);
    });

    it("main handler is NOT active in overlay:comment mode", () => {
      setup({ mode: "overlay:comment" });
      expect(registeredHandlers[0]?.options.isActive).toBe(false);
    });

    it("search handler is active in search mode", () => {
      setup({ mode: "search" });
      expect(registeredHandlers[1]?.options.isActive).toBe(true);
    });

    it("search handler is NOT active in normal mode", () => {
      setup({ mode: "normal" });
      expect(registeredHandlers[1]?.options.isActive).toBe(false);
    });
  });
});
