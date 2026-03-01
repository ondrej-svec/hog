import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { GitHubIssue } from "../../github.js";
import type { PhaseStatus } from "../hooks/use-workflow-state.js";

// ── Types ──

export type WorkflowAction =
  | { type: "launch"; phase: string; mode: "interactive" }
  | { type: "launch"; phase: string; mode: "background" }
  | { type: "resume"; sessionId: string };

interface WorkflowOverlayProps {
  readonly issue: GitHubIssue;
  readonly repoName: string;
  readonly phases: PhaseStatus[];
  readonly latestSessionId?: string | undefined;
  readonly onAction: (action: WorkflowAction) => void;
  readonly onCancel: () => void;
}

// ── Helpers ──

function phaseIcon(state: PhaseStatus["state"]): string {
  switch (state) {
    case "completed":
      return "\u2705";
    case "active":
      return "\uD83D\uDD04";
    case "pending":
      return "\u25CB";
  }
}

function phaseColor(state: PhaseStatus["state"]): string {
  switch (state) {
    case "completed":
      return "green";
    case "active":
      return "yellow";
    case "pending":
      return "white";
  }
}

// ── Component ──

function WorkflowOverlay({
  issue,
  repoName,
  phases,
  latestSessionId,
  onAction,
  onCancel,
}: WorkflowOverlayProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (input === "j" || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, phases.length - 1));
      return;
    }
    if (input === "k" || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }

    if (key.return || input === "i") {
      const phase = phases[selectedIdx];
      if (phase) {
        onAction({ type: "launch", phase: phase.name, mode: "interactive" });
      }
      return;
    }

    if (input === "b") {
      const phase = phases[selectedIdx];
      if (phase) {
        onAction({ type: "launch", phase: phase.name, mode: "background" });
      }
      return;
    }

    if (input === "r" && latestSessionId) {
      onAction({ type: "resume", sessionId: latestSessionId });
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="magenta" bold>
          Workflow: #{issue.number} {issue.title}
        </Text>
        <Text dimColor>{repoName}</Text>
      </Box>
      <Text> </Text>

      {phases.map((phase, i) => {
        const isSelected = i === selectedIdx;
        const prefix = isSelected ? "> " : "  ";
        const icon = phaseIcon(phase.state);
        const color = phaseColor(phase.state);

        return (
          <Text key={phase.name} color={isSelected ? "cyan" : color}>
            {prefix}
            {icon} {phase.name}
            {phase.state === "active" ? " (running)" : ""}
          </Text>
        );
      })}

      <Text> </Text>
      <Box flexDirection="column">
        <Text dimColor>Enter/i: Launch interactively</Text>
        <Text dimColor>b: Launch as background agent</Text>
        {latestSessionId ? <Text dimColor>r: Resume last session</Text> : null}
        <Text dimColor>Esc: Back</Text>
      </Box>
    </Box>
  );
}

export { WorkflowOverlay };
