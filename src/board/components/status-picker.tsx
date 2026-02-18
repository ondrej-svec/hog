import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import type { StatusOption } from "../../github.js";

interface StatusPickerProps {
  readonly options: StatusOption[];
  readonly currentStatus: string | undefined;
  readonly onSelect: (optionId: string) => void;
  readonly onCancel: () => void;
  /** When true, terminal statuses appear with a "(Done)" suffix and require inline confirm */
  readonly showTerminalStatuses?: boolean;
}

const TERMINAL_STATUS_RE = /^(done|shipped|won't|wont|closed|complete|completed)$/i;

function isTerminal(name: string): boolean {
  return TERMINAL_STATUS_RE.test(name);
}

function StatusPicker({
  options,
  currentStatus,
  onSelect,
  onCancel,
  showTerminalStatuses = true,
}: StatusPickerProps) {
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const idx = options.findIndex((o) => o.name === currentStatus);
    return idx >= 0 ? idx : 0;
  });
  // Inline confirm for terminal status with closeIssue completion action
  const [confirmingTerminal, setConfirmingTerminal] = useState(false);
  // Guard against Enter key repeat
  const submittedRef = useRef(false);

  useInput((input, key) => {
    if (confirmingTerminal) {
      if (input === "y" || input === "Y") {
        if (submittedRef.current) return;
        submittedRef.current = true;
        const opt = options[selectedIdx];
        if (opt) onSelect(opt.id);
        return;
      }
      if (input === "n" || input === "N" || key.escape) {
        setConfirmingTerminal(false);
        return;
      }
      return;
    }

    if (key.escape) return onCancel();
    if (key.return) {
      if (submittedRef.current) return;
      const opt = options[selectedIdx];
      if (!opt) return;
      if (isTerminal(opt.name) && showTerminalStatuses) {
        // Show inline confirm before executing
        setConfirmingTerminal(true);
        return;
      }
      submittedRef.current = true;
      onSelect(opt.id);
      return;
    }
    if (input === "j" || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, options.length - 1));
    }
    if (input === "k" || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    }
  });

  if (confirmingTerminal) {
    const opt = options[selectedIdx];
    return (
      <Box flexDirection="column">
        <Text color="yellow" bold>
          Mark as {opt?.name}?
        </Text>
        <Text dimColor>This will close the issue on GitHub.</Text>
        <Text>Continue? [y/n]</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        Move to status:
      </Text>
      {options.map((opt, i) => {
        const isCurrent = opt.name === currentStatus;
        const isSelected = i === selectedIdx;
        const terminal = isTerminal(opt.name) && showTerminalStatuses;
        const prefix = isSelected ? "> " : "  ";
        const suffix = isCurrent ? " (current)" : terminal ? " (Done)" : "";
        return (
          <Text
            key={opt.id}
            {...(isSelected
              ? { color: "cyan" as const }
              : terminal
                ? { color: "yellow" as const }
                : {})}
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
