import { Box, Text } from "ink";
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
}

function shortName(fullName: string): string {
  return fullName.includes("/") ? (fullName.split("/")[1] ?? fullName) : fullName;
}

export function ReposPanel({ repos, selectedIdx, isActive, width, flexGrow }: ReposPanelProps) {
  // inner content width = total - 2 border chars - 2 padding chars from Box
  const maxLabel = Math.max(4, width - 8); // leave room for "► " + " 99" + borders

  return (
    <Panel title="[1] Repos" isActive={isActive} width={width} flexGrow={flexGrow}>
      {repos.length === 0 ? (
        <Text color="gray">—</Text>
      ) : (
        repos.map((repo, i) => {
          const isSel = i === selectedIdx;
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
        })
      )}
    </Panel>
  );
}
