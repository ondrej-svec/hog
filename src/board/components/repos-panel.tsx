import { Box, Text } from "ink";
import { computeViewportScroll } from "../hooks/use-viewport-scroll.js";
import { Panel } from "./panel.js";

export interface RepoItem {
  name: string;
  openCount: number;
}

export interface ReposPanelProps {
  readonly repos: RepoItem[];
  readonly selectedIdx: number;
  readonly isActive: boolean;
  readonly width: number;
  readonly flexGrow?: number;
  /** Available height for this panel (including chrome). When set, enables scrolling. */
  readonly height?: number | undefined;
}

function shortName(fullName: string): string {
  return fullName.includes("/") ? (fullName.split("/")[1] ?? fullName) : fullName;
}

export function ReposPanel({
  repos,
  selectedIdx,
  isActive,
  width,
  flexGrow,
  height,
}: ReposPanelProps) {
  // inner content width = total - 2 border chars - 2 padding chars from Box
  const maxLabel = Math.max(4, width - 8); // leave room for "► " + " 99" + borders

  // Panel chrome = 2 rows (title + bottom border)
  const contentRows = height != null ? Math.max(1, height - 2) : repos.length;
  const needsScroll = repos.length > contentRows;

  let visibleRepos = repos;
  let hasMoreAbove = false;
  let hasMoreBelow = false;
  let aboveCount = 0;
  let belowCount = 0;

  if (needsScroll) {
    const scroll = computeViewportScroll(
      repos.length,
      contentRows,
      selectedIdx,
      Math.max(0, selectedIdx - Math.floor(contentRows / 2)),
    );
    visibleRepos = repos.slice(scroll.scrollOffset, scroll.scrollOffset + scroll.visibleCount);
    hasMoreAbove = scroll.hasMoreAbove;
    hasMoreBelow = scroll.hasMoreBelow;
    aboveCount = scroll.aboveCount;
    belowCount = scroll.belowCount;
  }

  return (
    <Panel title="[1] Repos" isActive={isActive} width={width} flexGrow={flexGrow} height={height}>
      {repos.length === 0 ? (
        <Text color="gray">—</Text>
      ) : (
        <>
          {hasMoreAbove ? (
            <Text color="gray" dimColor>
              {" "}
              ▲ {aboveCount} more
            </Text>
          ) : null}
          {visibleRepos.map((repo) => {
            const actualIdx = repos.indexOf(repo);
            const isSel = actualIdx === selectedIdx;
            const label = shortName(repo.name).slice(0, maxLabel);
            return (
              <Box key={repo.name}>
                <Text color={isSel ? "cyan" : isActive ? "white" : "gray"} bold={isSel}>
                  {isSel ? "► " : "  "}
                  {label}
                </Text>
                <Text color="gray"> {repo.openCount}</Text>
              </Box>
            );
          })}
          {hasMoreBelow ? (
            <Text color="gray" dimColor>
              {" "}
              ▼ {belowCount} more
            </Text>
          ) : null}
        </>
      )}
    </Panel>
  );
}
