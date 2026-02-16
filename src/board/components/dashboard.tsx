import { execFileSync } from "node:child_process";
import { Spinner } from "@inkjs/ui";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HogConfig } from "../../config.js";
import type { GitHubIssue, StatusOption } from "../../github.js";
import type { Task } from "../../types.js";
import type { ActivityEvent, FetchOptions, RepoData } from "../fetch.js";
import { useActions } from "../hooks/use-actions.js";
import { refreshAgeColor, useData } from "../hooks/use-data.js";
import { useMultiSelect } from "../hooks/use-multi-select.js";
import type { NavItem } from "../hooks/use-navigation.js";
import { useNavigation } from "../hooks/use-navigation.js";
import { useToast } from "../hooks/use-toast.js";
import { useUIState } from "../hooks/use-ui-state.js";
import type { BulkAction } from "./bulk-action-menu.js";
import { BulkActionMenu } from "./bulk-action-menu.js";
import { CommentInput } from "./comment-input.js";
import { ConfirmPrompt } from "./confirm-prompt.js";
import { CreateIssueForm } from "./create-issue-form.js";
import { DetailPanel } from "./detail-panel.js";
import type { FocusEndAction } from "./focus-mode.js";
import { FocusMode } from "./focus-mode.js";
import { HelpOverlay } from "./help-overlay.js";
import { IssueRow } from "./issue-row.js";
import { SearchBar } from "./search-bar.js";
import { StatusPicker } from "./status-picker.js";
import { TaskRow } from "./task-row.js";
import { ToastContainer } from "./toast-container.js";

// ── Types ──

interface DashboardProps {
  readonly config: HogConfig;
  readonly options: FetchOptions;
  readonly activeProfile?: string | null;
}

type FlatRow =
  | {
      type: "sectionHeader";
      key: string;
      navId: string;
      label: string;
      count: number;
      countLabel: string;
      isCollapsed: boolean;
    }
  | {
      type: "subHeader";
      key: string;
      navId: string | null;
      text: string;
      count?: number;
      isCollapsed?: boolean;
    }
  | { type: "issue"; key: string; navId: string; issue: GitHubIssue; repoName: string }
  | { type: "task"; key: string; navId: string; task: Task }
  | { type: "activity"; key: string; navId: null; event: ActivityEvent }
  | { type: "error"; key: string; navId: null; text: string }
  | { type: "gap"; key: string; navId: null };

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

// ── Row Renderer ──

