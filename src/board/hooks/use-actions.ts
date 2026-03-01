import { useCallback, useRef } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import type {
  GitHubIssue,
  RepoDueDateConfig,
  RepoProjectConfig,
  StatusOption,
} from "../../github.js";
import {
  addCommentAsync,
  addLabelAsync,
  assignIssueAsync,
  closeIssueAsync,
  createIssueAsync,
  unassignIssueAsync,
  updateLabelsAsync,
  updateProjectItemDateAsync,
  updateProjectItemStatusAsync,
} from "../../github.js";
import { pickIssue } from "../../pick.js";
import { formatError } from "../../utils.js";
import { TERMINAL_STATUS_RE } from "../constants.js";
import type { DashboardData, RepoData } from "../fetch.js";
import type { ActionLogEntry } from "./use-action-log.js";
import { nextEntryId } from "./use-action-log.js";
import type { ToastAPI } from "./use-toast.js";

// ── Types ──

export interface ActionContext {
  /** Currently selected issue (null if header or task) */
  issue: GitHubIssue | null;
  /** Repo name for the selected issue */
  repoName: string | null;
  /** Repo config for the selected issue */
  repoConfig: RepoConfig | null;
  /** Status options for the selected issue's repo */
  statusOptions: StatusOption[];
}

export interface UseActionsResult {
  handlePick: () => void;
  handleComment: (body: string) => void;
  handleStatusChange: (optionId: string) => void;
  handleAssign: () => void;
  handleLabelChange: (addLabels: string[], removeLabels: string[]) => void;
  handleCreateIssue: (
    repo: string,
    title: string,
    body: string,
    dueDate?: string | null,
    labels?: string[],
  ) => Promise<{ repo: string; issueNumber: number } | null>;
  /** Bulk actions — return failed IDs (empty = all succeeded) */
  handleBulkAssign: (ids: ReadonlySet<string>) => Promise<string[]>;
  handleBulkUnassign: (ids: ReadonlySet<string>) => Promise<string[]>;
  handleBulkStatusChange: (ids: ReadonlySet<string>, optionId: string) => Promise<string[]>;
}

interface UseActionsOptions {
  config: HogConfig;
  repos: RepoData[];
  selectedId: string | null;
  toast: ToastAPI;
  mutateData: (fn: (data: DashboardData) => DashboardData) => void;
  refresh: (silent?: boolean) => void;
  onOverlayDone: () => void;
  pushEntry?: (entry: ActionLogEntry) => void;
  registerPendingMutation?: (
    repoName: string,
    issueNumber: number,
    fields: { projectStatus?: string },
  ) => void;
  clearPendingMutation?: (repoName: string, issueNumber: number) => void;
}

// ── Helpers ──

function findIssueContext(
  repos: RepoData[],
  selectedId: string | null,
  config: HogConfig,
): ActionContext {
  if (!selectedId?.startsWith("gh:")) {
    return { issue: null, repoName: null, repoConfig: null, statusOptions: [] };
  }

  for (const rd of repos) {
    for (const issue of rd.issues) {
      if (`gh:${rd.repo.name}:${issue.number}` === selectedId) {
        const repoConfig = config.repos.find((r) => r.name === rd.repo.name) ?? null;
        return { issue, repoName: rd.repo.name, repoConfig, statusOptions: rd.statusOptions };
      }
    }
  }
  return { issue: null, repoName: null, repoConfig: null, statusOptions: [] };
}

/** Returns true if the issue is already assigned and a toast was shown. */
function checkAlreadyAssigned(issue: GitHubIssue, selfLogin: string, toast: ToastAPI): boolean {
  const assignees = issue.assignees ?? [];
  if (assignees.some((a) => a.login === selfLogin)) {
    toast.info(`Already assigned to @${selfLogin}`);
    return true;
  }
  const firstAssignee = assignees[0];
  if (firstAssignee) {
    toast.info(`Already assigned to @${firstAssignee.login}`);
    return true;
  }
  return false;
}

// ── Hook ──

/** Trigger the configured completion action for a repo when moving to terminal status */
async function triggerCompletionActionAsync(
  action: RepoConfig["completionAction"],
  repoName: string,
  issueNumber: number,
): Promise<void> {
  switch (action.type) {
    case "closeIssue":
      await closeIssueAsync(repoName, issueNumber);
      break;
    case "addLabel":
      await addLabelAsync(repoName, issueNumber, action.label);
      break;
    case "updateProjectStatus":
      // This would require additional project config (optionId for the target status).
      // The user already changed the status, so this is a no-op.
      break;
  }
}

