import { Box, Text } from "ink";

interface StatusTab {
  id: string;
  label: string;
  count: number;
}

interface StatusTabBarProps {
  readonly tabs: StatusTab[];
  readonly activeTabId: string | null;
  readonly totalWidth: number;
}

export function StatusTabBar({ tabs, activeTabId, totalWidth }: StatusTabBarProps) {
  if (tabs.length === 0) return null;
  return (
    <Box width={totalWidth}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <Box key={tab.id} marginRight={2}>
            <Text bold={isActive} color={isActive ? "cyan" : "gray"}>
              [{isActive ? "► " : ""}
              {tab.label} {tab.count}]
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export type { StatusTab, StatusTabBarProps };
