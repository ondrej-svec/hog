import { Spinner } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { LabelOption } from "../../github.js";
import { fetchRepoLabelsAsync } from "../../github.js";

interface LabelPickerProps {
  readonly repo: string;
  readonly currentLabels: string[];
  /** Session-level cache — passed by ref so it persists across overlay open/close */
  readonly labelCache: Record<string, LabelOption[]>;
  readonly onConfirm: (addLabels: string[], removeLabels: string[]) => void;
  readonly onCancel: () => void;
  readonly onError: (msg: string) => void;
}

function LabelPicker({
  repo,
  currentLabels,
  labelCache,
  onConfirm,
  onCancel,
  onError,
}: LabelPickerProps) {
  const [labels, setLabels] = useState<LabelOption[] | null>(labelCache[repo] ?? null);
  const [loading, setLoading] = useState(labels === null);
  const [fetchAttempted, setFetchAttempted] = useState(false);
  // Selected label names (start with current labels pre-selected)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(currentLabels));
  const [cursor, setCursor] = useState(0);
  const submittedRef = useRef(false);

  // Fetch labels lazily on mount if not cached.
  // `fetchAttempted` guards against re-firing on error (labels stays null on error,
  // so removing `labels` from deps and using this flag breaks the infinite loop).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `labels` intentionally omitted — fetchAttempted flag prevents the infinite re-fetch loop that occurs when labels stays null after an error
  useEffect(() => {
    if (labels !== null || fetchAttempted) return;
    setFetchAttempted(true);
    setLoading(true);
    let canceled = false;
    fetchRepoLabelsAsync(repo)
      .then((fetched) => {
        if (canceled) return;
        labelCache[repo] = fetched;
        setLabels(fetched);
        setLoading(false);
      })
      .catch(() => {
        if (canceled) return;
        setLoading(false);
        onError(`Could not fetch labels for ${repo}`);
      });
    return () => {
      canceled = true;
    };
  }, [repo, fetchAttempted, labelCache, onError]);

  useInput((input, key) => {
    if (loading) return;

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (submittedRef.current) return;
      submittedRef.current = true;

      const allLabels = labels ?? [];
      const add = [...selected].filter((l) => !currentLabels.includes(l));
      const remove = currentLabels.filter((l) => {
        // Only remove non-orphaned labels (labels that exist in the repo list)
        const exists = allLabels.some((rl) => rl.name === l);
        return exists && !selected.has(l);
      });

      onConfirm(add, remove);
      return;
    }

    if (input === " ") {
      const allLabels = labels ?? [];
      const item = allLabels[cursor];
      if (!item) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.name)) {
          next.delete(item.name);
        } else {
          next.add(item.name);
        }
        return next;
      });
      return;
    }

    if (input === "j" || key.downArrow) {
      setCursor((i) => Math.min(i + 1, (labels?.length ?? 1) - 1));
    }
    if (input === "k" || key.upArrow) {
      setCursor((i) => Math.max(i - 1, 0));
    }
  });

  if (loading) {
    return (
      <Box>
        <Spinner label="Fetching labels..." />
      </Box>
    );
  }

  const allLabels = labels ?? [];

  if (allLabels.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          Labels:
        </Text>
        <Text dimColor>No labels in this repo</Text>
        <Text dimColor>Esc:cancel</Text>
      </Box>
    );
  }

  // Orphaned: labels on the issue that don't exist in the repo label list
  const repoLabelNames = new Set(allLabels.map((l) => l.name));
  const orphanedLabels = currentLabels.filter((l) => !repoLabelNames.has(l));

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        Labels (Space:toggle Enter:confirm Esc:cancel):
      </Text>
      {orphanedLabels.map((name) => (
        <Text key={`orphan:${name}`} dimColor>
          {selected.has(name) ? "[x]" : "[ ]"} {name} (orphaned)
        </Text>
      ))}
      {allLabels.map((label, i) => {
        const isSel = i === cursor;
        const isChecked = selected.has(label.name);
        return (
          <Text key={label.name} {...(isSel ? { color: "cyan" as const } : {})}>
            {isSel ? ">" : " "} {isChecked ? "[x]" : "[ ]"} {label.name}
          </Text>
        );
      })}
    </Box>
  );
}

export { LabelPicker };
