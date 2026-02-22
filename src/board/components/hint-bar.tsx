import { Box, Text } from "ink";
import type { PanelId } from "../hooks/use-panel-focus.js";
import type { UIMode } from "../hooks/use-ui-state.js";

interface HintBarProps {
  readonly uiMode: UIMode;
  readonly activePanelId: PanelId;
  readonly multiSelectCount: number;
  readonly searchQuery: string;
  readonly mineOnly: boolean;
  readonly hasUndoable?: boolean;
}

function HintBar({
  uiMode,
  activePanelId,
  multiSelectCount,
  searchQuery,
  mineOnly,
  hasUndoable,
}: HintBarProps) {
  if (uiMode === "multiSelect") {
    return (
      <Box>
        <Text color="cyan" bold>
          [MULTI-SELECT] {multiSelectCount} selected
        </Text>
        <Text color="gray"> Space:toggle Enter:actions Esc:cancel</Text>
      </Box>
    );
  }

  if (uiMode === "focus") {
    return (
      <Box>
        <Text color="magenta" bold>
          [FOCUS] Focus mode — Esc to exit
        </Text>
      </Box>
    );
  }

  if (uiMode === "search") {
    return (
      <Box>
        <Text color="yellow" bold>
          [SEARCH]
        </Text>
        <Text color="gray"> type to filter Enter:confirm Esc:clear</Text>
        {searchQuery ? <Text color="yellow"> "{searchQuery}"</Text> : null}
      </Box>
    );
  }

  if (uiMode === "overlay:fuzzyPicker") {
    return (
      <Box>
        <Text color="gray">↑↓/Ctrl-J/K:nav Enter:jump Esc:close</Text>
      </Box>
    );
  }

  if (uiMode.startsWith("overlay:")) {
    return (
      <Box>
        <Text color="gray">j/k:nav Enter:select Esc:cancel</Text>
      </Box>
    );
  }

  // Normal mode — context-sensitive hints per active panel
  const panelHints: Record<PanelId, string> = {
    0: "j/k:scroll  Esc:close  ? help",
    1: "j/k:move  Enter:filter  0-4:panel  ? help",
    2: "j/k:move  Enter:filter  Esc:clear  0-4:panel  ? help",
    3: `j/k:move  p:pick  m:status  c:comment  /:search  n:new  0-4:panel${hasUndoable ? "  u:undo" : ""}  ? help  q:quit`,
    4: "j/k:scroll  Enter:jump  r:refresh  0-4:panel  ? help",
  };

  return (
    <Box>
      <Text color="gray">{panelHints[activePanelId]}</Text>
      {mineOnly ? <Text color="cyan"> filter:@me</Text> : null}
      {searchQuery ? <Text color="yellow"> filter:"{searchQuery}"</Text> : null}
    </Box>
  );
}

export { HintBar };
export type { HintBarProps };
