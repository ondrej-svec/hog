import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, Text, useStdin } from "ink";
import { useEffect, useRef, useState } from "react";
import type { RepoConfig } from "../../config.js";
import type { GitHubIssue, LabelOption, StatusOption } from "../../github.js";
import {
  assignIssueToAsync,
  editIssueBodyAsync,
  editIssueTitleAsync,
  fetchRepoLabelsAsync,
  unassignIssueAsync,
  updateLabelsAsync,
  updateProjectItemStatusAsync,
} from "../../github.js";
import { resolveEditor } from "../editor.js";
import type { ActionLogEntry } from "../hooks/use-action-log.js";
import { nextEntryId } from "../hooks/use-action-log.js";
import { getInkInstance } from "../ink-instance.js";

interface EditIssueOverlayProps {
  readonly issue: GitHubIssue;
  readonly repoName: string;
  readonly repoConfig: RepoConfig | null;
  readonly statusOptions: StatusOption[];
  readonly labelCache: Record<string, LabelOption[]>;
  readonly onDone: () => void;
  readonly onPauseRefresh?: () => void;
  readonly onResumeRefresh?: () => void;
  readonly onToastInfo: (msg: string) => void;
  readonly onToastError: (msg: string) => void;
  readonly onPushEntry?: (entry: ActionLogEntry) => void;
}

interface ParsedFrontMatter {
  title: string;
  status: string;
  labels: string[];
  assignee: string;
  body: string;
}

function buildEditorFile(
  issue: GitHubIssue,
  repoName: string,
  statusOptions: StatusOption[],
  repoLabels: LabelOption[],
): string {
  const statusNames = statusOptions.map((o) => o.name).join(", ");
  const labelNames = repoLabels.map((l) => l.name).join(", ");
  const currentLabels = issue.labels.map((l) => l.name);
  const currentAssignee = (issue.assignees ?? [])[0]?.login ?? "";

  const labelsYaml =
    currentLabels.length > 0 ? currentLabels.map((l) => `  - ${l}`).join("\n") : "  # - label-name";

  return `# --- HOG ISSUE EDIT ---
# Editing: ${repoName}#${issue.number}
# Available status: ${statusNames || "none"}
# Available labels: ${labelNames || "none"}
# ──────────────────────────────────────────────────────────────
title: ${issue.title}
status: ${issue.projectStatus ?? ""}
labels:
${labelsYaml}
assignee: ${currentAssignee}
---

${issue.body ?? ""}`;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: YAML front matter parser
function parseFrontMatter(content: string): ParsedFrontMatter {
  // Strip comment lines (# ...) before parsing
  const lines = content.split("\n");
  // Find the separator --- after the front matter block (skip leading comment lines)
  let frontMatterStart = -1;
  let frontMatterEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("#")) continue; // skip comment lines
    if (frontMatterStart === -1 && (line.trim() === "---" || line.startsWith("title:"))) {
      frontMatterStart = i;
      // If this line is "---", the FM starts on next line
      if (line.trim() === "---") frontMatterStart = i + 1;
    } else if (frontMatterStart !== -1 && line.trim() === "---") {
      frontMatterEnd = i;
      break;
    }
  }

  // Collect front matter lines (non-comment, non-empty lines before the body separator)
  const fmLines: string[] = [];
  if (frontMatterStart >= 0 && frontMatterEnd > frontMatterStart) {
    for (let i = frontMatterStart; i < frontMatterEnd; i++) {
      const line = lines[i] ?? "";
      if (!line.trimStart().startsWith("#")) fmLines.push(line);
    }
  }

  // Simple key-value parser
  let title = "";
  let status = "";
  const labels: string[] = [];
  let assignee = "";
  let inLabels = false;

  for (const line of fmLines) {
    if (line.startsWith("title:")) {
      title = line.slice("title:".length).trim();
      inLabels = false;
    } else if (line.startsWith("status:")) {
      status = line.slice("status:".length).trim();
      inLabels = false;
    } else if (line.startsWith("assignee:")) {
      assignee = line.slice("assignee:".length).trim();
      inLabels = false;
    } else if (line.startsWith("labels:")) {
      inLabels = true;
    } else if (inLabels && line.trimStart().startsWith("- ")) {
      const label = line.trimStart().slice(2).trim();
      if (label && !label.startsWith("#")) labels.push(label);
    } else if (line.match(/^\w/)) {
      inLabels = false;
    }
  }

  // Body is everything after the closing ---
  const body =
    frontMatterEnd >= 0
      ? lines
          .slice(frontMatterEnd + 1)
          .join("\n")
          .trim()
      : "";

  return { title, status, labels, assignee, body };
}

