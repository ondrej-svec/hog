import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { NudgeCandidate } from "../hooks/use-nudges.js";

// ── Types ──

export type NudgeAction =
  | { type: "snooze"; repo: string; issueNumber: number; days: number }
  | { type: "dismiss" };

interface NudgeOverlayProps {
  readonly candidates: NudgeCandidate[];
  readonly onAction: (action: NudgeAction) => void;
  readonly onCancel: () => void;
}

// ── Component ──

function NudgeOverlay({ candidates, onAction, onCancel }: NudgeOverlayProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onAction({ type: "dismiss" });
      onCancel();
      return;
    }

    if (input === "j" || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, candidates.length - 1));
      return;
    }
    if (input === "k" || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }

    // Snooze durations
    const candidate = candidates[selectedIdx];
    if (!candidate) return;

    if (input === "1") {
      onAction({
        type: "snooze",
        repo: candidate.repo,
        issueNumber: candidate.issue.number,
        days: 1,
      });
      return;
    }
    if (input === "3") {
      onAction({
        type: "snooze",
        repo: candidate.repo,
        issueNumber: candidate.issue.number,
        days: 3,
      });
      return;
    }
    if (input === "7") {
      onAction({
        type: "snooze",
        repo: candidate.repo,
        issueNumber: candidate.issue.number,
        days: 7,
      });
      return;
    }

    // Dismiss all
    if (key.return) {
      onAction({ type: "dismiss" });
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="yellow" bold>
          Stale Issues ({candidates.length})
        </Text>
        <Text dimColor>Daily nudge</Text>
      </Box>
      <Text> </Text>

      {candidates.map((c, i) => {
        const isSelected = i === selectedIdx;
        const prefix = isSelected ? "> " : "  ";
        const color = c.severity === "critical" ? "red" : "yellow";

        return (
          <Box key={`${c.repo}#${c.issue.number}`}>
            <Text color={isSelected ? "cyan" : "white"}>
              {prefix}
              <Text color={color}>[{c.ageDays}d]</Text> #{c.issue.number} {c.issue.title}
              <Text dimColor> ({c.repo})</Text>
            </Text>
          </Box>
        );
      })}

      <Text> </Text>
      <Box flexDirection="column">
        <Text dimColor>1/3/7: Snooze selected for 1/3/7 days</Text>
        <Text dimColor>Enter: Dismiss all</Text>
        <Text dimColor>Esc: Dismiss</Text>
      </Box>
    </Box>
  );
}

export { NudgeOverlay };
