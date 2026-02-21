import { Box, Text } from "ink";
import type { UIMode } from "../hooks/use-ui-state.js";

interface HintBarProps {
  readonly uiMode: UIMode;
  readonly multiSelectCount: number;
  readonly searchQuery: string;
  readonly mineOnly: boolean;
  readonly hasUndoable?: boolean;
}

function HintBar({ uiMode, multiSelectCount, searchQuery, mineOnly, hasUndoable }: HintBarProps) {
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

  // Normal mode — show the most relevant shortcuts
  return (
    <Box>
      <Text color="gray">
        j/k:nav Tab:next-tab 1-9:jump Enter:open m:status c:comment F:find t:@me e:edit
        {hasUndoable ? "  u:undo" : ""} ?:more q:quit
      </Text>
      {mineOnly ? <Text color="cyan"> filter:@me</Text> : null}
      {searchQuery ? <Text color="yellow"> filter:"{searchQuery}"</Text> : null}
    </Box>
  );
}

export { HintBar };
export type { HintBarProps };
