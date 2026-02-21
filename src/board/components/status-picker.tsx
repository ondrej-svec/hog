import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import type { StatusOption } from "../../github.js";
import { TERMINAL_STATUS_RE } from "../constants.js";

interface StatusPickerProps {
  readonly options: StatusOption[];
  readonly currentStatus: string | undefined;
  readonly onSelect: (optionId: string) => void;
  readonly onCancel: () => void;
  /** When true, terminal statuses appear with a "(Done)" suffix and require inline confirm */
  readonly showTerminalStatuses?: boolean;
}

function isTerminal(name: string): boolean {
  return TERMINAL_STATUS_RE.test(name);
}

// ── Input handler extracted to reduce component complexity ──

interface InputState {
  options: StatusOption[];
  selectedIdx: number;
  showTerminalStatuses: boolean;
  submittedRef: { current: boolean };
  onSelect: (id: string) => void;
  onCancel: () => void;
  onConfirmTerminal: () => void;
  onNavigate: (fn: (i: number) => number) => void;
}

function handlePickerInput(
  input: string,
  key: { escape: boolean; return: boolean; downArrow: boolean; upArrow: boolean },
  state: InputState,
): void {
  if (key.escape) {
    state.onCancel();
    return;
  }
  if (key.return) {
    if (state.submittedRef.current) return;
    const opt = state.options[state.selectedIdx];
    if (!opt) return;
    if (isTerminal(opt.name) && state.showTerminalStatuses) {
      state.onConfirmTerminal();
      return;
    }
    state.submittedRef.current = true;
    state.onSelect(opt.id);
    return;
  }
  if (input === "j" || key.downArrow) {
    state.onNavigate((i) => Math.min(i + 1, state.options.length - 1));
  }
  if (input === "k" || key.upArrow) {
    state.onNavigate((i) => Math.max(i - 1, 0));
  }
}

interface ConfirmState {
  opt: StatusOption | undefined;
  submittedRef: { current: boolean };
  onSelect: (id: string) => void;
  onExitConfirm: () => void;
}

function handleConfirmInput(input: string, key: { escape: boolean }, state: ConfirmState): void {
  if (input === "y" || input === "Y") {
    if (!state.submittedRef.current) {
      state.submittedRef.current = true;
      if (state.opt) state.onSelect(state.opt.id);
    }
    return;
  }
  if (input === "n" || input === "N" || key.escape) {
    state.onExitConfirm();
  }
}

// ── Component ──

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
  const [confirmingTerminal, setConfirmingTerminal] = useState(false);
  const submittedRef = useRef(false);

  useInput((input, key) => {
    if (confirmingTerminal) {
      handleConfirmInput(input, key, {
        opt: options[selectedIdx],
        submittedRef,
        onSelect,
        onExitConfirm: () => setConfirmingTerminal(false),
      });
      return;
    }
    handlePickerInput(input, key, {
      options,
      selectedIdx,
      showTerminalStatuses,
      submittedRef,
      onSelect,
      onCancel,
      onConfirmTerminal: () => setConfirmingTerminal(true),
      onNavigate: setSelectedIdx,
    });
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
