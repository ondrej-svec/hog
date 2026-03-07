import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubIssue } from "../../github.js";
import type { RepoData } from "../fetch.js";
import {
  agentWindowName,
  breakPane,
  isPaneAlive,
  joinAgentPane,
  killPane,
  splitWithInfo,
  windowExists,
} from "../tmux-pane.js";
import type { UseUIStateResult } from "./use-ui-state.js";

// ── Constants ──

/** Default width percentage for the zen right pane. */
const ZEN_PANE_WIDTH_PERCENT = 65;

/** Minimum terminal width to allow zen mode. */
const ZEN_MIN_COLS = 100;

/** Debounce delay (ms) for cursor-follow pane swap. */
const CURSOR_FOLLOW_DEBOUNCE_MS = 150;

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
  zenPaneId: string | null;
  zenIsAgentPane: boolean;
  /** Toggle zen mode on/off (Z key). */
  handleToggleZen: () => void;
  /** After launching Claude in zen mode, swap the right pane to the new agent window. */
  swapToAgent: (issueNumber: number) => void;
}

// ── Helpers ──

function findIssue(
  repos: RepoData[],
  selectedId: string | null,
): { issue: GitHubIssue; repoName: string } | null {
  if (!selectedId?.startsWith("gh:")) return null;
  for (const rd of repos) {
    for (const issue of rd.issues) {
      if (`gh:${rd.repo.name}:${issue.number}` === selectedId)
        return { issue, repoName: rd.repo.name };
    }
  }
  return null;
}

function cleanupPane(paneId: string, isAgent: boolean): void {
  if (isAgent) {
    breakPane(paneId);
  } else {
    killPane(paneId);
  }
}

function openOrSplitPane(issue: GitHubIssue): { paneId: string; isAgent: boolean } | null {
  const winName = agentWindowName(issue.number);
  const hasAgent = windowExists(winName);

  if (hasAgent) {
    const paneId = joinAgentPane(winName, ZEN_PANE_WIDTH_PERCENT);
    return paneId ? { paneId, isAgent: true } : null;
  }
  const paneId = splitWithInfo({ title: issue.title, url: issue.url }, ZEN_PANE_WIDTH_PERCENT);
  return paneId ? { paneId, isAgent: false } : null;
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
  const [zenIsAgentPane, setZenIsAgentPane] = useState(false);

  // Refs to avoid stale closures in callbacks/effects
  const paneRef = useRef<{ id: string | null; isAgent: boolean }>({
    id: null,
    isAgent: false,
  });
  paneRef.current = { id: zenPaneId, isAgent: zenIsAgentPane };

  const exitZen = useCallback(() => {
    const { id, isAgent } = paneRef.current;
    if (id) {
      cleanupPane(id, isAgent);
      setZenPaneId(null);
      setZenIsAgentPane(false);
    }
    ui.exitZen();
  }, [ui]);

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

    const found = findIssue(repos, selectedId);
    const result = found ? openOrSplitPane(found.issue) : null;

    if (!result) {
      toast.error("Failed to create tmux pane");
      return;
    }

    setZenPaneId(result.paneId);
    setZenIsAgentPane(result.isAgent);
    ui.enterZen();
  }, [ui, toast, termCols, exitZen, repos, selectedId]);

  // Swap right pane to a newly launched agent window (called from handleLaunchClaude)
  const swapToAgent = useCallback(
    (issueNumber: number) => {
      const { id, isAgent } = paneRef.current;
      if (ui.state.mode !== "zen" || !id) return;

      cleanupPane(id, isAgent);

      // Small delay for tmux window to be created
      setTimeout(() => {
        const winName = agentWindowName(issueNumber);
        if (windowExists(winName)) {
          const newPaneId = joinAgentPane(winName, ZEN_PANE_WIDTH_PERCENT);
          setZenPaneId(newPaneId);
          setZenIsAgentPane(true);
        }
      }, 500);
    },
    [ui.state.mode],
  );

  // Cursor-follow: swap right pane when selected issue changes (debounced)
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (ui.state.mode !== "zen" || !zenPaneId) {
      prevSelectedRef.current = selectedId;
      return;
    }
    if (selectedId === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedId;

    const timer = setTimeout(() => {
      const { id, isAgent } = paneRef.current;
      if (!id) return;

      const found = findIssue(repos, selectedId);
      if (!found) return;

      cleanupPane(id, isAgent);

      const result = openOrSplitPane(found.issue);
      if (!result) {
        // Pane creation failed — exit zen
        setZenPaneId(null);
        setZenIsAgentPane(false);
        ui.exitZen();
        toast.error("Zen pane lost — exiting zen mode");
        return;
      }

      setZenPaneId(result.paneId);
      setZenIsAgentPane(result.isAgent);
    }, CURSOR_FOLLOW_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [ui.state.mode, zenPaneId, selectedId, repos, ui, toast]);

  // Dead pane detection: auto-exit if tmux pane was killed externally
  useEffect(() => {
    if (ui.state.mode !== "zen" || !zenPaneId) return;
    const interval = setInterval(() => {
      if (!isPaneAlive(zenPaneId)) {
        exitZen();
        toast.info("Zen pane closed");
      }
    }, DEAD_PANE_CHECK_MS);
    return () => clearInterval(interval);
  }, [ui.state.mode, zenPaneId, exitZen, toast]);

  return { zenPaneId, zenIsAgentPane, handleToggleZen, swapToAgent };
}
