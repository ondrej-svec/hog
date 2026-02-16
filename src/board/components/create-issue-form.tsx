import { TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { RepoConfig } from "../../config.js";

interface CreateIssueFormProps {
  readonly repos: RepoConfig[];
  readonly defaultRepo: string | null;
  readonly onSubmit: (repo: string, title: string, labels?: string[]) => void;
  readonly onCancel: () => void;
}

function CreateIssueForm({ repos, defaultRepo, onSubmit, onCancel }: CreateIssueFormProps) {
  const defaultRepoIdx = defaultRepo
    ? Math.max(
        0,
        repos.findIndex((r) => r.name === defaultRepo),
      )
    : 0;

  const [repoIdx, setRepoIdx] = useState(defaultRepoIdx);
  const [title, setTitle] = useState("");
  const [field, setField] = useState<"repo" | "title">("title");

  useInput((input, key) => {
    if (key.escape) return onCancel();

    if (field === "repo") {
      if (input === "j" || key.downArrow) {
        setRepoIdx((i) => Math.min(i + 1, repos.length - 1));
      }
      if (input === "k" || key.upArrow) {
        setRepoIdx((i) => Math.max(i - 1, 0));
      }
      if (key.tab) setField("title");
      if (key.return) setField("title");
    }
  });

  const selectedRepo = repos[repoIdx];

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        Create Issue
      </Text>

      {/* Repo selector */}
      <Box>
        <Text dimColor={field !== "repo"}>Repo: </Text>
        {repos.map((r, i) => (
          <Text
            key={r.name}
            {...(i === repoIdx ? { color: "cyan" as const, bold: true } : {})}
            dimColor={field !== "repo"}
          >
            {i === repoIdx ? `[${r.shortName}]` : ` ${r.shortName} `}
          </Text>
        ))}
        {field === "repo" ? <Text dimColor> j/k:select Tab:next</Text> : null}
      </Box>

      {/* Title input */}
      <Box>
        <Text dimColor={field !== "title"}>Title: </Text>
        {field === "title" ? (
          <TextInput
            defaultValue={title}
            placeholder="issue title..."
            onChange={setTitle}
            onSubmit={(text) => {
              if (text.trim() && selectedRepo) {
                onSubmit(selectedRepo.name, text.trim());
              }
            }}
          />
        ) : (
          <Text>{title || "(empty)"}</Text>
        )}
      </Box>

      <Text dimColor>Tab:switch fields Enter:submit Esc:cancel</Text>
    </Box>
  );
}

export { CreateIssueForm };
