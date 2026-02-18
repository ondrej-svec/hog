import { execFileSync, spawnSync } from "node:child_process";
import { Spinner } from "@inkjs/ui";
import { Box, Text, useApp, useStdout } from "ink";
import { getClipboardArgs } from "../../clipboard.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HogConfig } from "../../config.js";
import type { GitHubIssue, StatusOption } from "../../github.js";
import type { Task } from "../../types.js";
import type { ActivityEvent, FetchOptions, RepoData } from "../fetch.js";
import { useActions } from "../hooks/use-actions.js";
import { refreshAgeColor, useData } from "../hooks/use-data.js";
import { useKeyboard } from "../hooks/use-keyboard.js";
import { useMultiSelect } from "../hooks/use-multi-select.js";
import type { NavItem } from "../hooks/use-navigation.js";
import { useNavigation } from "../hooks/use-navigation.js";
import { useToast } from "../hooks/use-toast.js";
import { useUIState } from "../hooks/use-ui-state.js";
import type { BulkAction } from "./bulk-action-menu.js";
import { DetailPanel } from "./detail-panel.js";
import type { FocusEndAction } from "./focus-mode.js";
import { OverlayRenderer } from "./overlay-renderer.js";
import type { FlatRow } from "./row-renderer.js";
import { RowRenderer } from "./row-renderer.js";
import { ToastContainer } from "./toast-container.js";

// ── Types ──

interface DashboardProps {
  readonly config: HogConfig;
  readonly options: FetchOptions;
  readonly activeProfile?: string | null;
}

// ── Helpers ──

const TERMINAL_STATUS_RE = /^(done|shipped|won't|wont|closed|complete|completed)$/i;

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUS_RE.test(status);
}

interface StatusGroup {
  label: string;
  statuses: string[];
}

/**
 * Resolve status groups for a repo.
 * If `configuredGroups` is provided, use those (each entry is "Status1,Status2" — first is header).
 * Otherwise, auto-detect from statusOptions (non-terminal statuses, Backlog last).
 */
function resolveStatusGroups(
  statusOptions: StatusOption[],
  configuredGroups?: string[],
): StatusGroup[] {
  if (configuredGroups && configuredGroups.length > 0) {
    return configuredGroups.map((entry) => {
      const statuses = entry
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { label: statuses[0] ?? entry, statuses };
    });
  }

  // Auto-detect: each non-terminal status is its own group, Backlog last
  const nonTerminal = statusOptions.map((o) => o.name).filter((s) => !isTerminalStatus(s));
  if (nonTerminal.length > 0 && !nonTerminal.includes("Backlog")) {
    nonTerminal.push("Backlog");
  }
  const order = nonTerminal.length > 0 ? nonTerminal : ["In Progress", "Backlog"];
  return order.map((s) => ({ label: s, statuses: [s] }));
}

/** Extract priority rank from labels. Lower number = higher priority. */
const PRIORITY_RANK: Record<string, number> = {
  "priority:critical": 0,
  "priority:high": 1,
  "priority:medium": 2,
  "priority:low": 3,
};

function issuePriorityRank(issue: GitHubIssue): number {
  for (const label of issue.labels ?? []) {
    const rank = PRIORITY_RANK[label.name.toLowerCase()];
    if (rank != null) return rank;
  }
  return 99; // no priority label
}

/** Group issues by project status. Issues without status go to "Backlog". Sorted by priority within groups. */
function groupByStatus(issues: GitHubIssue[]): Map<string, GitHubIssue[]> {
  const groups = new Map<string, GitHubIssue[]>();
  for (const issue of issues) {
    const status = issue.projectStatus ?? "Backlog";
    const list = groups.get(status);
    if (list) {
      list.push(issue);
    } else {
      groups.set(status, [issue]);
    }
  }
  // Sort each group by priority (high first)
  for (const [, list] of groups) {
    list.sort((a, b) => issuePriorityRank(a) - issuePriorityRank(b));
  }
  return groups;
}

