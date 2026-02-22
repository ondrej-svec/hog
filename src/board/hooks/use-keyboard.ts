import { useInput } from "ink";
import { useCallback } from "react";
import type { GitHubIssue } from "../../github.js";
import type { UseMultiSelectResult } from "./use-multi-select.js";
import type { UseNavigationResult } from "./use-navigation.js";
import type { UseUIStateResult } from "./use-ui-state.js";

// ── Types ──

interface KeyboardActions {
  exit: () => void;
  refresh: () => void;
  handleSlack: () => void;
  handleCopyLink: () => void;
  handleOpen: () => void;
  handleEnterFocus: () => void;
  handlePick: () => void;
  handleAssign: () => void;
  handleEnterLabel: () => void;
  handleEnterCreateNl: () => void;
  handleErrorAction: (action: "dismiss" | "retry") => boolean;
  toastInfo: (msg: string) => void;
  handleToggleMine: () => void;
  handleEnterFuzzyPicker: () => void;
  handleEnterEditIssue: () => void;
  handleUndo: () => void;
  handleToggleLog: () => void;
}

interface UseKeyboardOptions {
  ui: UseUIStateResult;
  nav: Pick<UseNavigationResult, "moveUp" | "moveDown" | "selectedId">;
  multiSelect: Pick<UseMultiSelectResult, "count" | "toggle" | "clear">;
  selectedIssue: GitHubIssue | null;
  selectedRepoStatusOptionsLength: number;
  actions: KeyboardActions;
  onSearchEscape: () => void;
  tabNav: {
    next: () => void;
    prev: () => void;
    jumpTo: (idx: number) => void;
    count: number;
  };
  statusNav: {
    next: () => void;
    prev: () => void;
  } | null;
}

