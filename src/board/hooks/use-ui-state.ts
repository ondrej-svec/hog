import { useCallback, useReducer } from "react";

// ── UI States ──

export type UIMode =
  | "normal"
  | "search"
  | "overlay:comment"
  | "overlay:status"
  | "overlay:create"
  | "overlay:createNl"
  | "overlay:label"
  | "overlay:bulkAction"
  | "overlay:confirmPick"
  | "overlay:help"
  | "overlay:fuzzyPicker"
  | "overlay:editIssue"
  | "multiSelect"
  | "focus";

export interface UIState {
  mode: UIMode;
  /** Help overlay stacks on top of any mode */
  helpVisible: boolean;
  /** Previous mode to return to (for overlays) */
  previousMode: UIMode;
}

// ── Actions ──

export type UIAction =
  | { type: "ENTER_SEARCH" }
  | { type: "ENTER_COMMENT" }
  | { type: "ENTER_STATUS" }
  | { type: "ENTER_CREATE" }
  | { type: "ENTER_CREATE_NL" }
  | { type: "ENTER_LABEL" }
  | { type: "ENTER_MULTI_SELECT" }
  | { type: "ENTER_BULK_ACTION" }
  | { type: "ENTER_CONFIRM_PICK" }
  | { type: "ENTER_FOCUS" }
  | { type: "ENTER_FUZZY_PICKER" }
  | { type: "ENTER_EDIT_ISSUE" }
  | { type: "TOGGLE_HELP" }
  | { type: "EXIT_OVERLAY" }
  | { type: "EXIT_TO_NORMAL" }
  | { type: "CLEAR_MULTI_SELECT" };

// ── Reducer ──

const INITIAL_STATE: UIState = {
  mode: "normal",
  helpVisible: false,
  previousMode: "normal",
};

function enterStatusMode(state: UIState): UIState {
  if (state.mode !== "normal" && state.mode !== "overlay:bulkAction") return state;
  const previousMode: UIMode = state.mode === "overlay:bulkAction" ? "multiSelect" : "normal";
  return { ...state, mode: "overlay:status", previousMode };
}

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "ENTER_SEARCH":
      if (state.mode !== "normal") return state;
      return { ...state, mode: "search", previousMode: "normal" };

    case "ENTER_COMMENT":
      if (state.mode !== "normal") return state;
      return { ...state, mode: "overlay:comment", previousMode: "normal" };

    case "ENTER_STATUS":
      return enterStatusMode(state);

    case "ENTER_CREATE":
      if (state.mode !== "normal") return state;
      return { ...state, mode: "overlay:create", previousMode: "normal" };

    case "ENTER_CREATE_NL":
      if (state.mode !== "normal") return state;
      return { ...state, mode: "overlay:createNl", previousMode: "normal" };

    case "ENTER_LABEL":
      if (state.mode !== "normal") return state;
      return { ...state, mode: "overlay:label", previousMode: "normal" };

    case "ENTER_MULTI_SELECT":
      if (state.mode !== "normal" && state.mode !== "multiSelect") return state;
      return { ...state, mode: "multiSelect", previousMode: "normal" };

    case "ENTER_BULK_ACTION":
      if (state.mode !== "multiSelect") return state;
      return { ...state, mode: "overlay:bulkAction", previousMode: "multiSelect" };

    case "ENTER_CONFIRM_PICK":
      // Can transition from create overlay (after success) or normal
      return { ...state, mode: "overlay:confirmPick", previousMode: "normal" };

    case "ENTER_FOCUS":
      if (state.mode !== "normal") return state;
      return { ...state, mode: "focus", previousMode: "normal" };

    case "ENTER_FUZZY_PICKER":
      if (state.mode !== "normal") return state;
      return { ...state, mode: "overlay:fuzzyPicker", previousMode: "normal" };

    case "ENTER_EDIT_ISSUE":
      if (state.mode !== "normal") return state;
      return { ...state, mode: "overlay:editIssue", previousMode: "normal" };

    case "TOGGLE_HELP":
      // Help stacks on any mode
      return { ...state, helpVisible: !state.helpVisible };

    case "EXIT_OVERLAY":
      // Close help first if visible, then return to previous mode
      if (state.helpVisible) {
        return { ...state, helpVisible: false };
      }
      return { ...state, mode: state.previousMode, previousMode: "normal" };

    case "EXIT_TO_NORMAL":
      return { ...state, mode: "normal", helpVisible: false, previousMode: "normal" };

    case "CLEAR_MULTI_SELECT":
      if (state.mode === "multiSelect") {
        return { ...state, mode: "normal", previousMode: "normal" };
      }
      return state;

    default:
      return state;
  }
}

