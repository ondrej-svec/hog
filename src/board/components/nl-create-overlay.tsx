import { Spinner, TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ParsedIssue } from "../../ai.js";
import { extractIssueFields } from "../../ai.js";
import type { RepoConfig } from "../../config.js";
import type { LabelOption } from "../../github.js";

interface NlCreateOverlayProps {
  readonly repos: RepoConfig[];
  readonly defaultRepoName: string | null;
  readonly labelCache: Record<string, LabelOption[]>;
  readonly onSubmit: (repo: string, title: string, labels?: string[]) => void;
  readonly onCancel: () => void;
  readonly onLlmFallback?: ((msg: string) => void) | undefined;
}

function NlCreateOverlay({
  repos,
  defaultRepoName,
  labelCache,
  onSubmit,
  onCancel,
  onLlmFallback,
}: NlCreateOverlayProps) {
  const [, setInput] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedIssue | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // Guard against double-submit. Safe because the parent (dashboard) always calls
  // onOverlayDone() → ui.exitOverlay() after onSubmit, unmounting this component
  // on both success and failure paths.
  const submittedRef = useRef(false);
  const parseParamsRef = useRef<{
    input: string;
    validLabels: string[];
  } | null>(null);

  // Repo selection in preview (r key cycles)
  const defaultRepoIdx = defaultRepoName
    ? Math.max(
        0,
        repos.findIndex((r) => r.name === defaultRepoName),
      )
    : 0;
  const [repoIdx, setRepoIdx] = useState(defaultRepoIdx);

  const selectedRepo = repos[repoIdx];

  useInput((inputChar, key) => {
    if (isParsing) return;

    if (key.escape) {
      onCancel();
      return;
    }

    // Preview mode controls
    if (parsed) {
      if (key.return) {
        if (submittedRef.current) return;
        submittedRef.current = true;
        if (!selectedRepo) return;

        setCreateError(null);
        const labels = buildLabelList(parsed);
        onSubmit(selectedRepo.name, parsed.title, labels.length > 0 ? labels : undefined);
        return;
      }

      if (inputChar === "r") {
        setRepoIdx((i) => (i + 1) % repos.length);
        return;
      }
    }
  });

  // Parse on Enter from TextInput — capture context at submit time to avoid double-fire
  const handleInputSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const validLabels = selectedRepo
        ? (labelCache[selectedRepo.name] ?? []).map((l) => l.name)
        : [];
      parseParamsRef.current = { input: trimmed, validLabels };
      setInput(trimmed);
      setParseError(null);
      setIsParsing(true);
    },
    [selectedRepo, labelCache],
  );

  useEffect(() => {
    if (!(isParsing && parseParamsRef.current)) return;
    const { input: capturedInput, validLabels } = parseParamsRef.current;

    extractIssueFields(capturedInput, {
      validLabels,
      onLlmFallback: onLlmFallback,
    })
      .then((result) => {
        if (!result) {
          setParseError("Title is required");
          setIsParsing(false);
          return;
        }
        // Filter labels against allowlist (prevents invalid gh --label calls)
        const filteredLabels =
          validLabels.length > 0
            ? result.labels.filter((l) => validLabels.includes(l))
            : result.labels;
        setParsed({ ...result, labels: filteredLabels });
        setIsParsing(false);
      })
      .catch(() => {
        setParseError("Parsing failed — please try again");
        setIsParsing(false);
      });
  }, [isParsing, onLlmFallback]);

  // ── Spinner view ──
  if (isParsing) {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          ✨ Creating Issue
        </Text>
        <Spinner label="Parsing..." />
      </Box>
    );
  }

  // ── Preview view ──
  if (parsed) {
    const labels = buildLabelList(parsed);
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          ✨ Creating Issue
        </Text>
        <Box>
          <Text dimColor>Repo: </Text>
          <Text color="cyan">{selectedRepo?.shortName ?? "(none)"}</Text>
          {repos.length > 1 ? <Text dimColor> r:cycle</Text> : null}
        </Box>
        <Box>
          <Text dimColor>Title: </Text>
          <Text>{parsed.title}</Text>
        </Box>
        {labels.length > 0 ? (
          <Box>
            <Text dimColor>Labels: </Text>
            <Text>{labels.join(", ")}</Text>
          </Box>
        ) : null}
        {parsed.assignee ? (
          <Box>
            <Text dimColor>Assignee: </Text>
            <Text>@{parsed.assignee}</Text>
          </Box>
        ) : null}
        {parsed.dueDate ? (
          <Box>
            <Text dimColor>Due: </Text>
            <Text>{formatDue(parsed.dueDate)}</Text>
          </Box>
        ) : null}
        {parsed.dueDate && selectedRepo && !hasDueLabelInCache(labelCache, selectedRepo.name) ? (
          <Text color="yellow">
            ⚠ No due:* label in this repo — will try to create label on submit
          </Text>
        ) : null}
        {createError ? <Text color="red">{createError}</Text> : null}
        <Text dimColor>Enter:create Esc:cancel</Text>
      </Box>
    );
  }

  // ── Input view ──
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        ✨ What do you need to do?
      </Text>
      <Box>
        <Text color="cyan">&gt; </Text>
        <TextInput
          placeholder="fix login bug #bug #priority:high @me due friday"
          onChange={setInput}
          onSubmit={handleInputSubmit}
        />
      </Box>
      {parseError ? <Text color="red">{parseError}</Text> : null}
      <Text dimColor>Tip: #label @user due &lt;date&gt; Enter:parse Esc:cancel</Text>
    </Box>
  );
}

/** Build the final label list including a due:{date} label if present. */
function buildLabelList(parsed: ParsedIssue): string[] {
  const labels = [...parsed.labels];
  if (parsed.dueDate) {
    labels.push(`due:${parsed.dueDate}`);
  }
  return labels;
}

/** Check whether any due:* label exists in the cache for the given repo. */
function hasDueLabelInCache(labelCache: Record<string, LabelOption[]>, repoName: string): boolean {
  return (labelCache[repoName] ?? []).some((l) => l.name.startsWith("due:"));
}

/** Format YYYY-MM-DD as "Wed Feb 18 (label: due:2026-02-18)". */
function formatDue(dueDate: string): string {
  const d = new Date(`${dueDate}T12:00:00`);
  const human = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${human} (label: due:${dueDate})`;
}

export { NlCreateOverlay };
