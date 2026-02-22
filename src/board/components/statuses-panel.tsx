import { Box, Text } from "ink";

interface StatusItem {
  id: string;
  label: string;
  count: number;
}

interface StatusesPanelProps {
  readonly groups: StatusItem[];
  readonly selectedIdx: number;
  readonly isActive: boolean;
}

export function StatusesPanel({ groups, selectedIdx, isActive }: StatusesPanelProps) {
  const borderColor = isActive ? "cyan" : "gray";

  return (
    <Box borderStyle="single" borderColor={borderColor} flexDirection="column" flexGrow={1}>
      <Text bold color={isActive ? "cyan" : "white"}>
        [2] Statuses
      </Text>
      {groups.length === 0 ? (
        <Text color="gray"> —</Text>
      ) : (
        groups.map((group, i) => {
          const isSel = i === selectedIdx;
          return (
            <Box key={group.id}>
              <Text color={isSel ? "cyan" : isActive ? "white" : "gray"} bold={isSel}>
                {isSel ? "\u25B6 " : "  "}
                {group.label}
              </Text>
              <Text color="gray"> {group.count}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

export type { StatusItem, StatusesPanelProps };