// ── Derived state helpers ──

/** Whether navigation shortcuts (j/k/tab) should work */
export function canNavigate(state: UIState): boolean {
  const { mode } = state;
  return mode === "normal" || mode === "multiSelect" || mode === "focus";
}

/** Whether action shortcuts (p/a/u/c/m/s/n) should work */
export function canAct(state: UIState): boolean {
  return state.mode === "normal";
}

/** Whether the UI is in an overlay/input state */
export function isOverlay(state: UIState): boolean {
  return state.mode.startsWith("overlay:") || state.mode === "search";
}

// ── Hook ──

export interface UseUIStateResult {
  state: UIState;
  enterSearch: () => void;
  enterComment: () => void;
  enterStatus: () => void;
  enterCreate: () => void;
  enterCreateNl: () => void;
  enterLabel: () => void;
  enterMultiSelect: () => void;
  enterBulkAction: () => void;
  enterConfirmPick: () => void;
  enterFocus: () => void;
  enterFuzzyPicker: () => void;
  enterEditIssue: () => void;
  toggleHelp: () => void;
  exitOverlay: () => void;
  exitToNormal: () => void;
  clearMultiSelect: () => void;
  canNavigate: boolean;
  canAct: boolean;
  isOverlay: boolean;
}

export function useUIState(): UseUIStateResult {
  const [state, dispatch] = useReducer(uiReducer, INITIAL_STATE);

  return {
    state,
    enterSearch: useCallback(() => dispatch({ type: "ENTER_SEARCH" }), []),
    enterComment: useCallback(() => dispatch({ type: "ENTER_COMMENT" }), []),
    enterStatus: useCallback(() => dispatch({ type: "ENTER_STATUS" }), []),
    enterCreate: useCallback(() => dispatch({ type: "ENTER_CREATE" }), []),
    enterCreateNl: useCallback(() => dispatch({ type: "ENTER_CREATE_NL" }), []),
    enterLabel: useCallback(() => dispatch({ type: "ENTER_LABEL" }), []),
    enterMultiSelect: useCallback(() => dispatch({ type: "ENTER_MULTI_SELECT" }), []),
    enterBulkAction: useCallback(() => dispatch({ type: "ENTER_BULK_ACTION" }), []),
    enterConfirmPick: useCallback(() => dispatch({ type: "ENTER_CONFIRM_PICK" }), []),
    enterFocus: useCallback(() => dispatch({ type: "ENTER_FOCUS" }), []),
    enterFuzzyPicker: useCallback(() => dispatch({ type: "ENTER_FUZZY_PICKER" }), []),
    enterEditIssue: useCallback(() => dispatch({ type: "ENTER_EDIT_ISSUE" }), []),
    toggleHelp: useCallback(() => dispatch({ type: "TOGGLE_HELP" }), []),
    exitOverlay: useCallback(() => dispatch({ type: "EXIT_OVERLAY" }), []),
    exitToNormal: useCallback(() => dispatch({ type: "EXIT_TO_NORMAL" }), []),
    clearMultiSelect: useCallback(() => dispatch({ type: "CLEAR_MULTI_SELECT" }), []),
    canNavigate: canNavigate(state),
    canAct: canAct(state),
    isOverlay: isOverlay(state),
  };
}
