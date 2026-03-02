import { Box, Text, useInput } from "ink";
import { useState } from "react";

export type BulkAction =
  | { type: "assign" }
  | { type: "statusChange" }
  | { type: "unassign" }
  | { type: "complete" }
  | { type: "delete" };

interface BulkActionMenuProps {
  readonly count: number;
  /** What kinds of items are selected */
  readonly selectionType: "github" | "mixed";
  readonly onSelect: (action: BulkAction) => void;
  readonly onCancel: () => void;
}

interface MenuItem {
  label: string;
  action: BulkAction;
}

function getMenuItems(selectionType: "github" | "mixed"): MenuItem[] {
  if (selectionType === "github") {
    return [
      { label: "Assign all to me", action: { type: "assign" } },
      { label: "Unassign all from me", action: { type: "unassign" } },
      { label: "Move status (all)", action: { type: "statusChange" } },
    ];
  }
  // Mixed: only show actions valid for all types — none in our case
  return [];
}

function BulkActionMenu({ count, selectionType, onSelect, onCancel }: BulkActionMenuProps) {
  const items = getMenuItems(selectionType);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      const item = items[selectedIdx];
      if (item) onSelect(item.action);
      return;
    }
    if (input === "j" || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
    }
    if (input === "k" || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    }
  });

  if (items.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No bulk actions for mixed selection types.</Text>
        <Text dimColor>Esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        Bulk action ({count} selected):
      </Text>
      {items.map((item, i) => {
        const isSelected = i === selectedIdx;
        const prefix = isSelected ? "> " : "  ";
        return (
          <Text key={item.action.type} {...(isSelected ? { color: "cyan" as const } : {})}>
            {prefix}
            {item.label}
          </Text>
        );
      })}
      <Text dimColor>j/k:navigate Enter:select Esc:cancel</Text>
    </Box>
  );
}

export { BulkActionMenu, getMenuItems };
