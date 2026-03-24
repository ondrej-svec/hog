import { Box, Text } from "ink";
import type { PanelId } from "../constants.js";
import type { UIMode } from "../hooks/use-ui-state.js";

interface HintBarProps {
  readonly uiMode: UIMode;
  readonly activePanelId: PanelId;
  readonly multiSelectCount: number;
  readonly searchQuery: string;
  readonly mineOnly: boolean;
  readonly hasUndoable?: boolean;
  readonly boardView?: "pipelines" | "issues";
  readonly pipelineBrainstorming?: boolean;
}

function HintBar({
  uiMode,
  activePanelId,
  multiSelectCount,
  searchQuery,
  mineOnly,
  hasUndoable,
  boardView,
  pipelineBrainstorming,
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

  if (uiMode === "zen") {
    return (
      <Box>
        <Text color="green" bold>
          [ZEN]
        </Text>
        <Text color="gray">
          {" "}
          j/k:nav /:search t:mine F:find C:claude y:copy g:open r:refresh Z/Esc:exit q:quit
        </Text>
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

  if (uiMode === "overlay:detail") {
    return (
      <Box>
        <Text color="cyan" bold>
          [DETAIL]
        </Text>
        <Text color="gray"> Esc:close e:edit c:comment g:open y:copy-link C:claude ? help</Text>
      </Box>
    );
  }

  // Start Pipeline overlay has its own hints — don't show generic overlay hints
  if (uiMode === "overlay:startPipeline") {
    return (
      <Box>
        <Text color="gray">Type a feature description · Enter:start · Esc:cancel</Text>
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

  // Pipeline View hints
  if (boardView === "pipelines") {
    const pipelineHint = pipelineBrainstorming
      ? "Z:brainstorm  j/k:navigate  P:new pipeline  Tab:issues  q:quit"
      : "j/k:navigate  P:new pipeline  D:decide  Z:zen  Tab:issues  ? help  q:quit";
    return (
      <Box>
        <Text color="gray">{pipelineHint}</Text>
      </Box>
    );
  }

  // Issues View — normal mode — context-sensitive hints per active panel
  const panelHints: Record<PanelId, string> = {
    0: "j/k:scroll  Esc:close  ? help",
    1: "j/k:move  Enter:filter  0-4:panel  ? help",
    2: "j/k:move  Enter:filter  Esc:clear  0-4:panel  ? help",
    3: `j/k:move  ^d/^u:page  G:bottom  Enter:detail  g:open  p:pick  m:status  c:comment  C:claude  /:search  n:new  H:hide-panel  Z:zen  0-4:panel${hasUndoable ? "  u:undo" : ""}  ? help  q:quit`,
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
