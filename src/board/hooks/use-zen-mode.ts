import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoData } from "../fetch.js";
import {
  agentWindowName,
  breakPane,
  isPaneAlive,
  joinAgentPane,
  windowExists,
} from "../tmux-pane.js";
import type { UseUIStateResult } from "./use-ui-state.js";

// ── Constants ──

/** Default width percentage for the zen right pane. */
const ZEN_PANE_WIDTH_PERCENT = 65;

/** Minimum terminal width to allow zen mode. */
const ZEN_MIN_COLS = 100;

/** Debounce delay (ms) for cursor-follow pane swap. */
const CURSOR_FOLLOW_DEBOUNCE_MS = 200;

/** Interval (ms) for dead-pane detection. */
const DEAD_PANE_CHECK_MS = 2000;

// ── Types ──

interface UseZenModeOptions {
  ui: UseUIStateResult;
  toast: { info: (msg: string) => void; error: (msg: string) => void };
  termCols: number;
  repos: RepoData[];
  selectedId: string | null;
}

interface UseZenModeResult {
  /** Non-null when a tmux agent pane is joined into the current window. */
  zenPaneId: string | null;
  /** Toggle zen mode on/off (Z key). */
  handleToggleZen: () => void;
  /** After launching Claude in zen mode, swap the right pane to the new agent window. */
  swapToAgent: (issueNumber: number) => void;
}

// ── Helpers ──

function issueNumberFromId(selectedId: string | null): number | null {
  if (!selectedId?.startsWith("gh:")) return null;
  const parts = selectedId.split(":");
  const num = Number(parts[2]);
  return Number.isNaN(num) ? null : num;
}

/** Try to join an agent's tmux pane. Returns pane ID or null if no agent exists. */
function tryJoinAgent(issueNumber: number): string | null {
  const winName = agentWindowName(issueNumber);
  if (!windowExists(winName)) return null;
  return joinAgentPane(winName, ZEN_PANE_WIDTH_PERCENT);
}

// ── Hook ──

export function useZenMode({
  ui,
  toast,
  termCols,
  repos,
  selectedId,
}: UseZenModeOptions): UseZenModeResult {
  const [zenPaneId, setZenPaneId] = useState<string | null>(null);

  // Ref to avoid stale closures in callbacks/effects
  const paneRef = useRef<string | null>(null);
  paneRef.current = zenPaneId;

  const cleanupCurrentPane = useCallback(() => {
    const id = paneRef.current;
    if (id) {
      breakPane(id);
      setZenPaneId(null);
    }
  }, []);

  const exitZen = useCallback(() => {
    cleanupCurrentPane();
    ui.exitZen();
  }, [ui, cleanupCurrentPane]);

  const handleToggleZen = useCallback(() => {
    if (ui.state.mode === "zen") {
      exitZen();
      return;
    }
    if (!process.env["TMUX"]) {
      toast.error("Zen mode requires tmux");
      return;
    }
    if (termCols < ZEN_MIN_COLS) {
      toast.error("Terminal too narrow for Zen mode");
      return;
    }

    // Try to join an existing agent pane for the selected issue
    const issueNum = issueNumberFromId(selectedId);
    if (issueNum) {
      const paneId = tryJoinAgent(issueNum);
      if (paneId) setZenPaneId(paneId);
      // If no agent, zenPaneId stays null — detail panel shown in TUI
    }

    ui.enterZen();
  }, [ui, toast, termCols, exitZen, selectedId]);

  // Swap right pane to a newly launched agent window (called from handleLaunchClaude)
  const swapToAgent = useCallback(
    (issueNumber: number) => {
      if (ui.state.mode !== "zen") return;

      cleanupCurrentPane();

      // Small delay for tmux window to be created
      setTimeout(() => {
        const paneId = tryJoinAgent(issueNumber);
        if (paneId) setZenPaneId(paneId);
      }, 500);
    },
    [ui.state.mode, cleanupCurrentPane],
  );

  // Cursor-follow: swap right pane when selected issue changes (debounced)
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (ui.state.mode !== "zen") {
      prevSelectedRef.current = selectedId;
      return;
    }
    if (selectedId === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedId;

    const timer = setTimeout(() => {
      // Clean up current agent pane (if any)
      const currentId = paneRef.current;
      if (currentId) {
        breakPane(currentId);
      }

      // Try to join the new issue's agent pane
      const issueNum = issueNumberFromId(selectedId);
      const newPaneId = issueNum ? tryJoinAgent(issueNum) : null;
      setZenPaneId(newPaneId);
    }, CURSOR_FOLLOW_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [ui.state.mode, selectedId, repos]);

  // Dead pane detection: auto-cleanup if tmux pane was killed externally
  useEffect(() => {
    if (ui.state.mode !== "zen" || !zenPaneId) return;
    const interval = setInterval(() => {
      if (!isPaneAlive(zenPaneId)) {
        setZenPaneId(null);
        toast.info("Agent pane closed");
      }
    }, DEAD_PANE_CHECK_MS);
    return () => clearInterval(interval);
  }, [ui.state.mode, zenPaneId, toast]);

  return { zenPaneId, handleToggleZen, swapToAgent };
}