/** Collect issues for a status group (may span multiple statuses). */
function collectGroupIssues(
  statusGroup: StatusGroup,
  byStatus: Map<string, GitHubIssue[]>,
): GitHubIssue[] {
  const issues: GitHubIssue[] = [];
  for (const status of statusGroup.statuses) {
    const list = byStatus.get(status);
    if (list) issues.push(...list);
  }
  issues.sort((a, b) => issuePriorityRank(a) - issuePriorityRank(b));
  return issues;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TUI navigation tree builder
function buildNavItems(repos: RepoData[], tasks: Task[], activityCount: number): NavItem[] {
  const items: NavItem[] = [];
  if (activityCount > 0) {
    items.push({ id: "header:activity", section: "activity", type: "header" });
  }
  for (const rd of repos) {
    items.push({ id: `header:${rd.repo.shortName}`, section: rd.repo.shortName, type: "header" });
    const statusGroupDefs = resolveStatusGroups(rd.statusOptions, rd.repo.statusGroups);
    const byStatus = groupByStatus(rd.issues);
    const coveredStatuses = new Set<string>();

    for (const sg of statusGroupDefs) {
      const groupIssues = collectGroupIssues(sg, byStatus);
      if (groupIssues.length === 0) continue;
      const subId = `sub:${rd.repo.shortName}:${sg.label}`;
      items.push({ id: subId, section: rd.repo.shortName, type: "subHeader" });
      for (const issue of groupIssues) {
        items.push({
          id: `gh:${rd.repo.name}:${issue.number}`,
          section: rd.repo.shortName,
          type: "item",
          subSection: subId,
        });
      }
      for (const s of sg.statuses) coveredStatuses.add(s);
    }
    // Any issues in statuses not covered by groups (non-terminal) go at the end
    for (const [status, issues] of byStatus) {
      if (!(coveredStatuses.has(status) || isTerminalStatus(status)) && issues.length > 0) {
        const subId = `sub:${rd.repo.shortName}:${status}`;
        items.push({ id: subId, section: rd.repo.shortName, type: "subHeader" });
        for (const issue of issues) {
          items.push({
            id: `gh:${rd.repo.name}:${issue.number}`,
            section: rd.repo.shortName,
            type: "item",
            subSection: subId,
          });
        }
      }
    }
  }
  if (tasks.length > 0) {
    items.push({ id: "header:ticktick", section: "ticktick", type: "header" });
    for (const task of tasks) {
      items.push({ id: `tt:${task.id}`, section: "ticktick", type: "item" });
    }
  }
  return items;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flattens nested data into rows
function buildFlatRows(
  repos: RepoData[],
  tasks: Task[],
  activity: ActivityEvent[],
  isCollapsed: (section: string) => boolean,
): FlatRow[] {
  const rows: FlatRow[] = [];

  // Activity section (collapsed by default)
  if (activity.length > 0) {
    const collapsed = isCollapsed("activity");
    rows.push({
      type: "sectionHeader",
      key: "header:activity",
      navId: "header:activity",
      label: "Recent Activity (24h)",
      count: activity.length,
      countLabel: "events",
      isCollapsed: collapsed,
    });
    if (!collapsed) {
      for (const [i, event] of activity.entries()) {
        rows.push({ type: "activity", key: `act:${i}`, navId: null, event });
      }
    }
  }

  for (const rd of repos) {
    const { repo, issues, error: repoError } = rd;
    const collapsed = isCollapsed(repo.shortName);

    rows.push({
      type: "sectionHeader",
      key: `header:${repo.shortName}`,
      navId: `header:${repo.shortName}`,
      label: repo.shortName,
      count: issues.length,
      countLabel: "issues",
      isCollapsed: collapsed,
    });

    if (!collapsed) {
      if (repoError) {
        rows.push({ type: "error", key: `error:${repo.shortName}`, navId: null, text: repoError });
      } else if (issues.length === 0) {
        rows.push({
          type: "subHeader",
          key: `empty:${repo.shortName}`,
          navId: null,
          text: "No open issues",
        });
      } else {
        const statusGroupDefs = resolveStatusGroups(rd.statusOptions, rd.repo.statusGroups);
        const byStatus = groupByStatus(issues);
        const coveredStatuses = new Set<string>();
        let isFirstGroup = true;

        for (const sg of statusGroupDefs) {
          const groupIssues = collectGroupIssues(sg, byStatus);
          if (groupIssues.length === 0) continue;

          if (!isFirstGroup) {
            rows.push({ type: "gap", key: `gap:${repo.shortName}:${sg.label}`, navId: null });
          }
          isFirstGroup = false;

          const subId = `sub:${repo.shortName}:${sg.label}`;
          const subCollapsed = isCollapsed(subId);
          rows.push({
            type: "subHeader",
            key: subId,
            navId: subId,
            text: sg.label,
            count: groupIssues.length,
            isCollapsed: subCollapsed,
          });
          if (!subCollapsed) {
            for (const issue of groupIssues) {
              rows.push({
                type: "issue",
                key: `gh:${repo.name}:${issue.number}`,
                navId: `gh:${repo.name}:${issue.number}`,
                issue,
                repoName: repo.name,
              });
            }
          }
          for (const s of sg.statuses) coveredStatuses.add(s);
        }

        // Any statuses not covered by groups (non-terminal) go at the end
        for (const [status, groupIssues] of byStatus) {
          if (
            !(coveredStatuses.has(status) || isTerminalStatus(status)) &&
            groupIssues.length > 0
          ) {
            if (!isFirstGroup) {
              rows.push({ type: "gap", key: `gap:${repo.shortName}:${status}`, navId: null });
            }
            isFirstGroup = false;
            const subId = `sub:${repo.shortName}:${status}`;
            const subCollapsed = isCollapsed(subId);
            rows.push({
              type: "subHeader",
              key: subId,
              navId: subId,
              text: status,
              count: groupIssues.length,
              isCollapsed: subCollapsed,
            });
            if (!subCollapsed) {
              for (const issue of groupIssues) {
                rows.push({
                  type: "issue",
                  key: `gh:${repo.name}:${issue.number}`,
                  navId: `gh:${repo.name}:${issue.number}`,
                  issue,
                  repoName: repo.name,
                });
              }
            }
          }
        }
      }
    }
  }

  if (tasks.length > 0) {
    const collapsed = isCollapsed("ticktick");
    rows.push({
      type: "sectionHeader",
      key: "header:ticktick",
      navId: "header:ticktick",
      label: "Personal (TickTick)",
      count: tasks.length,
      countLabel: "tasks",
      isCollapsed: collapsed,
    });
    if (!collapsed) {
      for (const task of tasks) {
        rows.push({ type: "task", key: `tt:${task.id}`, navId: `tt:${task.id}`, task });
      }
    }
  }

  return rows;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function openInBrowser(url: string): void {
  try {
    execFileSync("open", [url], { stdio: "ignore" });
  } catch {
    // Silently ignore
  }
}

function findSelectedUrl(repos: RepoData[], selectedId: string | null): string | null {
  if (!selectedId?.startsWith("gh:")) return null;
  for (const rd of repos) {
    for (const issue of rd.issues) {
      if (`gh:${rd.repo.name}:${issue.number}` === selectedId) return issue.url;
    }
  }
  return null;
}

function findSelectedIssueWithRepo(
  repos: RepoData[],
  selectedId: string | null,
): { issue: GitHubIssue; repoName: string } | null {
  if (!selectedId?.startsWith("gh:")) return null;
  for (const rd of repos) {
    for (const issue of rd.issues) {
      if (`gh:${rd.repo.name}:${issue.number}` === selectedId)
        return { issue, repoName: rd.repo.name };
    }
  }
  return null;
}

function isHeaderId(id: string | null): boolean {
  return id != null && (id.startsWith("header:") || id.startsWith("sub:"));
}

// ── Dashboard ──

// Header (1) + blank after header (0) + status bar (1) + padding (2 top+bottom)
const CHROME_ROWS = 4;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: main TUI orchestrator
function Dashboard({ config, options, activeProfile }: DashboardProps) {
  const { exit } = useApp();
  const refreshMs = config.board.refreshInterval * 1000;
  const {
    status,
    data,
    error,
    lastRefresh,
    isRefreshing,
    consecutiveFailures,
    autoRefreshPaused,
    refresh,
    mutateData,
  } = useData(config, options, refreshMs);

  // Stable empty arrays to avoid new references when data is null
  const allRepos = useMemo(() => data?.repos ?? [], [data?.repos]);
  const allTasks = useMemo(
    () => (config.ticktick.enabled ? (data?.ticktick ?? []) : []),
    [data?.ticktick, config.ticktick.enabled],
  );
  const allActivity = useMemo(() => data?.activity ?? [], [data?.activity]);

  // UI state machine
  const ui = useUIState();

  // Search state (managed separately — search query persists across mode changes)
  const [searchQuery, setSearchQuery] = useState("");

  // Toast notification system (replaces old statusMessage)
  const { toasts, toast, handleErrorAction } = useToast();

  // Periodic tick to update refresh age display (every 10s)
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  // Filter by search query
  const repos = useMemo(() => {
    if (!searchQuery) return allRepos;
    const q = searchQuery.toLowerCase();
    return allRepos
      .map((rd) => ({ ...rd, issues: rd.issues.filter((i) => i.title.toLowerCase().includes(q)) }))
      .filter((rd) => rd.issues.length > 0);
  }, [allRepos, searchQuery]);

  const tasks = useMemo(() => {
    if (!searchQuery) return allTasks;
    const q = searchQuery.toLowerCase();
    return allTasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [allTasks, searchQuery]);

  // Navigation
  const navItems = useMemo(
    () => buildNavItems(repos, tasks, allActivity.length),
    [repos, tasks, allActivity.length],
  );
  const nav = useNavigation(navItems);

  // Multi-select: resolve nav ID → repo name for same-repo constraint
  const getRepoForId = useCallback((id: string): string | null => {
    if (id.startsWith("gh:")) {
      // Format: gh:owner/repo:number
      const parts = id.split(":");
      return parts.length >= 3 ? `${parts[1]}` : null;
    }
    if (id.startsWith("tt:")) return "ticktick";
    return null;
  }, []);
  const multiSelect = useMultiSelect(getRepoForId);

  // Prune multi-select when items change (e.g., issue closed during refresh)
  useEffect(() => {
    if (multiSelect.count === 0) return;
    const validIds = new Set(navItems.map((i) => i.id));
    multiSelect.prune(validIds);
  }, [navItems, multiSelect]);

  // Actions hook
  const actions = useActions({
    config,
    repos,
    selectedId: nav.selectedId,
    toast,
    refresh,
    mutateData,
    onOverlayDone: ui.exitOverlay,
  });

  // "Pick this issue?" after create — stores the newly created issue info
  const pendingPickRef = useRef<{ repo: string; issueNumber: number } | null>(null);

  const handleCreateIssueWithPrompt = useCallback(
    (repo: string, title: string, labels?: string[]) => {
      actions.handleCreateIssue(repo, title, labels).then((result) => {
        if (result) {
          pendingPickRef.current = result;
          ui.enterConfirmPick();
        }
      });
    },
    [actions, ui],
  );

  const handleConfirmPick = useCallback(() => {
    const pending = pendingPickRef.current;
    pendingPickRef.current = null;
    ui.exitOverlay();
    if (!pending) return;

    const rc = config.repos.find((r) => r.name === pending.repo);
    if (!rc) return;

    const t = toast.loading(`Picking ${rc.shortName}#${pending.issueNumber}...`);
    import("../../pick.js").then(({ pickIssue }) =>
      pickIssue(config, { repo: rc, issueNumber: pending.issueNumber })
        .then((result) => {
          const msg = `Picked ${rc.shortName}#${pending.issueNumber} — assigned + synced to TickTick`;
          t.resolve(result.warning ? `${msg} (${result.warning})` : msg);
          refresh();
        })
        .catch((err: unknown) => {
          t.reject(`Pick failed: ${err instanceof Error ? err.message : String(err)}`);
        }),
    );
  }, [config, toast, refresh, ui]);

  const handleCancelPick = useCallback(() => {
    pendingPickRef.current = null;
    ui.exitOverlay();
  }, [ui]);

  // Focus mode state
  const [focusLabel, setFocusLabel] = useState<string | null>(null);

  const handleEnterFocus = useCallback(() => {
    const id = nav.selectedId;
    if (!id || isHeaderId(id)) return;

    let label = "";
    if (id.startsWith("gh:")) {
      const found = findSelectedIssueWithRepo(repos, id);
      if (found) {
        const rc = config.repos.find((r) => r.name === found.repoName);
        label = `${rc?.shortName ?? found.repoName}#${found.issue.number} — ${found.issue.title}`;
      }
    } else if (id.startsWith("tt:")) {
      const taskId = id.slice(3);
      const task = tasks.find((t) => t.id === taskId);
      if (task) label = task.title;
    }

    if (!label) return;
    setFocusLabel(label);
    ui.enterFocus();
  }, [nav.selectedId, repos, tasks, config.repos, ui]);

  const handleFocusExit = useCallback(() => {
    setFocusLabel(null);
    ui.exitToNormal();
  }, [ui]);

  const handleFocusEndAction = useCallback(
    (action: FocusEndAction) => {
      switch (action) {
        case "restart":
          // Timer restarts — just stay in focus mode (component remounts with key)
          toast.info("Focus restarted!");
          setFocusLabel((prev) => prev); // no-op to preserve label
          // Force remount by toggling a counter
          setFocusKey((k) => k + 1);
          break;
        case "break":
          toast.info("Break time! Step away for a few minutes.");
          setFocusLabel(null);
          ui.exitToNormal();
          break;
        case "done":
          toast.success("Focus session complete!");
          setFocusLabel(null);
          ui.exitToNormal();
          break;
        case "exit":
          setFocusLabel(null);
          ui.exitToNormal();
          break;
      }
    },
    [toast, ui],
  );

  // Key to force-remount FocusMode on restart
  const [focusKey, setFocusKey] = useState(0);

  // Terminal dimensions
  const { stdout } = useStdout();
  const [termSize, setTermSize] = useState({
    cols: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setTermSize({ cols: stdout.columns, rows: stdout.rows });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  const showDetailPanel = termSize.cols >= 120;
  const detailPanelWidth = showDetailPanel ? Math.floor(termSize.cols * 0.35) : 0;
  const overlayBarRows = ui.state.mode === "search" || ui.state.mode === "overlay:comment" ? 1 : 0;
  const toastRows = toasts.length;
  const viewportHeight = Math.max(5, termSize.rows - CHROME_ROWS - overlayBarRows - toastRows);

  // Build flat rows
  const flatRows = useMemo(
    () => buildFlatRows(repos, tasks, allActivity, nav.isCollapsed),
    [repos, tasks, allActivity, nav.isCollapsed],
  );

  // Scroll offset - tracks viewport position
  const scrollRef = useRef(0);
  const selectedRowIdx = flatRows.findIndex((r) => r.navId === nav.selectedId);

  // Adjust scroll to keep selected item visible
  if (selectedRowIdx >= 0) {
    if (selectedRowIdx < scrollRef.current) {
      scrollRef.current = selectedRowIdx;
    } else if (selectedRowIdx >= scrollRef.current + viewportHeight) {
      scrollRef.current = selectedRowIdx - viewportHeight + 1;
    }
  }
  const maxOffset = Math.max(0, flatRows.length - viewportHeight);
  scrollRef.current = Math.max(0, Math.min(scrollRef.current, maxOffset));

  const visibleRows = flatRows.slice(scrollRef.current, scrollRef.current + viewportHeight);
  const hasMoreAbove = scrollRef.current > 0;
  const hasMoreBelow = scrollRef.current + viewportHeight < flatRows.length;
  const aboveCount = scrollRef.current;
  const belowCount = flatRows.length - scrollRef.current - viewportHeight;

  // Find selected item for detail panel and overlays
  const selectedItem = useMemo((): {
    issue: GitHubIssue | null;
    task: Task | null;
    repoName: string | null;
  } => {
    const id = nav.selectedId;
    if (!id || isHeaderId(id)) return { issue: null, task: null, repoName: null };
    if (id.startsWith("gh:")) {
      for (const rd of repos) {
        for (const issue of rd.issues) {
          if (`gh:${rd.repo.name}:${issue.number}` === id)
            return { issue, task: null, repoName: rd.repo.name };
        }
      }
    }
    if (id.startsWith("tt:")) {
      const taskId = id.slice(3);
      const task = tasks.find((t) => t.id === taskId);
      if (task) return { issue: null, task, repoName: null };
    }
    return { issue: null, task: null, repoName: null };
  }, [nav.selectedId, repos, tasks]);

  // Status options for the selected issue's repo (for status picker, single or bulk)
  // Terminal statuses are now included — StatusPicker renders them with a "(Done)" suffix
  const selectedRepoStatusOptions = useMemo(() => {
    // In multi-select, use the constrained repo
    const repoName = multiSelect.count > 0 ? multiSelect.constrainedRepo : selectedItem.repoName;
    if (!repoName || repoName === "ticktick") return [];
    const rd = repos.find((r) => r.repo.name === repoName);
    return rd?.statusOptions ?? [];
  }, [selectedItem.repoName, repos, multiSelect.count, multiSelect.constrainedRepo]);

  // Input handlers
  const handleOpen = useCallback(() => {
    const url = findSelectedUrl(repos, nav.selectedId);
    if (url) openInBrowser(url);
  }, [repos, nav.selectedId]);

  const handleSlack = useCallback(() => {
    const found = findSelectedIssueWithRepo(repos, nav.selectedId);
    if (!found?.issue.slackThreadUrl) return;
    openInBrowser(found.issue.slackThreadUrl);
  }, [repos, nav.selectedId]);

  const handleCopyLink = useCallback(() => {
    const found = findSelectedIssueWithRepo(repos, nav.selectedId);
    if (!found) return;
    const rc = config.repos.find((r) => r.name === found.repoName);
    const label = `${rc?.shortName ?? found.repoName}#${found.issue.number}`;
    const clipArgs = getClipboardArgs();
    if (clipArgs) {
      const [cmd, ...args] = clipArgs;
      if (!cmd) {
        toast.info(`${label} — ${found.issue.url}`);
        return;
      }
      const result = spawnSync(cmd, args, {
        input: found.issue.url,
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (result.status === 0) {
        toast.success(`Copied ${label} to clipboard`);
      } else {
        toast.info(`${label} — ${found.issue.url}`);
      }
    } else {
      toast.info(`${label} — ${found.issue.url}`);
    }
  }, [repos, nav.selectedId, config.repos, toast]);

  // Multi-select selection type (for bulk action menu)
  const multiSelectType = useMemo((): "github" | "ticktick" | "mixed" => {
    let hasGh = false;
    let hasTt = false;
    for (const id of multiSelect.selected) {
      if (id.startsWith("gh:")) hasGh = true;
      if (id.startsWith("tt:")) hasTt = true;
    }
    if (hasGh && hasTt) return "mixed";
    if (hasTt) return "ticktick";
    return "github";
  }, [multiSelect.selected]);

  // Bulk action handler (called from BulkActionMenu)
  const handleBulkAction = useCallback(
    (action: BulkAction) => {
      const ids = multiSelect.selected;

      switch (action.type) {
        case "assign": {
          ui.exitOverlay();
          actions.handleBulkAssign(ids).then((failedIds) => {
            if (failedIds.length > 0) {
              multiSelect.clear();
              for (const id of failedIds) multiSelect.toggle(id);
            } else {
              multiSelect.clear();
              ui.clearMultiSelect();
            }
          });
          return;
        }
        case "unassign": {
          ui.exitOverlay();
          actions.handleBulkUnassign(ids).then((failedIds) => {
            if (failedIds.length > 0) {
              multiSelect.clear();
              for (const id of failedIds) multiSelect.toggle(id);
            } else {
              multiSelect.clear();
              ui.clearMultiSelect();
            }
          });
          return;
        }
        case "statusChange":
          // Open status picker from bulk action menu — the reducer allows this transition
          ui.enterStatus();
          return; // status picker will call handleBulkStatusSelect on select
        case "complete":
        case "delete":
          toast.info(`Bulk ${action.type} not yet implemented for TickTick`);
          ui.exitOverlay();
          multiSelect.clear();
          return;
      }
    },
    [multiSelect, actions, ui, toast],
  );

  // Bulk status change handler (from StatusPicker when in multiSelect mode)
  const handleBulkStatusSelect = useCallback(
    (optionId: string) => {
      const ids = multiSelect.selected;
      ui.exitOverlay(); // close status picker
      actions.handleBulkStatusChange(ids, optionId).then((failedIds) => {
        if (failedIds.length > 0) {
          multiSelect.clear();
          for (const id of failedIds) multiSelect.toggle(id);
        } else {
          multiSelect.clear();
          ui.clearMultiSelect();
        }
      });
    },
    [multiSelect, actions, ui],
  );

  // Keyboard input — all useInput handlers live in use-keyboard.ts
  const onSearchEscape = useCallback(() => {
    ui.exitOverlay();
    setSearchQuery("");
  }, [ui]);

  useKeyboard({
    ui,
    nav,
    multiSelect,
    selectedIssue: selectedItem.issue,
    selectedRepoName: selectedItem.repoName,
    selectedRepoStatusOptionsLength: selectedRepoStatusOptions.length,
    actions: {
      exit,
      refresh,
      handleSlack,
      handleCopyLink,
      handleOpen,
      handleEnterFocus,
      handlePick: actions.handlePick,
      handleAssign: actions.handleAssign,
      handleUnassign: actions.handleUnassign,
      handleEnterLabel: ui.enterLabel,
      handleEnterCreateNl: ui.enterCreateNl,
      handleErrorAction,
      toastInfo: toast.info,
    },
    onSearchEscape,
  });

  // Loading state
  if (status === "loading" && !data) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Loading dashboard..." />
      </Box>
    );
  }

  const now = data?.fetchedAt ?? new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box>
        <Text color="cyan" bold>
          HOG BOARD
        </Text>
        {activeProfile ? <Text color="yellow"> [{activeProfile}]</Text> : null}
        <Text color="gray">
          {" "}
          {"\u2014"} {dateStr}
        </Text>
        <Text> </Text>
        {isRefreshing ? (
          <>
            <Spinner label="" />
            <Text color="cyan"> Refreshing...</Text>
          </>
        ) : lastRefresh ? (
          <>
            <Text color={refreshAgeColor(lastRefresh)}>Updated {timeAgo(lastRefresh)}</Text>
            {consecutiveFailures > 0 ? <Text color="red"> (!)</Text> : null}
          </>
        ) : null}
        {autoRefreshPaused ? (
          <Text color="yellow"> Auto-refresh paused — press r to retry</Text>
        ) : null}
      </Box>

      {error ? <Text color="red">Error: {error}</Text> : null}

      {/* Overlays — rendered by OverlayRenderer */}
      <OverlayRenderer
        uiState={ui.state}
        config={config}
        selectedRepoStatusOptions={selectedRepoStatusOptions}
        currentStatus={multiSelect.count > 0 ? undefined : selectedItem.issue?.projectStatus}
        onStatusSelect={multiSelect.count > 0 ? handleBulkStatusSelect : actions.handleStatusChange}
        onExitOverlay={ui.exitOverlay}
        defaultRepo={selectedItem.repoName}
        onCreateIssue={handleCreateIssueWithPrompt}
        onConfirmPick={handleConfirmPick}
        onCancelPick={handleCancelPick}
        multiSelectCount={multiSelect.count}
        multiSelectType={multiSelectType}
        onBulkAction={handleBulkAction}
        focusLabel={focusLabel}
        focusKey={focusKey}
        onFocusExit={handleFocusExit}
        onFocusEndAction={handleFocusEndAction}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={ui.exitOverlay}
        selectedIssue={selectedItem.issue}
        onComment={actions.handleComment}
        onToggleHelp={ui.toggleHelp}
      />

      {/* Main content: scrollable list + optional detail panel (hidden during full-screen overlays) */}
      {!ui.state.helpVisible &&
      ui.state.mode !== "overlay:status" &&
      ui.state.mode !== "overlay:create" &&
      ui.state.mode !== "overlay:bulkAction" &&
      ui.state.mode !== "overlay:confirmPick" &&
      ui.state.mode !== "focus" ? (
        <Box height={viewportHeight}>
          {/* Scrollable list */}
          <Box flexDirection="column" flexGrow={1}>
            {hasMoreAbove ? (
              <Text color="gray" dimColor>
                {" "}
                {"\u25B2"} {aboveCount} more above
              </Text>
            ) : null}

            {visibleRows.map((row) => (
              <RowRenderer
                key={row.key}
                row={row}
                selectedId={nav.selectedId}
                selfLogin={config.board.assignee}
                isMultiSelected={
                  ui.state.mode === "multiSelect" && row.navId
                    ? multiSelect.isSelected(row.navId)
                    : undefined
                }
              />
            ))}

            {hasMoreBelow ? (
              <Text color="gray" dimColor>
                {" "}
                {"\u25BC"} {belowCount} more below
              </Text>
            ) : null}
          </Box>

          {/* Detail panel */}
          {showDetailPanel ? (
            <Box marginLeft={1} width={detailPanelWidth}>
              <DetailPanel
                issue={selectedItem.issue}
                task={selectedItem.task}
                width={detailPanelWidth}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} />

      {/* Status bar */}
      <Box>
        {ui.state.mode === "multiSelect" ? (
          <>
            <Text color="cyan" bold>
              {multiSelect.count} selected
            </Text>
            <Text color="gray"> Space:toggle Enter:actions Esc:cancel</Text>
          </>
        ) : ui.state.mode === "focus" ? (
          <Text color="magenta" bold>
            Focus mode — Esc to exit
          </Text>
        ) : (
          <>
            <Text color="gray">
              j/k:nav Tab:section Enter:open Space:select /:search p:pick c:comment m:status
              a/u:assign s:slack y:copy l:labels n:new I:nlcreate C:collapse f:focus ?:help q:quit
            </Text>
            {searchQuery && ui.state.mode !== "search" ? (
              <Text color="yellow"> filter: &quot;{searchQuery}&quot;</Text>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
}

export { Dashboard };
export type { DashboardProps };
