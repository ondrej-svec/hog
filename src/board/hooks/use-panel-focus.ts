import { useCallback, useState } from "react";

// ── Types ──

/** 0=Detail, 1=Repos, 2=Statuses, 3=Issues, 4=Activity */
export type PanelId = 0 | 1 | 2 | 3 | 4;

export interface UsePanelFocusResult {
  activePanelId: PanelId;
  focusPanel: (id: PanelId) => void;
  isPanelActive: (id: PanelId) => boolean;
}

// ── Hook ──

export function usePanelFocus(initialPanel: PanelId = 3): UsePanelFocusResult {
  const [activePanelId, setActivePanelId] = useState<PanelId>(initialPanel);

  const focusPanel = useCallback((id: PanelId) => {
    setActivePanelId(id);
  }, []);

  const isPanelActive = useCallback((id: PanelId) => activePanelId === id, [activePanelId]);

  return { activePanelId, focusPanel, isPanelActive };
}
