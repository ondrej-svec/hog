import { TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { RepoConfig } from "../../config.js";
import type { LabelOption } from "../../github.js";
import { LabelPicker } from "./label-picker.js";

interface CreateIssueFormProps {
  readonly repos: RepoConfig[];
  readonly defaultRepo: string | null;
  readonly onSubmit: (repo: string, title: string, labels?: string[]) => void;
  readonly onCancel: () => void;
  /** Session-level label cache — passed from dashboard so it persists across form open/close */
  readonly labelCache?: Record<string, LabelOption[]>;
}

function CreateIssueForm({ repos, defaultRepo, onSubmit, onCancel, labelCache }: CreateIssueFormProps) {
  const defaultRepoIdx = defaultRepo
    ? Math.max(
        0,
        repos.findIndex((r) => r.name === defaultRepo),
      )
    : 0;

  const [repoIdx, setRepoIdx] = useState(defaultRepoIdx);
  const [title, setTitle] = useState("");
  const [field, setField] = useState<"repo" | "title" | "labels">("title");

  useInput((input, key) => {
    // LabelPicker handles its own input in the labels step
    if (field === "labels") return;

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

  // Labels step — LabelPicker takes over input completely
  if (field === "labels" && selectedRepo) {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          Create Issue — Add Labels (optional)
        </Text>
        <Text dimColor>
          Repo: {selectedRepo.shortName}  Title: {title}
        </Text>
        <LabelPicker
          repo={selectedRepo.name}
          currentLabels={[]}
          labelCache={labelCache ?? {}}
          onConfirm={(addLabels) => {
            onSubmit(selectedRepo.name, title, addLabels.length > 0 ? addLabels : undefined);
          }}
          onCancel={() => {
            // Esc skips labels and submits without them
            onSubmit(selectedRepo.name, title);
          }}
          onError={() => {
            // On fetch error, skip labels and submit
            onSubmit(selectedRepo.name, title);
          }}
        />
      </Box>
    );
  }

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
              const trimmed = text.trim();
              if (!trimmed || !selectedRepo) return;
              if (labelCache !== undefined) {
                // Advance to labels step
                setTitle(trimmed);
                setField("labels");
              } else {
                onSubmit(selectedRepo.name, trimmed);
              }
            }}
          />
        ) : (
          <Text>{title || "(empty)"}</Text>
        )}
      </Box>

      <Text dimColor>Tab:switch fields Enter:next Esc:cancel</Text>
    </Box>
  );
}

export { CreateIssueForm };
