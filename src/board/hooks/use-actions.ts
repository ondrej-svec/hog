import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { useCallback, useRef } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import type { GitHubIssue, RepoProjectConfig, StatusOption } from "../../github.js";
import { assignIssueAsync, updateProjectItemStatusAsync } from "../../github.js";
import { pickIssue } from "../../pick.js";
import type { DashboardData, RepoData } from "../fetch.js";
import type { ToastAPI } from "./use-toast.js";

const execFileAsync = promisify(execFile);

const TERMINAL_STATUS_RE = /^(done|shipped|won't|wont|closed|complete|completed)$/i;

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
  handleUnassign: () => void;
  handleCreateIssue: (
    repo: string,
    title: string,
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
  refresh: () => void;
  onOverlayDone: () => void;
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

// ── Hook ──

/** Trigger the configured completion action for a repo when moving to terminal status */
async function triggerCompletionActionAsync(
  action: RepoConfig["completionAction"],
  repoName: string,
  issueNumber: number,
): Promise<void> {
  switch (action.type) {
    case "closeIssue":
      await execFileAsync("gh", ["issue", "close", String(issueNumber), "--repo", repoName], {
        encoding: "utf-8",
        timeout: 30_000,
      });
      break;
    case "addLabel":
      await execFileAsync(
        "gh",
        ["issue", "edit", String(issueNumber), "--repo", repoName, "--add-label", action.label],
        { encoding: "utf-8", timeout: 30_000 },
      );
      break;
    case "updateProjectStatus":
      // This would require additional project config (optionId for the target status).
      // The user already changed the status, so this is a no-op.
      break;
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
}: UseActionsOptions): UseActionsResult {
  // Use refs so callbacks don't need to depend on frequently-changing values
  const configRef = useRef(config);
  const reposRef = useRef(repos);
  const selectedIdRef = useRef(selectedId);
  configRef.current = config;
  reposRef.current = repos;
  selectedIdRef.current = selectedId;

  const handlePick = useCallback(() => {
    const ctx = findIssueContext(reposRef.current, selectedIdRef.current, configRef.current);
    if (!(ctx.issue && ctx.repoConfig)) return;

    const { issue, repoConfig } = ctx;
    const assignees = issue.assignees ?? [];
    if (assignees.some((a) => a.login === configRef.current.board.assignee)) {
      toast.info(`Already assigned to @${configRef.current.board.assignee}`);
      return;
    }
    const firstAssignee = assignees[0];
    if (firstAssignee) {
      toast.info(`Already assigned to @${firstAssignee.login}`);
      return;
    }

    const t = toast.loading(`Picking ${repoConfig.shortName}#${issue.number}...`);
    pickIssue(configRef.current, { repo: repoConfig, issueNumber: issue.number })
      .then((result) => {
        const msg = `Picked ${repoConfig.shortName}#${issue.number} — assigned + synced to TickTick`;
        t.resolve(result.warning ? `${msg} (${result.warning})` : msg);
        refresh();
      })
      .catch((err) => {
        t.reject(`Pick failed: ${err instanceof Error ? err.message : String(err)}`);
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
      execFileAsync(
        "gh",
        ["issue", "comment", String(issue.number), "--repo", repoName, "--body", body],
        { encoding: "utf-8", timeout: 30_000 },
      )
        .then(() => {
          t.resolve(`Comment posted on #${issue.number}`);
          refresh();
        })
        .catch((err) => {
          t.reject(`Comment failed: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          onOverlayDone();
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

      // Optimistic update: move issue to new section immediately
      mutateData((data) =>
        optimisticSetStatus(data, repoName, issue.number, statusOptions, optionId),
      );

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
          refresh();
        })
        .catch((err) => {
          t.reject(`Status change failed: ${err instanceof Error ? err.message : String(err)}`);
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
    const assignees = issue.assignees ?? [];
    if (assignees.some((a) => a.login === configRef.current.board.assignee)) {
      toast.info(`Already assigned to @${configRef.current.board.assignee}`);
      return;
    }
    const firstAssignee = assignees[0];
    if (firstAssignee) {
      toast.info(`Already assigned to @${firstAssignee.login}`);
      return;
    }

    const t = toast.loading("Assigning...");
    assignIssueAsync(repoName, issue.number)
      .then(() => {
        t.resolve(`Assigned #${issue.number} to @${configRef.current.board.assignee}`);
        refresh();
      })
      .catch((err) => {
        t.reject(`Assign failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [toast, refresh]);

  const handleUnassign = useCallback(() => {
    const ctx = findIssueContext(reposRef.current, selectedIdRef.current, configRef.current);
    if (!(ctx.issue && ctx.repoName)) return;

    const { issue, repoName } = ctx;
    const assignees = issue.assignees ?? [];
    const selfAssigned = assignees.some((a) => a.login === configRef.current.board.assignee);

    if (!selfAssigned) {
      const firstAssignee = assignees[0];
      if (firstAssignee) {
        toast.info(`Assigned to @${firstAssignee.login} \u2014 can only unassign self`);
      } else {
        toast.info("Not assigned");
      }
      return;
    }

    const t = toast.loading("Unassigning...");
    execFileAsync(
      "gh",
      ["issue", "edit", String(issue.number), "--repo", repoName, "--remove-assignee", "@me"],
      { encoding: "utf-8", timeout: 30_000 },
    )
      .then(() => {
        t.resolve(`Unassigned #${issue.number} from @${configRef.current.board.assignee}`);
        refresh();
      })
      .catch((err) => {
        t.reject(`Unassign failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [toast, refresh]);

  const handleCreateIssue = useCallback(
    async (
      repo: string,
      title: string,
      labels?: string[],
    ): Promise<{ repo: string; issueNumber: number } | null> => {
      const args = ["issue", "create", "--repo", repo, "--title", title];
      if (labels && labels.length > 0) {
        for (const label of labels) {
          args.push("--label", label);
        }
      }
      const t = toast.loading("Creating...");
      try {
        const { stdout } = await execFileAsync("gh", args, { encoding: "utf-8", timeout: 30_000 });
        const output = stdout.trim();

        // gh issue create returns the URL of the new issue
        const match = output.match(/\/(\d+)$/);
        const issueNumber = match?.[1] ? parseInt(match[1], 10) : 0;
        const shortName = configRef.current.repos.find((r) => r.name === repo)?.shortName ?? repo;
        t.resolve(`Created ${shortName}#${issueNumber}`);
        refresh();
        onOverlayDone();
        return issueNumber > 0 ? { repo, issueNumber } : null;
      } catch (err) {
        t.reject(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
        onOverlayDone();
        return null;
      }
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
          await execFileAsync(
            "gh",
            [
              "issue",
              "edit",
              String(ctx.issue.number),
              "--repo",
              ctx.repoName,
              "--remove-assignee",
              "@me",
            ],
            { encoding: "utf-8", timeout: 30_000 },
          );
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
      // Optimistic update: move all issues to new section immediately
      for (const id of ids) {
        const ctx = findIssueContext(reposRef.current, id, configRef.current);
        if (ctx.issue && ctx.repoName) {
          const { issue: ctxIssue, repoName: ctxRepo, statusOptions: ctxOpts } = ctx;
          mutateData((data) =>
            optimisticSetStatus(data, ctxRepo, ctxIssue.number, ctxOpts, optionId),
          );
        }
      }

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
      const optionName = (() => {
        for (const id of ids) {
          const ctx = findIssueContext(reposRef.current, id, configRef.current);
          const name = ctx.statusOptions.find((o) => o.id === optionId)?.name;
          if (name) return name;
        }
        return optionId;
      })();
      if (failed.length === 0) {
        t.resolve(`Moved ${total} issue${total > 1 ? "s" : ""} to ${optionName}`);
      } else {
        t.reject(`${ok} moved to ${optionName}, ${failed.length} failed`);
      }
      refresh();
      return failed;
    },
    [toast, refresh, mutateData],
  );

  return {
    handlePick,
    handleComment,
    handleStatusChange,
    handleAssign,
    handleUnassign,
    handleCreateIssue,
    handleBulkAssign,
    handleBulkUnassign,
    handleBulkStatusChange,
  };
}

export { findIssueContext };
