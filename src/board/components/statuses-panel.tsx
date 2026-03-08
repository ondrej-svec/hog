import { Box, Text } from "ink";
import { computeViewportScroll } from "../hooks/use-viewport-scroll.js";
import { Panel } from "./panel.js";

export interface StatusItem {
  id: string;
  label: string;
  count: number;
}

export interface StatusesPanelProps {
  readonly groups: StatusItem[];
  readonly selectedIdx: number;
  readonly isActive: boolean;
  readonly width: number;
  readonly flexGrow?: number;
  /** Available height for this panel (including chrome). When set, enables scrolling. */
  readonly height?: number | undefined;
}

export function StatusesPanel({
  groups,
  selectedIdx,
  isActive,
  width,
  flexGrow,
  height,
}: StatusesPanelProps) {
  const maxLabel = Math.max(4, width - 8);

  // Panel chrome = 2 rows (title + bottom border)
  const contentRows = height != null ? Math.max(1, height - 2) : groups.length;
  const needsScroll = groups.length > contentRows;

  let visibleGroups = groups;
  let hasMoreAbove = false;
  let hasMoreBelow = false;
  let aboveCount = 0;
  let belowCount = 0;

  if (needsScroll) {
    const scroll = computeViewportScroll(
      groups.length,
      contentRows,
      selectedIdx,
      Math.max(0, selectedIdx - Math.floor(contentRows / 2)),
    );
    visibleGroups = groups.slice(scroll.scrollOffset, scroll.scrollOffset + scroll.visibleCount);
    hasMoreAbove = scroll.hasMoreAbove;
    hasMoreBelow = scroll.hasMoreBelow;
    aboveCount = scroll.aboveCount;
    belowCount = scroll.belowCount;
  }

  return (
    <Panel
      title="[2] Statuses"
      isActive={isActive}
      width={width}
      flexGrow={flexGrow}
      height={height}
    >
      {groups.length === 0 ? (
        <Text color="gray">—</Text>
      ) : (
        <>
          {hasMoreAbove ? (
            <Text color="gray" dimColor>
              {" "}
              ▲ {aboveCount} more
            </Text>
          ) : null}
          {visibleGroups.map((group) => {
            const actualIdx = groups.indexOf(group);
            const isSel = actualIdx === selectedIdx;
            const label = group.label.slice(0, maxLabel);
            return (
              <Box key={group.id}>
                <Text color={isSel ? "cyan" : isActive ? "white" : "gray"} bold={isSel}>
                  {isSel ? "► " : "  "}
                  {label}
                </Text>
                <Text color="gray"> {group.count}</Text>
              </Box>
            );
          })}
          {hasMoreBelow ? (
            <Text color="gray" dimColor>
              {" "}
              ▼ {belowCount} more
            </Text>
          ) : null}
        </>
      )}
    </Panel>
  );
}
