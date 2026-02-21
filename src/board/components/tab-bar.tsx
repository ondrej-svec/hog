import { Box, Text } from "ink";

interface Tab {
  id: string;
  label: string;
  count: number;
}

interface TabBarProps {
  readonly tabs: Tab[];
  readonly activeTabId: string | null;
  readonly totalWidth: number;
}

export function TabBar({ tabs, activeTabId, totalWidth }: TabBarProps) {
  return (
    <Box width={totalWidth}>
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        return (
          <Box key={tab.id} marginRight={2}>
            <Text bold={isActive} color={isActive ? "cyan" : "gray"}>
              {i + 1}:{tab.label} ({tab.count})
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export type { Tab, TabBarProps };
