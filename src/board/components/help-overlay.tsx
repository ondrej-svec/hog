import { Box, Text, useInput } from "ink";
import type { UIMode } from "../hooks/use-ui-state.js";

interface HelpOverlayProps {
  readonly currentMode: UIMode;
  readonly onClose: () => void;
}

const SHORTCUTS = [
  {
    category: "Navigation",
    items: [
      { key: "j / Down", desc: "Move down" },
      { key: "k / Up", desc: "Move up" },
      { key: "Tab", desc: "Next repo tab" },
      { key: "Shift+Tab", desc: "Previous repo tab" },
      { key: "1-9", desc: "Jump to repo tab by number" },
      { key: "s / S", desc: "Next / prev status tab" },
    ],
  },
  {
    category: "View",
    items: [
      { key: "Enter", desc: "Open detail panel" },
      { key: "0", desc: "Detail panel (full-screen on narrow terminals)" },
      { key: "Space", desc: "Multi-select item" },
      { key: "/", desc: "Search (inline filter)" },
      { key: "F", desc: "Fuzzy find issue (telescope-style)" },
      { key: "t", desc: "Toggle @me filter (my issues only)" },
      { key: "f", desc: "Focus mode" },
      { key: "?", desc: "Toggle help" },
      { key: "Esc", desc: "Close overlay / Back to normal" },
    ],
  },
  {
    category: "Actions",
    items: [
      { key: "p", desc: "Pick issue (assign + TickTick)" },
      { key: "a", desc: "Assign to self (no-op if already assigned)" },
      { key: "u", desc: "Undo last reversible action" },
      { key: "e", desc: "Edit issue in $EDITOR (title, assignee, status, labels)" },
      { key: "c", desc: "Comment on issue" },
      { key: "m", desc: "Move status" },
      { key: "g", desc: "Open issue in browser" },
      { key: "o", desc: "Open Slack thread" },
      { key: "y", desc: "Copy issue link to clipboard" },
      { key: "n", desc: "Create new issue" },
      { key: "I", desc: "Natural-language issue create" },
      { key: "l", desc: "Manage labels" },
      { key: "C", desc: "Launch Claude Code session for this issue" },
      { key: "W", desc: "Open workflow overlay (phase-aware launch)" },
      { key: "T", desc: "Open triage overlay (batch agent launch)" },
    ],
  },
  {
    category: "Board",
    items: [
      { key: "L", desc: "Toggle action log" },
      { key: "r", desc: "Refresh data" },
      { key: "q", desc: "Quit" },
    ],
  },
];

function HelpOverlay({ currentMode, onClose }: HelpOverlayProps) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>
          Keyboard Shortcuts
        </Text>
        <Text dimColor>mode: {currentMode}</Text>
      </Box>
      <Text> </Text>
      {SHORTCUTS.map((group) => (
        <Box key={group.category} flexDirection="column" marginBottom={1}>
          <Text color="yellow" bold>
            {group.category}
          </Text>
          {group.items.map((item) => (
            <Box key={item.key}>
              <Box width={16}>
                <Text color="green">{item.key}</Text>
              </Box>
              <Text>{item.desc}</Text>
            </Box>
          ))}
        </Box>
      ))}
      <Text dimColor>Press ? or Esc to close</Text>
    </Box>
  );
}

export { HelpOverlay };
