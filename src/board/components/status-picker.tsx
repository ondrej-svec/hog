import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { StatusOption } from "../../github.js";

interface StatusPickerProps {
  readonly options: StatusOption[];
  readonly currentStatus: string | undefined;
  readonly onSelect: (optionId: string) => void;
  readonly onCancel: () => void;
}

function StatusPicker({ options, currentStatus, onSelect, onCancel }: StatusPickerProps) {
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const idx = options.findIndex((o) => o.name === currentStatus);
    return idx >= 0 ? idx : 0;
  });

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      const opt = options[selectedIdx];
      if (opt) onSelect(opt.id);
      return;
    }
    if (input === "j" || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, options.length - 1));
    }
    if (input === "k" || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        Move to status:
      </Text>
      {options.map((opt, i) => {
        const isCurrent = opt.name === currentStatus;
        const isSelected = i === selectedIdx;
        const prefix = isSelected ? "> " : "  ";
        const suffix = isCurrent ? " (current)" : "";
        return (
          <Text
            key={opt.id}
            {...(isSelected ? { color: "cyan" as const } : {})}
            dimColor={isCurrent}
          >
            {prefix}
            {opt.name}
            {suffix}
          </Text>
        );
      })}
      <Text dimColor>j/k:navigate Enter:select Esc:cancel</Text>
    </Box>
  );
}

export { StatusPicker };
