import { Box, Text } from "ink";
import { timeAgo } from "../constants.js";
import type { ActivityEvent } from "../fetch.js";
import { Panel } from "./panel.js";

export interface ActivityPanelProps {
  readonly events: ActivityEvent[];
  readonly selectedIdx: number;
  readonly isActive: boolean;
  readonly height: number;
  readonly width: number;
}

export function ActivityPanel({
  events,
  selectedIdx,
  isActive,
  height,
  width,
}: ActivityPanelProps) {
  // Panel takes 1 row for top border text + 1 row for bottom border inside the inner Box
  // = 2 overhead rows → content rows = height - 2
  const maxRows = Math.max(1, height - 2);
  const visible = events.slice(0, maxRows);

  return (
    <Panel title="[4] Activity" isActive={isActive} width={width} height={height}>
      {visible.length === 0 ? (
        <Text color="gray"> No recent activity</Text>
      ) : (
        visible.map((event, i) => {
          const isSel = isActive && i === selectedIdx;
          const ago = timeAgo(event.timestamp);
          return (
            <Box key={`${event.repoShortName}:${event.issueNumber}:${i}`}>
              <Text color={isSel ? "cyan" : "gray"} bold={isSel}>
                {isSel ? "► " : "  "}
                {ago}
              </Text>
              <Text color={isSel ? "white" : "gray"}>
                {" "}
                @{event.actor} {event.summary}{" "}
              </Text>
              <Text dimColor>({event.repoShortName})</Text>
            </Box>
          );
        })
      )}
    </Panel>
  );
}
