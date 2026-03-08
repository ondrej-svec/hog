import { Box } from "ink";
import type { ReactNode } from "react";

// ── Breakpoints ──

export const WIDE_THRESHOLD = 160; // full 5-panel layout
export const MEDIUM_THRESHOLD = 100; // 2-column (left + issues), no detail
export const LEFT_COL_WIDTH = 24;
export const ACTIVITY_HEIGHT = 5;
/** Height of the repos+statuses row in stacked layout */
export const STACKED_TOP_HEIGHT = 5;

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
  /** Total height available for the entire panel layout (panels + activity). */
  readonly totalHeight: number;
  readonly reposPanel: ReactNode;
  readonly statusesPanel: ReactNode;
  readonly issuesPanel: ReactNode;
  readonly detailPanel: ReactNode;
  readonly activityPanel: ReactNode;
  readonly hideLeftPanel?: boolean;
}

export function PanelLayout({
  cols,
  issuesPanelHeight,
  totalHeight,
  reposPanel,
  statusesPanel,
  issuesPanel,
  detailPanel,
  activityPanel,
  hideLeftPanel,
}: PanelLayoutProps) {
  const mode = getLayoutMode(cols);

  if (mode === "wide") {
    const detailWidth = getDetailWidth(cols);
    return (
      <Box flexDirection="column" height={totalHeight} overflow="hidden">
        {/* Main row: left col + issues + detail */}
        <Box height={issuesPanelHeight}>
          {/* Left column: repos + statuses stacked */}
          {!hideLeftPanel ? (
            <Box flexDirection="column" width={LEFT_COL_WIDTH}>
              {reposPanel}
              {statusesPanel}
            </Box>
          ) : null}
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
      <Box flexDirection="column" height={totalHeight} overflow="hidden">
        {/* Main row: left col + issues (no detail) */}
        <Box height={issuesPanelHeight}>
          {!hideLeftPanel ? (
            <Box flexDirection="column" width={LEFT_COL_WIDTH}>
              {reposPanel}
              {statusesPanel}
            </Box>
          ) : null}
          <Box flexGrow={1} flexDirection="column">
            {issuesPanel}
          </Box>
        </Box>
        {/* Activity strip full width */}
        <Box height={ACTIVITY_HEIGHT}>{activityPanel}</Box>
      </Box>
    );
  }

  // Stacked (<100 cols): repos + statuses side-by-side at top, issues below
  // usableWidth = cols - 2 (paddingX={1} on root Box)
  const usableWidth = cols - 2;
  const halfWidth = Math.floor(usableWidth / 2);
  return (
    <Box flexDirection="column" height={totalHeight} overflow="hidden">
      {!hideLeftPanel ? (
        <Box height={STACKED_TOP_HEIGHT} flexShrink={0}>
          <Box width={halfWidth} overflow="hidden">
            {reposPanel}
          </Box>
          <Box width={usableWidth - halfWidth} overflow="hidden">
            {statusesPanel}
          </Box>
        </Box>
      ) : null}
      <Box flexGrow={1} flexDirection="column">
        {issuesPanel}
      </Box>
      <Box height={ACTIVITY_HEIGHT}>{activityPanel}</Box>
    </Box>
  );
}

export type { PanelLayoutProps };
