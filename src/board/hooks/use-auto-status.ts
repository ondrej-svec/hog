import { useCallback, useEffect, useRef } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import type { RepoProjectConfig, StatusOption } from "../../github.js";
import { updateProjectItemStatusAsync } from "../../github.js";
import type { ActivityEvent, DashboardData, RepoData } from "../fetch.js";
import type { ActionLogEntry } from "./use-action-log.js";
import { nextEntryId } from "./use-action-log.js";
import type { ToastAPI } from "./use-toast.js";

// ── Types ──

export interface AutoStatusEvent {
  readonly repoName: string;
  readonly issueNumber: number;
  readonly fromStatus: string | undefined;
  readonly toStatus: string;
  readonly trigger: string;
}

interface UseAutoStatusOptions {
  config: HogConfig;
  data: DashboardData | null;
  toast: ToastAPI;
  mutateData: (fn: (data: DashboardData) => DashboardData) => void;
  pushEntry?: (entry: ActionLogEntry) => void;
  registerPendingMutation?: (
    repoName: string,
    issueNumber: number,
    fields: { projectStatus?: string },
  ) => void;
}

export interface UseAutoStatusResult {
  /** List of auto-status updates applied in this session */
  autoStatusLog: readonly AutoStatusEvent[];
}

// ── Helpers ──

/** Match an activity event to an auto-status trigger for a repo config. */
export function matchTrigger(
  event: ActivityEvent,
  repoConfig: RepoConfig,
): string | undefined {
  const autoStatus = repoConfig.autoStatus;
  if (!autoStatus?.enabled) return undefined;

  const triggers = autoStatus.triggers;
  if (!triggers) return undefined;

  switch (event.type) {
    case "branch_created":
      return triggers.branchCreated;
    case "pr_opened":
      return triggers.prOpened;
    case "pr_merged":
      return triggers.prMerged;
    default:
      return undefined;
  }
}

/** Resolve a status name to an option ID from the status options list. */
export function resolveStatusOptionId(
  statusName: string,
  statusOptions: readonly StatusOption[],
): string | undefined {
  // Case-insensitive match
  const lower = statusName.toLowerCase();
  return statusOptions.find((o) => o.name.toLowerCase() === lower)?.id;
}

/** Find the repo data and config for an event's repo. */
function findRepoForEvent(
  event: ActivityEvent,
  data: DashboardData,
  config: HogConfig,
): { repoData: RepoData; repoConfig: RepoConfig } | null {
  for (const rd of data.repos) {
    if (rd.repo.shortName === event.repoShortName) {
      const rc = config.repos.find((r) => r.name === rd.repo.name);
      if (rc) return { repoData: rd, repoConfig: rc };
    }
  }
  return null;
}

/** Find an issue's current status from the repo data. */
function findCurrentStatus(
  repoData: RepoData,
  issueNumber: number,
): string | undefined {
  return repoData.issues.find((i) => i.number === issueNumber)?.projectStatus;
}

// ── Hook ──

export function useAutoStatus({
  config,
  data,
  toast,
  mutateData,
  pushEntry,
  registerPendingMutation,
}: UseAutoStatusOptions): UseAutoStatusResult {
  const lastProcessedRef = useRef<number>(Date.now());
  const autoStatusLogRef = useRef<AutoStatusEvent[]>([]);
  const processingRef = useRef<Set<string>>(new Set());
  const configRef = useRef(config);
  configRef.current = config;
  const pushEntryRef = useRef(pushEntry);
  pushEntryRef.current = pushEntry;
  const registerPendingMutationRef = useRef(registerPendingMutation);
  registerPendingMutationRef.current = registerPendingMutation;

  const processEvents = useCallback(
    (events: readonly ActivityEvent[], dashData: DashboardData) => {
      const cutoff = lastProcessedRef.current;
      const newEvents = events.filter((e) => e.timestamp.getTime() > cutoff);
      if (newEvents.length === 0) return;

      // Update the cutoff to the latest event timestamp
      const maxTs = Math.max(...newEvents.map((e) => e.timestamp.getTime()));
      lastProcessedRef.current = maxTs;

      for (const event of newEvents) {
        const match = findRepoForEvent(event, dashData, configRef.current);
        if (!match) continue;

        const { repoData, repoConfig } = match;
        const targetStatusName = matchTrigger(event, repoConfig);
        if (!targetStatusName) continue;

        const targetOptionId = resolveStatusOptionId(
          targetStatusName,
          repoData.statusOptions,
        );
        if (!targetOptionId) continue;

        // Guard: skip if issue already in the target status
        const currentStatus = findCurrentStatus(repoData, event.issueNumber);
        if (currentStatus?.toLowerCase() === targetStatusName.toLowerCase()) continue;

        // Guard: deduplicate — skip if we're already processing this issue
        const dedupeKey = `${repoConfig.name}:${String(event.issueNumber)}:${targetStatusName}`;
        if (processingRef.current.has(dedupeKey)) continue;
        processingRef.current.add(dedupeKey);

        // Optimistic update
        mutateData((d) => ({
          ...d,
          repos: d.repos.map((rd) => {
            if (rd.repo.name !== repoConfig.name) return rd;
            return {
              ...rd,
              issues: rd.issues.map((issue) =>
                issue.number === event.issueNumber
                  ? { ...issue, projectStatus: targetStatusName }
                  : issue,
              ),
            };
          }),
        }));

        registerPendingMutationRef.current?.(repoConfig.name, event.issueNumber, {
          projectStatus: targetStatusName,
        });

        const logEvent: AutoStatusEvent = {
          repoName: repoConfig.name,
          issueNumber: event.issueNumber,
          fromStatus: currentStatus,
          toStatus: targetStatusName,
          trigger: event.type,
        };

        const projectConfig: RepoProjectConfig = {
          projectNumber: repoConfig.projectNumber,
          statusFieldId: repoConfig.statusFieldId,
          optionId: targetOptionId,
        };

        updateProjectItemStatusAsync(repoConfig.name, event.issueNumber, projectConfig)
          .then(() => {
            autoStatusLogRef.current = [...autoStatusLogRef.current, logEvent];
            const desc = `auto: #${String(event.issueNumber)} → ${targetStatusName} (${event.type})`;
            toast.info(desc);
            pushEntryRef.current?.({
              id: nextEntryId(),
              description: desc,
              status: "success",
              ago: Date.now(),
            });
          })
          .catch(() => {
            // Silently fail — auto-status is best-effort
          })
          .finally(() => {
            processingRef.current.delete(dedupeKey);
          });
      }
    },
    [toast, mutateData],
  );

  // Process events whenever data changes
  useEffect(() => {
    if (!data) return;
    processEvents(data.activity, data);
  }, [data, processEvents]);

  return {
    autoStatusLog: autoStatusLogRef.current,
  };
}
