import { Box } from "ink";
import type { ReactNode } from "react";

// ── Breakpoints ──

export const WIDE_THRESHOLD = 160; // full 5-panel layout
export const MEDIUM_THRESHOLD = 100; // 2-column (left + issues), no detail
export const LEFT_COL_WIDTH = 24;
export const ACTIVITY_HEIGHT = 5;

export type LayoutMode = "wide" | "medium" | "stacked";

export function getLayoutMode(cols: number): LayoutMode {
  if (cols >= WIDE_THRESHOLD) return "wide";
  if (cols >= MEDIUM_THRESHOLD) return "medium";
  return "stacked";
}

export function getDetailWidth(cols: number): number {
  return Math.floor(cols * 0.4);
}

// ── Panel slots ──

interface PanelLayoutProps {
  readonly cols: number;
  readonly issuesPanelHeight: number;
  readonly reposPanel: ReactNode;
  readonly statusesPanel: ReactNode;
  readonly issuesPanel: ReactNode;
  readonly detailPanel: ReactNode;
  readonly activityPanel: ReactNode;
}

export function PanelLayout({
  cols,
  issuesPanelHeight,
  reposPanel,
  statusesPanel,
  issuesPanel,
  detailPanel,
  activityPanel,
}: PanelLayoutProps) {
  const mode = getLayoutMode(cols);

  if (mode === "wide") {
    const detailWidth = getDetailWidth(cols);
    return (
      <Box flexDirection="column">
        {/* Main row: left col + issues + detail */}
        <Box height={issuesPanelHeight}>
          {/* Left column: repos + statuses stacked */}
          <Box flexDirection="column" width={LEFT_COL_WIDTH}>
            {reposPanel}
            {statusesPanel}
          </Box>
          {/* Issues panel fills remaining space */}
          <Box flexGrow={1} flexDirection="column">
            {issuesPanel}
          </Box>
          {/* Detail panel on the right */}
          <Box width={detailWidth} flexDirection="column">
            {detailPanel}
          </Box>
        </Box>
        {/* Activity strip full width */}
        <Box height={ACTIVITY_HEIGHT}>{activityPanel}</Box>
      </Box>
    );
  }

  if (mode === "medium") {
    return (
      <Box flexDirection="column">
        {/* Main row: left col + issues (no detail) */}
        <Box height={issuesPanelHeight}>
          <Box flexDirection="column" width={LEFT_COL_WIDTH}>
            {reposPanel}
            {statusesPanel}
          </Box>
          <Box flexGrow={1} flexDirection="column">
            {issuesPanel}
          </Box>
        </Box>
        {/* Activity strip full width */}
        <Box height={ACTIVITY_HEIGHT}>{activityPanel}</Box>
      </Box>
    );
  }

  // Stacked (<100 cols): all panels full width, fixed heights
  return (
    <Box flexDirection="column">
      {reposPanel}
      {statusesPanel}
      <Box flexGrow={1} flexDirection="column">
        {issuesPanel}
      </Box>
      <Box height={ACTIVITY_HEIGHT}>{activityPanel}</Box>
    </Box>
  );
}

export type { PanelLayoutProps };
