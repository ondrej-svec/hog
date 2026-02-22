import { execFileSync, spawnSync } from "node:child_process";
import { Spinner } from "@inkjs/ui";
import { Box, Text, useApp, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClipboardArgs } from "../../clipboard.js";
import type { HogConfig, RepoConfig } from "../../config.js";
import type { GitHubIssue, IssueComment, LabelOption, StatusOption } from "../../github.js";
import { fetchIssueCommentsAsync } from "../../github.js";
import type { Task } from "../../types.js";
import { isHeaderId, isTerminalStatus, timeAgo } from "../constants.js";
import type { ActivityEvent, FetchOptions, RepoData } from "../fetch.js";
import { useActionLog } from "../hooks/use-action-log.js";
import { useActions } from "../hooks/use-actions.js";
import { refreshAgeColor, useData } from "../hooks/use-data.js";
import { useKeyboard } from "../hooks/use-keyboard.js";
import { useMultiSelect } from "../hooks/use-multi-select.js";
import type { NavItem } from "../hooks/use-navigation.js";
import { useNavigation } from "../hooks/use-navigation.js";
import { useToast } from "../hooks/use-toast.js";
import { useUIState } from "../hooks/use-ui-state.js";
import { ActionLog } from "./action-log.js";
import type { BulkAction } from "./bulk-action-menu.js";
import { DetailPanel } from "./detail-panel.js";
import type { FocusEndAction } from "./focus-mode.js";
import { HintBar } from "./hint-bar.js";
import { OverlayRenderer } from "./overlay-renderer.js";
import type { FlatRow } from "./row-renderer.js";
import { RowRenderer } from "./row-renderer.js";
import { StatusTabBar } from "./status-tab-bar.js";
import { TabBar } from "./tab-bar.js";
import { ToastContainer } from "./toast-container.js";

// ── Types ──

interface DashboardProps {
  readonly config: HogConfig;
  readonly options: FetchOptions;
  readonly activeProfile?: string | null;
}

// ── Helpers ──

interface StatusGroup {
  label: string;
  statuses: string[];
}

interface BoardGroup {
  label: string;
  subId: string; // `sub:${repo.name}:${label}` — globally unique
  issues: GitHubIssue[];
}

interface BoardSection {
  repo: RepoConfig;
  sectionId: string; // repo.name — globally unique
  groups: BoardGroup[];
  error: string | null;
}