/** Apply optimistic status updates and register pending mutations for a set of issue IDs. */
function applyBulkOptimisticStatusUpdates(
  ids: ReadonlySet<string>,
  optionId: string,
  repos: RepoData[],
  config: HogConfig,
  mutateData: (fn: (data: DashboardData) => DashboardData) => void,
  registerPendingMutation:
    | ((repoName: string, issueNumber: number, fields: { projectStatus?: string }) => void)
    | undefined,
): void {
  for (const id of ids) {
    const ctx = findIssueContext(repos, id, config);
    if (!(ctx.issue && ctx.repoName)) continue;
    const { issue: ctxIssue, repoName: ctxRepo, statusOptions: ctxOpts } = ctx;
    mutateData((data) => optimisticSetStatus(data, ctxRepo, ctxIssue.number, ctxOpts, optionId));
    const ctxStatusName = ctxOpts.find((o) => o.id === optionId)?.name;
    if (ctxStatusName) {
      registerPendingMutation?.(ctxRepo, ctxIssue.number, { projectStatus: ctxStatusName });
    }
  }
}

/** Find the display name of a status option from any issue in the given id set. */
function resolveOptionName(
  repos: RepoData[],
  ids: ReadonlySet<string>,
  config: HogConfig,
  optionId: string,
): string {
  for (const id of ids) {
    const name = findIssueContext(repos, id, config).statusOptions.find(
      (o) => o.id === optionId,
    )?.name;
    if (name) return name;
  }
  return optionId;
}

/** Clear pending mutations for a list of failed issue IDs (format: "gh:repo:number"). */
function clearFailedMutations(
  failedIds: string[],
  clearFn: ((repoName: string, issueNumber: number) => void) | undefined,
): void {
  if (!clearFn) return;
  for (const failedId of failedIds) {
    const lastColon = failedId.lastIndexOf(":");
    const failedRepo = failedId.slice(3, lastColon); // strip leading "gh:"
    const failedIssueNumber = parseInt(failedId.slice(lastColon + 1), 10);
    clearFn(failedRepo, failedIssueNumber);
  }
}

/** Helper: optimistically set projectStatus on an issue in local data */
function optimisticSetStatus(
  data: DashboardData,
  repoName: string,
  issueNumber: number,
  statusOptions: StatusOption[],
  optionId: string,
): DashboardData {
  const statusName = statusOptions.find((o) => o.id === optionId)?.name;
  if (!statusName) return data;

  return {
    ...data,
    repos: data.repos.map((rd) => {
      if (rd.repo.name !== repoName) return rd;
      return {
        ...rd,
        issues: rd.issues.map((issue) =>
          issue.number === issueNumber ? { ...issue, projectStatus: statusName } : issue,
        ),
      };
    }),
  };
}