function EditIssueOverlay({
  issue,
  repoName,
  repoConfig,
  statusOptions,
  labelCache,
  onDone,
  onPauseRefresh,
  onResumeRefresh,
  onToastInfo,
  onToastError,
  onPushEntry,
}: EditIssueOverlayProps) {
  const [editing, setEditing] = useState(true);
  const { setRawMode } = useStdin();

  // Stable refs to avoid stale closures
  const onDoneRef = useRef(onDone);
  const onPauseRef = useRef(onPauseRefresh);
  const onResumeRef = useRef(onResumeRefresh);
  onDoneRef.current = onDone;
  onPauseRef.current = onPauseRefresh;
  onResumeRef.current = onResumeRefresh;

  useEffect(() => {
    if (!editing) return;

    const editor = resolveEditor();
    if (!editor) {
      onDoneRef.current();
      return;
    }

    let tmpDir: string | null = null;
    let tmpFile: string | null = null;

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: editor session loop with per-field apply
    const runEditor = async () => {
      // Fetch labels from cache or remotely
      let repoLabels: LabelOption[] = labelCache[repoName] ?? [];
      if (repoLabels.length === 0) {
        try {
          repoLabels = await fetchRepoLabelsAsync(repoName);
        } catch {
          // best-effort; continue without labels
        }
      }

      tmpDir = mkdtempSync(join(tmpdir(), "hog-edit-"));
      tmpFile = join(tmpDir, `issue-${issue.number}.md`);

      let currentContent = buildEditorFile(issue, repoName, statusOptions, repoLabels);
      writeFileSync(tmpFile, currentContent);

      onPauseRef.current?.();

      const inkInstance = getInkInstance();
      inkInstance?.clear();
      setRawMode(false);

      // Reopen loop — repeat on validation errors
      while (true) {
        writeFileSync(tmpFile, currentContent);
        const result = spawnSync(editor.cmd, [...editor.args, tmpFile], { stdio: "inherit" });

        // Non-zero exit or signal = editor crashed/cancelled
        if (result.status !== 0 || result.signal !== null || result.error) {
          break;
        }

        currentContent = readFileSync(tmpFile, "utf-8");
        const parsed = parseFrontMatter(currentContent);

        // Zero-changes detection
        const origLabels = issue.labels.map((l) => l.name).sort();
        const newLabels = [...parsed.labels].sort();
        const origAssignee = (issue.assignees ?? [])[0]?.login ?? "";
        const unchanged =
          parsed.title === issue.title &&
          parsed.status === (issue.projectStatus ?? "") &&
          JSON.stringify(origLabels) === JSON.stringify(newLabels) &&
          parsed.assignee === origAssignee &&
          parsed.body === (issue.body ?? "").trim();

        if (unchanged) {
          onToastInfo("No changes made");
          break;
        }

        // Validation
        const errors: string[] = [];
        if (!parsed.title.trim()) errors.push("title cannot be empty");
        if (
          parsed.status &&
          statusOptions.length > 0 &&
          !statusOptions.some((o) => o.name === parsed.status)
        ) {
          const valid = statusOptions.map((o) => o.name).join(", ");
          errors.push(`status "${parsed.status}" not found → valid: ${valid}`);
        }

        if (errors.length > 0) {
          // Inject error comments at top of preserved user content
          const errorBlock = `${errors.map((e) => `# ERROR: ${e}`).join("\n")}\n`;
          currentContent = errorBlock + currentContent;
          continue; // reopen editor
        }

        // Apply changes sequentially with individual try/catch
        setRawMode(true);
        const changedFields: string[] = [];

        if (parsed.title !== issue.title) {
          try {
            await editIssueTitleAsync(repoName, issue.number, parsed.title);
            changedFields.push("title");
          } catch {
            onToastError(`Failed to update title on #${issue.number}`);
          }
        }

        if (parsed.body !== (issue.body ?? "").trim()) {
          try {
            await editIssueBodyAsync(repoName, issue.number, parsed.body);
            changedFields.push("body");
          } catch {
            onToastError(`Failed to update body on #${issue.number}`);
          }
        }

        if (parsed.status && parsed.status !== (issue.projectStatus ?? "") && repoConfig) {
          const targetOption = statusOptions.find((o) => o.name === parsed.status);
          if (targetOption) {
            try {
              await updateProjectItemStatusAsync(repoName, issue.number, {
                projectNumber: repoConfig.projectNumber,
                statusFieldId: repoConfig.statusFieldId,
                optionId: targetOption.id,
              });
              changedFields.push("status");
            } catch {
              onToastError(`Failed to update status on #${issue.number}`);
            }
          }
        }

        // Labels: compute adds/removes
        const addLabels = parsed.labels.filter((l) => !origLabels.includes(l));
        const removeLabels = origLabels.filter((l) => !parsed.labels.includes(l));
        if (addLabels.length > 0 || removeLabels.length > 0) {
          try {
            await updateLabelsAsync(repoName, issue.number, addLabels, removeLabels);
            changedFields.push("labels");
          } catch {
            onToastError(`Failed to update labels on #${issue.number}`);
          }
        }

        if (parsed.assignee !== origAssignee) {
          try {
            if (parsed.assignee) {
              await assignIssueToAsync(repoName, issue.number, parsed.assignee);
            }
            if (origAssignee) {
              await unassignIssueAsync(repoName, issue.number, origAssignee);
            }
            changedFields.push("assignee");
          } catch {
            onToastError(`Failed to update assignee on #${issue.number}`);
          }
        }

        if (changedFields.length > 0) {
          onToastInfo(`#${issue.number}: ${changedFields.join(", ")} updated`);
          onPushEntry?.({
            id: nextEntryId(),
            description: `#${issue.number} edited (${changedFields.join(", ")})`,
            status: "success",
            ago: Date.now(),
          });
        }
        break;
      }
    };

    runEditor()
      .catch(() => {
        // ignore errors — best effort
      })
      .finally(() => {
        // Always restore raw mode
        try {
          setRawMode(true);
        } catch {
          // ignore
        }
        onResumeRef.current?.();
        if (tmpDir) {
          try {
            rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            // ignore cleanup errors
          }
        }
        setEditing(false);
        onDoneRef.current();
      });
  }, [
    editing,
    issue,
    repoName,
    repoConfig,
    statusOptions,
    labelCache,
    setRawMode,
    onToastInfo,
    onToastError,
    onPushEntry,
  ]);

  if (!editing) return null;

  return (
    <Box>
      <Text color="cyan">Opening editor for #{issue.number}…</Text>
    </Box>
  );
}

export { EditIssueOverlay, buildEditorFile, parseFrontMatter };
export type { EditIssueOverlayProps };
