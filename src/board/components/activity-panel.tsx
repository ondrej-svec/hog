import { Box, Text } from "ink";
import { timeAgo } from "../constants.js";
import type { ActivityEvent } from "../fetch.js";

interface ActivityPanelProps {
  readonly events: ActivityEvent[];
  readonly selectedIdx: number;
  readonly isActive: boolean;
  readonly height: number;
}

export function ActivityPanel({ events, selectedIdx, isActive, height }: ActivityPanelProps) {
  const borderColor = isActive ? "cyan" : "gray";
  // Reserve 2 rows for border + label, clip event rows to remaining height
  const maxRows = Math.max(1, height - 2);
  const visible = events.slice(0, maxRows);

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      flexDirection="column"
      height={height}
      overflow="hidden"
    >
      <Text bold color={isActive ? "cyan" : "white"}>
        [4] Activity
      </Text>
      {visible.length === 0 ? (
        <Text color="gray"> No recent activity</Text>
      ) : (
        visible.map((event, i) => {
          const isSel = isActive && i === selectedIdx;
          const ago = timeAgo(event.timestamp);
          return (
            <Box key={`${event.repoShortName}:${event.issueNumber}:${i}`}>
              <Text color={isSel ? "cyan" : "gray"} bold={isSel}>
                {isSel ? "\u25B6 " : "  "}
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
    </Box>
  );
}

export type { ActivityPanelProps };
