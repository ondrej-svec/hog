import { Box, Text } from "ink";

interface RepoItem {
  name: string;
  openCount: number;
}

interface ReposPanelProps {
  readonly repos: RepoItem[];
  readonly selectedIdx: number;
  readonly isActive: boolean;
}

function shortName(fullName: string): string {
  // "owner/repo" → "repo", keeps full name if no slash
  return fullName.includes("/") ? (fullName.split("/")[1] ?? fullName) : fullName;
}

export function ReposPanel({ repos, selectedIdx, isActive }: ReposPanelProps) {
  const borderColor = isActive ? "cyan" : "gray";

  return (
    <Box borderStyle="single" borderColor={borderColor} flexDirection="column" flexGrow={1}>
      <Text bold color={isActive ? "cyan" : "white"}>
        [1] Repos
      </Text>
      {repos.length === 0 ? (
        <Text color="gray"> —</Text>
      ) : (
        repos.map((repo, i) => {
          const isSel = i === selectedIdx;
          const label = shortName(repo.name);
          return (
            <Box key={repo.name}>
              <Text color={isSel ? "cyan" : isActive ? "white" : "gray"} bold={isSel}>
                {isSel ? "\u25B6 " : "  "}
                {label}
              </Text>
              <Text color="gray"> {repo.openCount}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

export type { RepoItem, ReposPanelProps };