interface BoardTree {
  activity: ActivityEvent[];
  sections: BoardSection[];
  tasks: Task[];
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

/** Build the unified board tree — single source of truth for all nav/row builders. */
function buildBoardTree(repos: RepoData[], tasks: Task[], activity: ActivityEvent[]): BoardTree {
  const sections = repos.map((rd): BoardSection => {
    const sectionId = rd.repo.name;

    if (rd.error) {
      return { repo: rd.repo, sectionId, groups: [], error: rd.error };
    }

    const statusGroupDefs = resolveStatusGroups(rd.statusOptions, rd.repo.statusGroups);
    const byStatus = groupByStatus(rd.issues);
    const coveredKeys = new Set<string>(); // normalized (lowercase-trim) covered keys
    const groups: BoardGroup[] = [];

    for (const sg of statusGroupDefs) {
      const issues: GitHubIssue[] = [];
      for (const [status, statusIssues] of byStatus) {
        if (sg.statuses.some((s) => s.toLowerCase().trim() === status.toLowerCase().trim())) {
          issues.push(...statusIssues);
        }
      }
      if (issues.length === 0) continue;
      issues.sort((a, b) => issuePriorityRank(a) - issuePriorityRank(b));
      groups.push({ label: sg.label, subId: `sub:${sectionId}:${sg.label}`, issues });
      for (const s of sg.statuses) coveredKeys.add(s.toLowerCase().trim());
    }

    // Overflow: uncovered non-terminal statuses
    for (const [status, statusIssues] of byStatus) {
      if (!(coveredKeys.has(status.toLowerCase().trim()) || isTerminalStatus(status))) {
        groups.push({ label: status, subId: `sub:${sectionId}:${status}`, issues: statusIssues });
      }
    }

    return { repo: rd.repo, sectionId, groups, error: null };
  });

  return { activity, sections, tasks };
}

// ── Tab navigation ──

interface Tab {
  id: string; // repo.name | "activity" | "ticktick"
  label: string; // repo.shortName | "Activity" | "Tasks"
  count: number; // issue/task/event count
}

function buildTabs(tree: BoardTree): Tab[] {
  const tabs: Tab[] = tree.sections.map(({ repo, groups }) => ({
    id: repo.name,
    label: repo.shortName,
    count: groups.reduce((s, g) => s + g.issues.length, 0),
  }));
  if (tree.activity.length > 0)
    tabs.push({ id: "activity", label: "Activity", count: tree.activity.length });
  if (tree.tasks.length > 0)
    tabs.push({ id: "ticktick", label: "Tasks", count: tree.tasks.length });
  return tabs;
}

// ── Status tab navigation ──

interface StatusTab {
  id: string; // BoardGroup.subId — e.g., "sub:aimee:Backlog"
  label: string; // BoardGroup.label — e.g., "Backlog"
  count: number; // BoardGroup.issues.length
}

function isRepoTab(tabId: string | null): boolean {
  return tabId !== null && tabId !== "activity" && tabId !== "ticktick";
}

function buildStatusTabs(tabId: string | null, tree: BoardTree): StatusTab[] {
  if (!isRepoTab(tabId)) return [];
  const section = tree.sections.find((s) => s.sectionId === tabId);
  if (!section) return [];
  return section.groups.map((g) => ({ id: g.subId, label: g.label, count: g.issues.length }));
}

function buildNavItemsForTab(
  tabId: string,
  tree: BoardTree,
  activeStatusId: string | null,
): NavItem[] {
  if (tabId === "activity") return [];
  if (tabId === "ticktick")
    return tree.tasks.map((task) => ({
      id: `tt:${task.id}`,
      section: tabId,
      type: "item" as const,
    }));
  const section = tree.sections.find((s) => s.sectionId === tabId);
  if (!section) return [];
  const activeGroup = section.groups.find((g) => g.subId === activeStatusId) ?? section.groups[0];
  if (!activeGroup) return [];
  return activeGroup.issues.map((issue) => ({
    id: `gh:${section.repo.name}:${issue.number}`,
    section: tabId,
    type: "item" as const,
  }));
}

function buildFlatRowsForTab(
  tabId: string,
  tree: BoardTree,
  activeStatusId: string | null,
): FlatRow[] {
  if (tabId === "activity")
    return tree.activity.map((event, i) => ({
      type: "activity" as const,
      key: `act:${i}`,
      navId: null,
      event,
    }));
  if (tabId === "ticktick")
    return tree.tasks.map((task) => ({
      type: "task" as const,
      key: `tt:${task.id}`,
      navId: `tt:${task.id}`,
      task,
    }));
  const section = tree.sections.find((s) => s.sectionId === tabId);
  if (!section) return [];
  if (section.error)
    return [{ type: "error" as const, key: `error:${tabId}`, navId: null, text: section.error }];
  if (section.groups.length === 0)
    return [
      { type: "subHeader" as const, key: `empty:${tabId}`, navId: null, text: "No open issues" },
    ];
  const activeGroup = section.groups.find((g) => g.subId === activeStatusId) ?? section.groups[0];
  if (!activeGroup) return [];
  return activeGroup.issues.map((issue) => ({
    type: "issue" as const,
    key: `gh:${section.repo.name}:${issue.number}`,
    navId: `gh:${section.repo.name}:${issue.number}`,
    issue,
    repoName: section.repo.name,
  }));
}

function openInBrowser(url: string): void {
  if (!(url.startsWith("https://") || url.startsWith("http://"))) return;
  try {
    execFileSync("open", [url], { stdio: "ignore" });
  } catch {
    // Silently ignore
  }
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

// ── RefreshAge ──

function RefreshAge({ lastRefresh }: { readonly lastRefresh: Date | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  if (!lastRefresh) return null;
  return <Text color={refreshAgeColor(lastRefresh)}>Updated {timeAgo(lastRefresh)}</Text>;
}

// ── Dashboard ──

// Header (1) + tab bar (1) + status sub-tab bar (1, repo tabs only) + hint bar (1) + padding (2 top+bottom)
// Repo tabs: 6 rows (status sub-tab bar visible). Activity/Tasks: 5 rows (status bar hidden).
const CHROME_ROWS_REPO = 6;
const CHROME_ROWS_OTHER = 5;

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
    pauseAutoRefresh,
    resumeAutoRefresh,
    registerPendingMutation,
    clearPendingMutation,
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

  // My-issues filter: toggle between all issues and issues assigned to me
  const [mineOnly, setMineOnly] = useState(false);
  const handleToggleMine = useCallback(() => {
    setMineOnly((prev) => !prev);
  }, []);

  // Toast notification system (replaces old statusMessage)
  const { toasts, toast, handleErrorAction } = useToast();

  // Action log
  const [logVisible, setLogVisible] = useState(false);
  const { entries: logEntries, pushEntry, undoLast, hasUndoable } = useActionLog(toast, refresh);

  // Auto-expand log when an error entry is pushed
  useEffect(() => {
    const last = logEntries[logEntries.length - 1];
    if (last?.status === "error") setLogVisible(true);
  }, [logEntries]);

  // After data loads, surface TickTick errors
  useEffect(() => {
    if (data?.ticktickError) {
      toast.error(`TickTick sync failed: ${data.ticktickError}`);
    }
  }, [data?.ticktickError, toast.error]);

  // Filter by search query and/or mineOnly
  const repos = useMemo(() => {
    let filtered = allRepos;
    if (mineOnly) {
      const me = config.board.assignee;
      filtered = filtered
        .map((rd) => ({
          ...rd,
          issues: rd.issues.filter((i) => (i.assignees ?? []).some((a) => a.login === me)),
        }))
        .filter((rd) => rd.issues.length > 0);
    }
    if (!searchQuery) return filtered;
    const q = searchQuery.toLowerCase();
    return filtered
      .map((rd) => ({ ...rd, issues: rd.issues.filter((i) => i.title.toLowerCase().includes(q)) }))
      .filter((rd) => rd.issues.length > 0);
  }, [allRepos, searchQuery, mineOnly, config.board.assignee]);

  const tasks = useMemo(() => {
    if (!searchQuery) return allTasks;
    const q = searchQuery.toLowerCase();
    return allTasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [allTasks, searchQuery]);

  // Single source of truth — computed once
  const boardTree = useMemo(
    () => buildBoardTree(repos, tasks, allActivity),
    [repos, tasks, allActivity],
  );

  // Tab navigation
  const tabs = useMemo(() => buildTabs(boardTree), [boardTree]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const effectiveTabId = activeTabId ?? tabs[0]?.id ?? null;
  const activeTabIdx = tabs.findIndex((t) => t.id === effectiveTabId);

  const nextTab = useCallback(() => {
    if (tabs.length === 0) return;
    setActiveTabId(tabs[(Math.max(activeTabIdx, 0) + 1) % tabs.length]?.id ?? null);
    setActiveStatusId(null);
  }, [activeTabIdx, tabs]);

  const prevTab = useCallback(() => {
    if (tabs.length === 0) return;
    setActiveTabId(tabs[(Math.max(activeTabIdx, 0) - 1 + tabs.length) % tabs.length]?.id ?? null);
    setActiveStatusId(null);
  }, [activeTabIdx, tabs]);

  const jumpToTab = useCallback(
    (idx: number) => {
      const tab = tabs[idx];
      if (tab) {
        setActiveTabId(tab.id);
        setActiveStatusId(null);
      }
    },
    [tabs],
  );

  // Status sub-tab navigation (second-level tabs within a repo tab)
  const [activeStatusId, setActiveStatusId] = useState<string | null>(null);
  const statusTabs = useMemo(
    () => buildStatusTabs(effectiveTabId, boardTree),
    [effectiveTabId, boardTree],
  );
  const effectiveStatusId = activeStatusId ?? statusTabs[0]?.id ?? null;
  const activeStatusIdx = statusTabs.findIndex((t) => t.id === effectiveStatusId);

  const nextStatus = useCallback(() => {
    if (statusTabs.length === 0) return;
    setActiveStatusId(
      statusTabs[(Math.max(activeStatusIdx, 0) + 1) % statusTabs.length]?.id ?? null,
    );
  }, [activeStatusIdx, statusTabs]);

  const prevStatus = useCallback(() => {
    if (statusTabs.length === 0) return;
    setActiveStatusId(
      statusTabs[(Math.max(activeStatusIdx, 0) - 1 + statusTabs.length) % statusTabs.length]?.id ??
        null,
    );
  }, [activeStatusIdx, statusTabs]);

  // Navigation — flat item list for active tab only
  const navItems = useMemo(
    () => buildNavItemsForTab(effectiveTabId ?? "", boardTree, effectiveStatusId),
    [effectiveTabId, boardTree, effectiveStatusId],
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
    pushEntry,
    registerPendingMutation,
    clearPendingMutation,
  });

  // "Pick this issue?" after create — stores the newly created issue info
  const pendingPickRef = useRef<{ repo: string; issueNumber: number } | null>(null);

  // Session-level label cache to avoid re-fetching on every overlay open
  const labelCacheRef = useRef<Record<string, LabelOption[]>>({});

  // Comment cache: key = "repo:issueNumber" → comments or loading/error state
  const commentCacheRef = useRef<Record<string, IssueComment[] | "loading" | "error">>({});
  // Tick counter triggers re-render when cache is updated (ref changes don't re-render on their own)
  const [commentTick, setCommentTick] = useState(0);

  const handleFetchComments = useCallback((repo: string, issueNumber: number) => {
    const key = `${repo}:${issueNumber}`;
    if (commentCacheRef.current[key] !== undefined) return;
    commentCacheRef.current[key] = "loading";
    setCommentTick((t) => t + 1);
    fetchIssueCommentsAsync(repo, issueNumber)
      .then((comments) => {
        commentCacheRef.current[key] = comments;
        setCommentTick((t) => t + 1);
      })
      .catch(() => {
        commentCacheRef.current[key] = "error";
        setCommentTick((t) => t + 1);
      });
  }, []);

  const handleCreateIssueWithPrompt = useCallback(
    (repo: string, title: string, body: string, dueDate: string | null, labels?: string[]) => {
      actions.handleCreateIssue(repo, title, body, dueDate, labels).then((result) => {
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
  const logPaneRows = logVisible ? 4 : 0;
  const chromeRows = isRepoTab(effectiveTabId) ? CHROME_ROWS_REPO : CHROME_ROWS_OTHER;
  const viewportHeight = Math.max(
    5,
    termSize.rows - chromeRows - overlayBarRows - toastRows - logPaneRows,
  );

  // Build flat rows for active tab
  const flatRows = useMemo(
    () => buildFlatRowsForTab(effectiveTabId ?? "", boardTree, effectiveStatusId),
    [effectiveTabId, boardTree, effectiveStatusId],
  );

  // Scroll offset - tracks viewport position
  const scrollRef = useRef(0);
  // Reset scroll to top when switching tabs so the first group header is always visible
  const prevTabIdRef = useRef<string | null>(null);
  if (effectiveTabId !== prevTabIdRef.current) {
    prevTabIdRef.current = effectiveTabId;
    scrollRef.current = 0;
  }

  const selectedRowIdx = useMemo(
    () => flatRows.findIndex((r) => r.navId === nav.selectedId),
    [flatRows, nav.selectedId],
  );

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

  // Derive current commentsState (re-computes on tick or selected issue change)
  // biome-ignore lint/correctness/useExhaustiveDependencies: commentTick is a cache-invalidation signal; it's intentionally in deps without being used in the body
  const currentCommentsState = useMemo((): IssueComment[] | "loading" | "error" | null => {
    if (!(selectedItem.issue && selectedItem.repoName)) return null;
    return commentCacheRef.current[`${selectedItem.repoName}:${selectedItem.issue.number}`] ?? null;
  }, [selectedItem.issue, selectedItem.repoName, commentTick]);

  // Repo config for the selected issue's repo (for edit issue overlay)
  const selectedRepoConfig = useMemo(() => {
    if (!selectedItem.repoName) return null;
    return config.repos.find((r) => r.name === selectedItem.repoName) ?? null;
  }, [selectedItem.repoName, config.repos]);

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
    const found = findSelectedIssueWithRepo(repos, nav.selectedId);
    if (found) openInBrowser(found.issue.url);
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

  // Fuzzy picker handlers
  const handleFuzzySelect = useCallback(
    (navId: string) => {
      nav.select(navId);
      // Switch to the tab that contains this item
      if (navId.startsWith("gh:")) {
        const parts = navId.split(":");
        const repoName = parts[1];
        if (parts.length >= 3 && repoName) {
          setActiveTabId(repoName);
          // Jump to the status group containing this issue
          const section = boardTree.sections.find((s) => s.sectionId === repoName);
          const issueNum = parts[2] ? Number(parts[2]) : null;
          const targetGroup = section?.groups.find((g) =>
            g.issues.some((iss) => iss.number === issueNum),
          );
          setActiveStatusId(targetGroup?.subId ?? null);
        }
      } else if (navId.startsWith("tt:")) {
        setActiveTabId("ticktick");
        setActiveStatusId(null);
      }
      ui.exitToNormal();
    },
    [nav, ui, boardTree],
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
      handleEnterLabel: ui.enterLabel,
      handleEnterCreateNl: ui.enterCreateNl,
      handleErrorAction,
      toastInfo: toast.info,
      handleToggleMine,
      handleEnterFuzzyPicker: ui.enterFuzzyPicker,
      handleEnterEditIssue: ui.enterEditIssue,
      handleUndo: undoLast,
      handleToggleLog: () => setLogVisible((v) => !v),
    },
    onSearchEscape,
    tabNav: { next: nextTab, prev: prevTab, jumpTo: jumpToTab, count: tabs.length },
    statusNav: isRepoTab(effectiveTabId) ? { next: nextStatus, prev: prevStatus } : null,
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
        ) : (
          <>
            <RefreshAge lastRefresh={lastRefresh} />
            {consecutiveFailures > 0 ? <Text color="red"> (!)</Text> : null}
          </>
        )}
        {autoRefreshPaused ? (
          <Text color="yellow"> Auto-refresh paused — press r to retry</Text>
        ) : null}
      </Box>

      {error ? <Text color="red">Error: {error}</Text> : null}

      {/* Tab bar */}
      <TabBar tabs={tabs} activeTabId={effectiveTabId} totalWidth={termSize.cols} />

      {/* Overlays — rendered by OverlayRenderer */}
      <OverlayRenderer
        uiState={ui.state}
        config={config}
        repos={allRepos}
        onFuzzySelect={handleFuzzySelect}
        onFuzzyClose={ui.exitToNormal}
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
        onPauseRefresh={pauseAutoRefresh}
        onResumeRefresh={resumeAutoRefresh}
        onToggleHelp={ui.toggleHelp}
        labelCache={labelCacheRef.current}
        onLabelConfirm={actions.handleLabelChange}
        onLabelError={(msg) => toast.error(msg)}
        onLlmFallback={(msg) => toast.info(msg)}
        selectedRepoName={selectedItem.repoName}
        selectedRepoConfig={selectedRepoConfig}
        onToastInfo={toast.info}
        onToastError={toast.error}
        onPushEntry={pushEntry}
      />

      {/* Main content: sticky header + scrollable list + optional detail panel (hidden during full-screen overlays) */}
      {!ui.state.helpVisible &&
      ui.state.mode !== "overlay:status" &&
      ui.state.mode !== "overlay:create" &&
      ui.state.mode !== "overlay:createNl" &&
      ui.state.mode !== "overlay:bulkAction" &&
      ui.state.mode !== "overlay:confirmPick" &&
      ui.state.mode !== "focus" ? (
        <>
          {/* Status sub-tab bar — only on repo tabs */}
          {isRepoTab(effectiveTabId) ? (
            <StatusTabBar
              tabs={statusTabs}
              activeTabId={effectiveStatusId}
              totalWidth={termSize.cols}
            />
          ) : null}
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
                  issueRepo={selectedItem.repoName}
                  fetchComments={handleFetchComments}
                  commentsState={currentCommentsState}
                />
              </Box>
            ) : null}
          </Box>
        </>
      ) : null}

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} />

      {/* Action log pane */}
      {logVisible ? <ActionLog entries={logEntries} /> : null}

      {/* Status bar */}
      <HintBar
        uiMode={ui.state.mode}
        multiSelectCount={multiSelect.count}
        searchQuery={searchQuery}
        mineOnly={mineOnly}
        hasUndoable={hasUndoable}
      />
    </Box>
  );
}

export { Dashboard };
export type { DashboardProps };
