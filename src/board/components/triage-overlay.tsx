import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { NudgeCandidate } from "../hooks/use-nudges.js";

// ── Types ──

export type TriageAction =
  | {
      type: "launch";
      candidates: NudgeCandidate[];
      phase: string;
      mode: "interactive" | "background";
    }
  | { type: "snooze"; repo: string; issueNumber: number; days: number };

interface TriageOverlayProps {
  readonly candidates: NudgeCandidate[];
  readonly phases: readonly string[];
  readonly onAction: (action: TriageAction) => void;
  readonly onCancel: () => void;
}

// ── Component ──

function TriageOverlay({ candidates, phases, onAction, onCancel }: TriageOverlayProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [cursorIdx, setCursorIdx] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (input === "j" || key.downArrow) {
      setCursorIdx((i) => Math.min(i + 1, candidates.length - 1));
      return;
    }
    if (input === "k" || key.upArrow) {
      setCursorIdx((i) => Math.max(i - 1, 0));
      return;
    }

    // Toggle selection
    if (input === " ") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursorIdx)) {
          next.delete(cursorIdx);
        } else {
          next.add(cursorIdx);
        }
        return next;
      });
      return;
    }

    // Cycle phase
    if (key.tab) {
      setPhaseIdx((i) => (i + 1) % phases.length);
      return;
    }

    // Launch as background
    if (input === "b" || key.return) {
      const selectedCandidates = getSelectedCandidates(candidates, selected, cursorIdx);
      if (selectedCandidates.length > 0) {
        const phase = phases[phaseIdx] ?? phases[0] ?? "brainstorm";
        onAction({
          type: "launch",
          candidates: selectedCandidates,
          phase,
          mode: "background",
        });
      }
      return;
    }

    // Launch interactively (first selected only)
    if (input === "i") {
      const selectedCandidates = getSelectedCandidates(candidates, selected, cursorIdx);
      if (selectedCandidates.length > 0) {
        const phase = phases[phaseIdx] ?? phases[0] ?? "brainstorm";
        onAction({
          type: "launch",
          candidates: [selectedCandidates[0]!],
          phase,
          mode: "interactive",
        });
      }
      return;
    }

    // Snooze selected issue
    if (input === "s") {
      const candidate = candidates[cursorIdx];
      if (candidate) {
        onAction({
          type: "snooze",
          repo: candidate.repo,
          issueNumber: candidate.issue.number,
          days: 7,
        });
      }
    }
  });

  const currentPhase = phases[phaseIdx] ?? phases[0] ?? "brainstorm";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="blue" bold>
          Triage ({candidates.length} stale issues)
        </Text>
        <Text color="cyan">Phase: {currentPhase}</Text>
      </Box>
      <Text> </Text>

      {candidates.map((c, i) => {
        const isCursor = i === cursorIdx;
        const isSelected = selected.has(i);
        const prefix = isCursor ? "> " : "  ";
        const checkbox = isSelected ? "[x]" : "[ ]";
        const color = c.severity === "critical" ? "red" : "yellow";

        return (
          <Box key={`${c.repo}#${c.issue.number}`}>
            <Text color={isCursor ? "cyan" : "white"}>
              {prefix}
              {checkbox} <Text color={color}>[{c.ageDays}d]</Text> #{c.issue.number} {c.issue.title}
              <Text dimColor> ({c.repo})</Text>
            </Text>
          </Box>
        );
      })}

      <Text> </Text>
      <Box flexDirection="column">
        <Text dimColor>Space: Toggle selection</Text>
        <Text dimColor>Tab: Cycle phase ({phases.join("/")})</Text>
        <Text dimColor>b/Enter: Launch selected as background agents</Text>
        <Text dimColor>i: Launch first selected interactively</Text>
        <Text dimColor>s: Snooze selected for 7 days</Text>
        <Text dimColor>Esc: Cancel</Text>
      </Box>
    </Box>
  );
}

function getSelectedCandidates(
  candidates: NudgeCandidate[],
  selected: Set<number>,
  cursorIdx: number,
): NudgeCandidate[] {
  if (selected.size > 0) {
    return candidates.filter((_, i) => selected.has(i));
  }
  // If nothing explicitly selected, use the cursor item
  const candidate = candidates[cursorIdx];
  return candidate ? [candidate] : [];
}

export { TriageOverlay };
