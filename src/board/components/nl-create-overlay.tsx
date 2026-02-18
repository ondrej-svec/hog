import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Spinner, TextInput } from "@inkjs/ui";
import { Box, Text, useInput, useStdin } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ParsedIssue } from "../../ai.js";
import { extractIssueFields } from "../../ai.js";
import type { RepoConfig } from "../../config.js";
import type { LabelOption } from "../../github.js";
import { getInkInstance } from "../ink-instance.js";

type Step = "input" | "body";

interface NlCreateOverlayProps {
  readonly repos: RepoConfig[];
  readonly defaultRepoName: string | null;
  readonly labelCache: Record<string, LabelOption[]>;
  readonly onSubmit: (repo: string, title: string, body: string, labels?: string[]) => void;
  readonly onCancel: () => void;
  readonly onPauseRefresh?: (() => void) | undefined;
  readonly onResumeRefresh?: (() => void) | undefined;
  readonly onLlmFallback?: ((msg: string) => void) | undefined;
}

function NlCreateOverlay({
  repos,
  defaultRepoName,
  labelCache,
  onSubmit,
  onCancel,
  onPauseRefresh,
  onResumeRefresh,
  onLlmFallback,
}: NlCreateOverlayProps) {
  const [, setInput] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedIssue | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("input");
  const [body, setBody] = useState("");
  const [editingBody, setEditingBody] = useState(false);

  // Guard against double-submit. Safe because the parent (dashboard) always calls
  // onOverlayDone() → ui.exitOverlay() after onSubmit, unmounting this component
  // on both success and failure paths.
  const submittedRef = useRef(false);
  const parseParamsRef = useRef<{
    input: string;
    validLabels: string[];
  } | null>(null);

  // Stable refs to avoid stale closures
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  const onPauseRef = useRef(onPauseRefresh);
  const onResumeRef = useRef(onResumeRefresh);
  onSubmitRef.current = onSubmit;
  onCancelRef.current = onCancel;
  onPauseRef.current = onPauseRefresh;
  onResumeRef.current = onResumeRefresh;

  const { setRawMode } = useStdin();

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
    if (isParsing || editingBody) return;

    if (key.escape) {
      if (step === "body") {
        // Esc from body step goes back to preview
        setStep("input");
        setParsed((p) => p); // keep parsed
        return;
      }
      onCancel();
      return;
    }

    // Preview mode controls
    if (parsed && step === "input") {
      if (key.return) {
        // Advance to body step
        setStep("body");
        return;
      }
      if (inputChar === "r") {
        setRepoIdx((i) => (i + 1) % repos.length);
        return;
      }
    }

    // Body step: ctrl+e opens $EDITOR
    if (step === "body" && inputChar === "\x05") {
      setEditingBody(true);
    }
  });

  // Launch $EDITOR for body input
  useEffect(() => {
    if (!editingBody) return;

    const editorEnv = process.env["VISUAL"] ?? process.env["EDITOR"] ?? "vi";
    const [cmd, ...extraArgs] = editorEnv.split(" ").filter(Boolean);
    if (!cmd) {
      setEditingBody(false);
      return;
    }

    let tmpDir: string | null = null;
    let tmpFile: string | null = null;

    try {
      onPauseRef.current?.();
      tmpDir = mkdtempSync(join(tmpdir(), "hog-body-"));
      tmpFile = join(tmpDir, "body.md");
      writeFileSync(tmpFile, body);

      const inkInstance = getInkInstance();
      inkInstance?.clear();
      setRawMode(false);

      spawnSync(cmd, [...extraArgs, tmpFile], { stdio: "inherit" });

      const content = readFileSync(tmpFile, "utf-8");
      setRawMode(true);
      setBody(content.trimEnd());
    } finally {
      onResumeRef.current?.();
      if (tmpFile) {
        try {
          rmSync(tmpDir!, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
      setEditingBody(false);
    }
  }, [editingBody, body, setRawMode]);

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

  // ── Body step ──
  if (parsed && step === "body") {
    if (editingBody) {
      return (
        <Box flexDirection="column">
          <Text color="cyan" bold>
            ✨ Creating Issue
          </Text>
          <Text color="cyan">Opening editor for body…</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          ✨ Creating Issue
        </Text>
        <Box>
          <Text dimColor>Title: </Text>
          <Text>{parsed.title}</Text>
        </Box>
        <Box>
          <Text color="cyan">body: </Text>
          <TextInput
            defaultValue={body}
            placeholder="optional description (ctrl+e for editor)"
            onChange={setBody}
            onSubmit={(text) => {
              if (submittedRef.current) return;
              submittedRef.current = true;
              if (!selectedRepo) return;
              const labels = buildLabelList(parsed);
              onSubmitRef.current(
                selectedRepo.name,
                parsed.title,
                text.trim(),
                labels.length > 0 ? labels : undefined,
              );
            }}
          />
        </Box>
        <Text dimColor>Enter:create ctrl+e:editor Esc:back</Text>
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
        <Text dimColor>Enter:add body Esc:cancel</Text>
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