interface RowRendererProps {
  readonly row: FlatRow;
  readonly selectedId: string | null;
  readonly selfLogin: string;
  readonly isMultiSelected?: boolean | undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many row type variants
function RowRenderer({ row, selectedId, selfLogin, isMultiSelected }: RowRendererProps) {
  switch (row.type) {
    case "sectionHeader": {
      const arrow = row.isCollapsed ? "\u25B6" : "\u25BC";
      const isSel = selectedId === row.navId;
      return (
        <Box>
          <Text color={isSel ? "cyan" : "white"} bold>
            {arrow} {row.label}
          </Text>
          <Text color="gray">
            {" "}
            ({row.count} {row.countLabel})
          </Text>
        </Box>
      );
    }
    case "subHeader": {
      if (row.navId) {
        const arrow = row.isCollapsed ? "\u25B6" : "\u25BC";
        const isSel = selectedId === row.navId;
        return (
          <Box>
            <Text color={isSel ? "cyan" : "gray"}>
              {"  "}
              {arrow} {row.text}
            </Text>
            <Text color="gray"> ({row.count})</Text>
          </Box>
        );
      }
      return <Text color="gray"> {row.text}</Text>;
    }
    case "issue": {
      const checkbox = isMultiSelected != null ? (isMultiSelected ? "\u2611 " : "\u2610 ") : "";
      return (
        <Box>
          {checkbox ? <Text color={isMultiSelected ? "cyan" : "gray"}>{checkbox}</Text> : null}
          <IssueRow issue={row.issue} selfLogin={selfLogin} isSelected={selectedId === row.navId} />
        </Box>
      );
    }
    case "task": {
      const checkbox = isMultiSelected != null ? (isMultiSelected ? "\u2611 " : "\u2610 ") : "";
      return (
        <Box>
          {checkbox ? <Text color={isMultiSelected ? "cyan" : "gray"}>{checkbox}</Text> : null}
          <TaskRow task={row.task} isSelected={selectedId === row.navId} />
        </Box>
      );
    }
    case "activity": {
      const ago = timeAgo(row.event.timestamp);
      return (
        <Text dimColor>
          {"  "}
          {ago}: <Text color="gray">@{row.event.actor}</Text> {row.event.summary}{" "}
          <Text dimColor>({row.event.repoShortName})</Text>
        </Text>
      );
    }
    case "error":
      return <Text color="red"> Error: {row.text}</Text>;
    case "gap":
      return <Text>{""}</Text>;
  }
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
  const selectedRepoStatusOptions = useMemo(() => {
    // In multi-select, use the constrained repo
    const repoName = multiSelect.count > 0 ? multiSelect.constrainedRepo : selectedItem.repoName;
    if (!repoName || repoName === "ticktick") return [];
    const rd = repos.find((r) => r.repo.name === repoName);
    return rd?.statusOptions.filter((o) => !isTerminalStatus(o.name)) ?? [];
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

  // Main input handler — active in normal mode (and multiSelect/focus for nav)
  const handleInput = useCallback(
    (
      input: string,
      key: {
        downArrow: boolean;
        upArrow: boolean;
        tab: boolean;
        shift: boolean;
        return: boolean;
        escape: boolean;
      },
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keyboard handler with many shortcuts
    ) => {
      // Help toggle works in any state
      if (input === "?") {
        ui.toggleHelp();
        return;
      }

      // Escape: in multiSelect, clear selection and return to normal
      // In focus mode, FocusMode component handles Escape
      if (key.escape && ui.state.mode !== "focus") {
        if (ui.state.mode === "multiSelect") {
          multiSelect.clear();
        }
        ui.exitOverlay();
        return;
      }

      // Navigation (works in normal, multiSelect, focus)
      if (ui.canNavigate) {
        if (input === "j" || key.downArrow) {
          nav.moveDown();
          return;
        }
        if (input === "k" || key.upArrow) {
          nav.moveUp();
          return;
        }
        if (key.tab) {
          // Section jump clears selection (per spec: "changing repo section")
          if (ui.state.mode === "multiSelect") {
            multiSelect.clear();
            ui.clearMultiSelect();
          }
          key.shift ? nav.prevSection() : nav.nextSection();
          return;
        }
      }

      // Multi-select mode actions
      if (ui.state.mode === "multiSelect") {
        // Space toggles selection on current item
        if (input === " ") {
          const id = nav.selectedId;
          if (id && !isHeaderId(id)) {
            multiSelect.toggle(id);
            // If selection becomes empty, return to normal
            // (checked after toggle, so we need to check the new state)
          }
          return;
        }
        // Enter opens bulk action menu when items are selected
        if (key.return) {
          if (multiSelect.count > 0) {
            ui.enterBulkAction();
          }
          return;
        }
        // 'm' in multiSelect with selection opens status picker directly for bulk
        if (input === "m" && multiSelect.count > 0) {
          // We can't use the normal ENTER_STATUS transition from multiSelect,
          // so we'll go through bulk action menu. But for UX convenience, let's
          // handle it as a direct status picker.
          // Actually the reducer only allows overlay:status from normal mode.
          // Let's just open the bulk action menu instead.
          ui.enterBulkAction();
          return;
        }
        return; // No other actions in multiSelect mode
      }

      // Toast error actions (dismiss/retry) — work in normal mode
      if (input === "d") {
        if (handleErrorAction("dismiss")) return;
      }
      if (input === "r" && handleErrorAction("retry")) return;

      // Actions (only in normal mode)
      if (ui.canAct) {
        if (input === "/") {
          multiSelect.clear();
          ui.enterSearch();
          return;
        }
        if (input === "q") {
          exit();
          return;
        }
        if (input === "r" || input === "R") {
          multiSelect.clear();
          refresh();
          return;
        }
        if (input === "s") {
          handleSlack();
          return;
        }
        if (input === "p") {
          actions.handlePick();
          return;
        }
        if (input === "a") {
          actions.handleAssign();
          return;
        }
        if (input === "u") {
          actions.handleUnassign();
          return;
        }
        if (input === "c") {
          if (selectedItem.issue) {
            multiSelect.clear();
            ui.enterComment();
          }
          return;
        }
        if (input === "m") {
          if (selectedItem.issue && selectedRepoStatusOptions.length > 0) {
            multiSelect.clear();
            ui.enterStatus();
          } else if (selectedItem.issue) {
            toast.info("Issue not in a project board");
          }
          return;
        }
        if (input === "n") {
          multiSelect.clear();
          ui.enterCreate();
          return;
        }
        if (input === "f") {
          handleEnterFocus();
          return;
        }

        // Space on an item: toggle selection + enter multiSelect mode
        if (input === " ") {
          const id = nav.selectedId;
          if (id && !isHeaderId(id)) {
            multiSelect.toggle(id);
            ui.enterMultiSelect();
          } else if (isHeaderId(nav.selectedId)) {
            nav.toggleSection();
          }
          return;
        }

        if (key.return) {
          if (isHeaderId(nav.selectedId)) {
            nav.toggleSection();
            return;
          }
          handleOpen();
          return;
        }
      }
    },
    [
      ui,
      nav,
      exit,
      refresh,
      handleSlack,
      handleOpen,
      actions,
      selectedItem.issue,
      selectedRepoStatusOptions.length,
      toast,
      nav.selectedId,
      multiSelect,
      handleEnterFocus,
      handleErrorAction,
    ],
  );

  // Active when NOT in a text-input overlay
  const inputActive =
    ui.state.mode === "normal" || ui.state.mode === "multiSelect" || ui.state.mode === "focus";
  useInput(handleInput, { isActive: inputActive });

  // Search mode input handler
  const handleSearchEscape = useCallback(
    (_input: string, key: { escape: boolean }) => {
      if (key.escape) {
        ui.exitOverlay();
        setSearchQuery("");
      }
    },
    [ui],
  );
  useInput(handleSearchEscape, { isActive: ui.state.mode === "search" });

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

      {/* Help overlay (stacks on top) */}
      {ui.state.helpVisible ? (
        <HelpOverlay currentMode={ui.state.mode} onClose={ui.toggleHelp} />
      ) : null}

      {/* Status picker overlay */}
      {ui.state.mode === "overlay:status" && selectedRepoStatusOptions.length > 0 ? (
        <StatusPicker
          options={selectedRepoStatusOptions}
          currentStatus={multiSelect.count > 0 ? undefined : selectedItem.issue?.projectStatus}
          onSelect={multiSelect.count > 0 ? handleBulkStatusSelect : actions.handleStatusChange}
          onCancel={ui.exitOverlay}
        />
      ) : null}

      {/* Create issue form overlay */}
      {ui.state.mode === "overlay:create" ? (
        <CreateIssueForm
          repos={config.repos}
          defaultRepo={selectedItem.repoName}
          onSubmit={handleCreateIssueWithPrompt}
          onCancel={ui.exitOverlay}
        />
      ) : null}

      {/* Confirm pick prompt (after issue create) */}
      {ui.state.mode === "overlay:confirmPick" ? (
        <ConfirmPrompt
          message="Pick this issue?"
          onConfirm={handleConfirmPick}
          onCancel={handleCancelPick}
        />
      ) : null}

      {/* Bulk action menu overlay */}
      {ui.state.mode === "overlay:bulkAction" ? (
        <BulkActionMenu
          count={multiSelect.count}
          selectionType={multiSelectType}
          onSelect={handleBulkAction}
          onCancel={ui.exitOverlay}
        />
      ) : null}

      {/* Focus mode overlay */}
      {ui.state.mode === "focus" && focusLabel ? (
        <FocusMode
          key={focusKey}
          label={focusLabel}
          durationSec={config.board.focusDuration ?? 1500}
          onExit={handleFocusExit}
          onEndAction={handleFocusEndAction}
        />
      ) : null}

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

      {/* Search bar */}
      {ui.state.mode === "search" ? (
        <SearchBar defaultValue={searchQuery} onChange={setSearchQuery} onSubmit={ui.exitOverlay} />
      ) : null}

      {/* Comment input */}
      {ui.state.mode === "overlay:comment" && selectedItem.issue ? (
        <CommentInput
          issueNumber={selectedItem.issue.number}
          onSubmit={actions.handleComment}
          onCancel={ui.exitOverlay}
        />
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
              a/u:assign s:slack n:new f:focus ?:help q:quit
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
