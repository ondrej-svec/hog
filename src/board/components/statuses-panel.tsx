import { Box, Text } from "ink";
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
}

export function StatusesPanel({
  groups,
  selectedIdx,
  isActive,
  width,
  flexGrow,
}: StatusesPanelProps) {
  const maxLabel = Math.max(4, width - 8);

  return (
    <Panel title="[2] Statuses" isActive={isActive} width={width} flexGrow={flexGrow}>
      {groups.length === 0 ? (
        <Text color="gray">—</Text>
      ) : (
        groups.map((group, i) => {
          const isSel = i === selectedIdx;
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
        })
      )}
    </Panel>
  );
}