/** Sets up all useInput keyboard handlers for the board. */
export function useKeyboard({
  ui,
  nav,
  multiSelect,
  selectedIssue,
  selectedRepoStatusOptionsLength,
  actions,
  onSearchEscape,
  tabNav,
  statusNav,
}: UseKeyboardOptions): void {
  const {
    exit,
    refresh,
    handleSlack,
    handleCopyLink,
    handleOpen,
    handleEnterFocus,
    handlePick,
    handleAssign,
    handleEnterLabel,
    handleEnterCreateNl,
    handleErrorAction,
    toastInfo,
    handleToggleMine,
    handleEnterFuzzyPicker,
    handleEnterEditIssue,
    handleUndo,
    handleToggleLog,
  } = actions;

  const handleInput = useCallback(
    (
      input: string,
      key: {
        downArrow: boolean;
        upArrow: boolean;
        tab: boolean;
        shift: boolean;
        return: boolean;
        escape: boolean;
      },
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keyboard handler with many shortcuts
    ) => {
      // Help toggle works in any state
      if (input === "?") {
        ui.toggleHelp();
        return;
      }

      // Escape: in multiSelect, clear selection and return to normal
      // In focus mode, FocusMode component handles Escape
      if (key.escape && ui.state.mode !== "focus") {
        if (ui.state.mode === "multiSelect") {
          multiSelect.clear();
        }
        ui.exitOverlay();
        return;
      }

      // Navigation (works in normal, multiSelect, focus)
      if (ui.canNavigate) {
        if (input === "j" || key.downArrow) {
          nav.moveDown();
          return;
        }
        if (input === "k" || key.upArrow) {
          nav.moveUp();
          return;
        }
        if (key.tab) {
          // Tab switch clears selection (per spec: "changing tab")
          if (ui.state.mode === "multiSelect") {
            multiSelect.clear();
            ui.clearMultiSelect();
          }
          key.shift ? tabNav.prev() : tabNav.next();
          return;
        }
      }

      // Multi-select mode actions
      if (ui.state.mode === "multiSelect") {
        // Space toggles selection on current item
        if (input === " ") {
          const id = nav.selectedId;
          if (id) {
            multiSelect.toggle(id);
          }
          return;
        }
        // Enter opens bulk action menu when items are selected
        if (key.return) {
          if (multiSelect.count > 0) {
            ui.enterBulkAction();
          }
          return;
        }
        // 'm' in multiSelect with selection opens bulk action menu
        if (input === "m" && multiSelect.count > 0) {
          ui.enterBulkAction();
          return;
        }
        return; // No other actions in multiSelect mode
      }

      // Toast error actions (dismiss/retry) — work in normal mode
      if (input === "d") {
        if (handleErrorAction("dismiss")) return;
      }
      if (input === "r" && handleErrorAction("retry")) return;

      // Actions (only in normal mode)
      if (ui.canAct) {
        // Digit 1-9: jump directly to a tab
        const digit = parseInt(input, 10);
        if (!Number.isNaN(digit) && digit >= 1 && digit <= tabNav.count) {
          tabNav.jumpTo(digit - 1);
          return;
        }

        if (input === "/") {
          multiSelect.clear();
          ui.enterSearch();
          return;
        }
        if (input === "q") {
          exit();
          return;
        }
        if (input === "r" || input === "R") {
          multiSelect.clear();
          refresh();
          return;
        }
        if (input === "s") {
          statusNav?.next();
          return;
        }
        if (input === "S") {
          statusNav?.prev();
          return;
        }
        if (input === "o") {
          handleSlack();
          return;
        }
        if (input === "y") {
          handleCopyLink();
          return;
        }
        if (input === "p") {
          handlePick();
          return;
        }
        if (input === "a") {
          handleAssign();
          return;
        }
        if (input === "u") {
          handleUndo();
          return;
        }
        if (input === "L") {
          handleToggleLog();
          return;
        }
        if (input === "c") {
          if (selectedIssue) {
            multiSelect.clear();
            ui.enterComment();
          }
          return;
        }
        if (input === "m") {
          if (selectedIssue && selectedRepoStatusOptionsLength > 0) {
            multiSelect.clear();
            ui.enterStatus();
          } else if (selectedIssue) {
            toastInfo("Issue not in a project board");
          }
          return;
        }
        if (input === "n") {
          multiSelect.clear();
          ui.enterCreate();
          return;
        }
        if (input === "f") {
          handleEnterFocus();
          return;
        }
        if (input === "l") {
          if (selectedIssue) {
            multiSelect.clear();
            handleEnterLabel();
          }
          return;
        }
        if (input === "I") {
          handleEnterCreateNl();
          return;
        }
        if (input === "t") {
          handleToggleMine();
          return;
        }
        if (input === "F") {
          handleEnterFuzzyPicker();
          return;
        }
        if (input === "e") {
          if (selectedIssue) {
            handleEnterEditIssue();
          }
          return;
        }

        // Space on an item: toggle selection + enter multiSelect mode
        if (input === " ") {
          const id = nav.selectedId;
          if (id) {
            multiSelect.toggle(id);
            ui.enterMultiSelect();
          }
          return;
        }

        if (key.return) {
          handleOpen();
          return;
        }
      }
    },
    [
      ui,
      nav,
      tabNav,
      statusNav,
      exit,
      refresh,
      handleSlack,
      handleCopyLink,
      handleOpen,
      handlePick,
      handleAssign,
      handleEnterLabel,
      handleEnterCreateNl,
      selectedIssue,
      selectedRepoStatusOptionsLength,
      toastInfo,
      nav.selectedId,
      multiSelect,
      handleEnterFocus,
      handleErrorAction,
      handleToggleMine,
      handleEnterFuzzyPicker,
      handleEnterEditIssue,
      handleUndo,
      handleToggleLog,
    ],
  );

  // Active when NOT in a text-input overlay
  const inputActive =
    ui.state.mode === "normal" || ui.state.mode === "multiSelect" || ui.state.mode === "focus";
  useInput(handleInput, { isActive: inputActive });

  // Search mode input handler
  const handleSearchEscape = useCallback(
    (_input: string, key: { escape: boolean }) => {
      if (key.escape) {
        onSearchEscape();
      }
    },
    [onSearchEscape],
  );
  useInput(handleSearchEscape, { isActive: ui.state.mode === "search" });
}