export function useActions({
  config,
  repos,
  selectedId,
  toast,
  refresh,
  mutateData,
  onOverlayDone,
  pushEntry,
  registerPendingMutation,
  clearPendingMutation,
}: UseActionsOptions): UseActionsResult {
  // Use refs so callbacks don't need to depend on frequently-changing values
  const configRef = useRef(config);
  const reposRef = useRef(repos);
  const selectedIdRef = useRef(selectedId);
  const pushEntryRef = useRef(pushEntry);
  const registerPendingMutationRef = useRef(registerPendingMutation);
  const clearPendingMutationRef = useRef(clearPendingMutation);
  configRef.current = config;
  reposRef.current = repos;
  selectedIdRef.current = selectedId;
  pushEntryRef.current = pushEntry;
  registerPendingMutationRef.current = registerPendingMutation;
  clearPendingMutationRef.current = clearPendingMutation;

  const handlePick = useCallback(() => {
    const ctx = findIssueContext(reposRef.current, selectedIdRef.current, configRef.current);
    if (!(ctx.issue && ctx.repoConfig)) return;

    const { issue, repoConfig } = ctx;
    if (checkAlreadyAssigned(issue, configRef.current.board.assignee, toast)) return;

    const t = toast.loading(`Picking ${repoConfig.shortName}#${issue.number}...`);
    pickIssue(configRef.current, { repo: repoConfig, issueNumber: issue.number })
      .then((result) => {
        const msg = `Picked ${repoConfig.shortName}#${issue.number} — assigned on GitHub`;
        t.resolve(result.warning ? `${msg} (${result.warning})` : msg);
        refresh();
      })
      .catch((err) => {
        t.reject(`Pick failed: ${formatError(err)}`);
      });
  }, [toast, refresh]);

  const handleComment = useCallback(
    (body: string) => {
      const ctx = findIssueContext(reposRef.current, selectedIdRef.current, configRef.current);
      if (!(ctx.issue && ctx.repoName)) {
        onOverlayDone();
        return;
      }

      const { issue, repoName } = ctx;
      const t = toast.loading("Commenting...");
      addCommentAsync(repoName, issue.number, body)
        .then(() => {
          t.resolve(`Comment posted on #${issue.number}`);
          pushEntryRef.current?.({
            id: nextEntryId(),
            description: `comment on #${issue.number}`,
            status: "success",
            ago: Date.now(),
          });
          refresh();
          onOverlayDone();
        })
        .catch((err) => {
          t.reject(`Comment failed: ${formatError(err)}`);
          pushEntryRef.current?.({
            id: nextEntryId(),
            description: `comment on #${issue.number} failed`,
            status: "error",
            ago: Date.now(),
          });
        });
    },
    [toast, refresh, onOverlayDone],
  );

  const handleStatusChange = useCallback(
    (optionId: string) => {
      const ctx = findIssueContext(reposRef.current, selectedIdRef.current, configRef.current);
      if (!(ctx.issue && ctx.repoName && ctx.repoConfig)) {
        onOverlayDone();
        return;
      }

      const { issue, repoName, repoConfig, statusOptions } = ctx;

      // Capture the inverse synchronously before the async mutation (undo thunk)
      const previousOptionId = statusOptions.find((o) => o.name === issue.projectStatus)?.id;
      const undoThunk = previousOptionId
        ? async () => {
            mutateData((data) =>
              optimisticSetStatus(data, repoName, issue.number, statusOptions, previousOptionId),
            );
            const undoProjectConfig: RepoProjectConfig = {
              projectNumber: repoConfig.projectNumber,
              statusFieldId: repoConfig.statusFieldId,
              optionId: previousOptionId,
            };
            await updateProjectItemStatusAsync(repoName, issue.number, undoProjectConfig);
          }
        : undefined;

      // Optimistic update: move issue to new section immediately
      mutateData((data) =>
        optimisticSetStatus(data, repoName, issue.number, statusOptions, optionId),
      );
      // Register a pending mutation so subsequent refreshes (e.g. triggered by
      // assign) don't revert this status change before GitHub propagates it.
      const statusName = statusOptions.find((o) => o.id === optionId)?.name;
      if (statusName) {
        registerPendingMutationRef.current?.(repoName, issue.number, {
          projectStatus: statusName,
        });
      }

      const t = toast.loading("Moving...");
      const projectConfig: RepoProjectConfig = {
        projectNumber: repoConfig.projectNumber,
        statusFieldId: repoConfig.statusFieldId,
        optionId,
      };

      updateProjectItemStatusAsync(repoName, issue.number, projectConfig)
        .then(async () => {
          const optionName = statusOptions.find((o) => o.id === optionId)?.name ?? optionId;

          // If terminal status, trigger completion action
          if (TERMINAL_STATUS_RE.test(optionName) && repoConfig.completionAction) {
            try {
              await triggerCompletionActionAsync(
                repoConfig.completionAction,
                repoName,
                issue.number,
              );
              t.resolve(
                `#${issue.number} \u2192 ${optionName} (${repoConfig.completionAction.type})`,
              );
            } catch {
              toast.info(`#${issue.number} \u2192 ${optionName} (completion action failed)`);
            }
          } else {
            t.resolve(`#${issue.number} \u2192 ${optionName}`);
          }
          pushEntryRef.current?.({
            id: nextEntryId(),
            description: `#${issue.number} \u2192 ${optionName}`,
            status: "success",
            ago: Date.now(),
            ...(undoThunk ? { undo: undoThunk } : {}),
          });
          // Do NOT refresh here — GitHub Projects v2 GraphQL is eventually consistent
        })
        .catch((err) => {
          t.reject(`Status change failed: ${formatError(err)}`);
          pushEntryRef.current?.({
            id: nextEntryId(),
            description: `#${issue.number} status change failed`,
            status: "error",
            ago: Date.now(),
          });
          // Clear the pending mutation before reverting so the refresh fetches server state
          clearPendingMutationRef.current?.(repoName, issue.number);
          refresh(); // revert optimistic update on failure
        })
        .finally(() => {
          onOverlayDone();
        });
    },
    [toast, refresh, mutateData, onOverlayDone],
  );

  const handleAssign = useCallback(() => {
    const ctx = findIssueContext(reposRef.current, selectedIdRef.current, configRef.current);
    if (!(ctx.issue && ctx.repoName)) return;

    const { issue, repoName } = ctx;
    if (checkAlreadyAssigned(issue, configRef.current.board.assignee, toast)) return;

    const t = toast.loading("Assigning...");
    assignIssueAsync(repoName, issue.number)
      .then(() => {
        t.resolve(`Assigned #${issue.number} to @${configRef.current.board.assignee}`);
        pushEntryRef.current?.({
          id: nextEntryId(),
          description: `#${issue.number} assigned`,
          status: "success",
          ago: Date.now(),
          undo: async () => {
            await unassignIssueAsync(repoName, issue.number, "@me");
          },
        });
        refresh();
      })
      .catch((err) => {
        t.reject(`Assign failed: ${formatError(err)}`);
        pushEntryRef.current?.({
          id: nextEntryId(),
          description: `#${issue.number} assign failed`,
          status: "error",
          ago: Date.now(),
        });
      });
  }, [toast, refresh]);

  const handleCreateIssue = useCallback(
    async (
      repo: string,
      title: string,
      body: string,
      dueDate?: string | null,
      labels?: string[],
    ): Promise<{ repo: string; issueNumber: number } | null> => {
      const repoConfig = configRef.current.repos.find((r) => r.name === repo);

      // If due date but no project date field configured, fall back to body text
      let effectiveBody = body;
      if (dueDate && !repoConfig?.dueDateFieldId) {
        const dueLine = `Due: ${dueDate}`;
        effectiveBody = body ? `${body}\n\n${dueLine}` : dueLine;
      }

      const t = toast.loading("Creating...");
      try {
        const output = await createIssueAsync(repo, title, effectiveBody, labels);

        // gh issue create returns the URL of the new issue
        const match = output.match(/\/(\d+)$/);
        const issueNumber = match?.[1] ? parseInt(match[1], 10) : 0;
        const shortName = repoConfig?.shortName ?? repo;

        // If due date field configured, set it on the project item (best-effort)
        if (issueNumber > 0 && dueDate && repoConfig?.dueDateFieldId) {
          const dueDateConfig: RepoDueDateConfig = {
            projectNumber: repoConfig.projectNumber,
            dueDateFieldId: repoConfig.dueDateFieldId,
          };
          updateProjectItemDateAsync(repo, issueNumber, dueDateConfig, dueDate).catch(() => {
            // best-effort: don't fail the whole create if date field update fails
          });
        }

        t.resolve(`Created ${shortName}#${issueNumber}`);
        refresh();
        onOverlayDone();
        return issueNumber > 0 ? { repo, issueNumber } : null;
      } catch (err) {
        t.reject(`Create failed: ${formatError(err)}`);
        onOverlayDone();
        return null;
      }
    },
    [toast, refresh, onOverlayDone],
  );

  const handleLabelChange = useCallback(
    (addLabels: string[], removeLabels: string[]) => {
      const ctx = findIssueContext(reposRef.current, selectedIdRef.current, configRef.current);
      if (!(ctx.issue && ctx.repoName)) return;
      const { issue, repoName } = ctx;

      const t = toast.loading("Updating labels...");
      updateLabelsAsync(repoName, issue.number, addLabels, removeLabels)
        .then(() => {
          t.resolve(`Labels updated on #${issue.number}`);
          refresh();
          onOverlayDone();
        })
        .catch((err) => {
          t.reject(`Label update failed: ${formatError(err)}`);
          onOverlayDone();
        });
    },
    [toast, refresh, onOverlayDone],
  );

  // ── Bulk actions ──
  // Each returns an array of IDs that failed (empty = all succeeded)

  const handleBulkAssign = useCallback(
    async (ids: ReadonlySet<string>): Promise<string[]> => {
      const failed: string[] = [];
      const t = toast.loading(`Assigning ${ids.size} issue${ids.size > 1 ? "s" : ""}...`);
      for (const id of ids) {
        const ctx = findIssueContext(reposRef.current, id, configRef.current);
        if (!(ctx.issue && ctx.repoName)) {
          failed.push(id);
          continue;
        }

        const assignees = ctx.issue.assignees ?? [];
        if (assignees.some((a) => a.login === configRef.current.board.assignee)) continue; // already assigned, skip

        try {
          await assignIssueAsync(ctx.repoName, ctx.issue.number);
        } catch {
          failed.push(id);
        }
      }
      const total = ids.size;
      const ok = total - failed.length;
      if (failed.length === 0) {
        t.resolve(
          `Assigned ${total} issue${total > 1 ? "s" : ""} to @${configRef.current.board.assignee}`,
        );
      } else {
        t.reject(`${ok} assigned, ${failed.length} failed`);
      }
      refresh();
      return failed;
    },
    [toast, refresh],
  );

  const handleBulkUnassign = useCallback(
    async (ids: ReadonlySet<string>): Promise<string[]> => {
      const failed: string[] = [];
      const t = toast.loading(`Unassigning ${ids.size} issue${ids.size > 1 ? "s" : ""}...`);
      for (const id of ids) {
        const ctx = findIssueContext(reposRef.current, id, configRef.current);
        if (!(ctx.issue && ctx.repoName)) {
          failed.push(id);
          continue;
        }

        const assignees = ctx.issue.assignees ?? [];
        if (!assignees.some((a) => a.login === configRef.current.board.assignee)) continue; // not self-assigned, skip

        try {
          await unassignIssueAsync(ctx.repoName, ctx.issue.number, "@me");
        } catch {
          failed.push(id);
        }
      }
      const total = ids.size;
      const ok = total - failed.length;
      if (failed.length === 0) {
        t.resolve(`Unassigned ${total} issue${total > 1 ? "s" : ""}`);
      } else {
        t.reject(`${ok} unassigned, ${failed.length} failed`);
      }
      refresh();
      return failed;
    },
    [toast, refresh],
  );

  const handleBulkStatusChange = useCallback(
    async (ids: ReadonlySet<string>, optionId: string): Promise<string[]> => {
      // Optimistic update: move all issues to new section immediately, register pending mutations
      applyBulkOptimisticStatusUpdates(
        ids,
        optionId,
        reposRef.current,
        configRef.current,
        mutateData,
        registerPendingMutationRef.current,
      );

      const t = toast.loading(`Moving ${ids.size} issue${ids.size > 1 ? "s" : ""}...`);
      const failed: string[] = [];
      for (const id of ids) {
        const ctx = findIssueContext(reposRef.current, id, configRef.current);
        if (!(ctx.issue && ctx.repoName && ctx.repoConfig)) {
          failed.push(id);
          continue;
        }

        try {
          const projectConfig: RepoProjectConfig = {
            projectNumber: ctx.repoConfig.projectNumber,
            statusFieldId: ctx.repoConfig.statusFieldId,
            optionId,
          };
          await updateProjectItemStatusAsync(ctx.repoName, ctx.issue.number, projectConfig);
        } catch {
          failed.push(id);
        }
      }
      const total = ids.size;
      const ok = total - failed.length;
      const optionName = resolveOptionName(reposRef.current, ids, configRef.current, optionId);
      if (failed.length === 0) {
        t.resolve(`Moved ${total} issue${total > 1 ? "s" : ""} to ${optionName}`);
        // Do not refresh — same eventual-consistency issue as single status change.
        // Pending mutations will preserve the optimistic state across auto-refreshes.
      } else {
        t.reject(`${ok} moved to ${optionName}, ${failed.length} failed`);
        // Clear pending mutations for failed issues so the refresh fetches their server state
        clearFailedMutations(failed, clearPendingMutationRef.current);
        refresh(); // revert optimistic updates for failed items
      }
      return failed;
    },
    [toast, refresh, mutateData],
  );

  return {
    handlePick,
    handleComment,
    handleStatusChange,
    handleAssign,
    handleLabelChange,
    handleCreateIssue,
    handleBulkAssign,
    handleBulkUnassign,
    handleBulkStatusChange,
  };
}

export { findIssueContext };
