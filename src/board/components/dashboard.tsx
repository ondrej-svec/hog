import { execFile, spawn } from "node:child_process";
import { Spinner } from "@inkjs/ui";
import { Box, Text, useApp, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClipboardArgs } from "../../clipboard.js";
import type { HogConfig, RepoConfig } from "../../config.js";
import type { GitHubIssue, IssueComment, LabelOption, StatusOption } from "../../github.js";
import { fetchIssueCommentsAsync } from "../../github.js";
import type { PanelId } from "../constants.js";
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
import { useWorkflowState } from "../hooks/use-workflow-state.js";
import { DEFAULT_PHASE_PROMPTS, launchClaude } from "../launch-claude.js";
import { ActionLog } from "./action-log.js";
import { ActivityPanel } from "./activity-panel.js";
import type { BulkAction } from "./bulk-action-menu.js";
import { DetailPanel } from "./detail-panel.js";
import type { FocusEndAction } from "./focus-mode.js";
import { HintBar } from "./hint-bar.js";
import { OverlayRenderer } from "./overlay-renderer.js";
import { Panel } from "./panel.js";
import {
  ACTIVITY_HEIGHT,
  getDetailWidth,
  getLayoutMode,
  LEFT_COL_WIDTH,
  PanelLayout,
} from "./panel-layout.js";
import { ReposPanel } from "./repos-panel.js";
import type { FlatRow } from "./row-renderer.js";
import { RowRenderer } from "./row-renderer.js";
import { StatusesPanel } from "./statuses-panel.js";
import { ToastContainer } from "./toast-container.js";
import type { WorkflowAction } from "./workflow-overlay.js";

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
function buildBoardTree(repos: RepoData[], activity: ActivityEvent[]): BoardTree {
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

  return { activity, sections };
}

// ── Panel-based row builders ──

function buildNavItemsForRepo(
  sections: BoardSection[],
  repoName: string | null,
  statusGroupId: string | null,
): NavItem[] {
  if (!repoName) return [];
  const section = sections.find((s) => s.sectionId === repoName);
  if (!section) return [];
  const activeGroup = section.groups.find((g) => g.subId === statusGroupId) ?? section.groups[0];
  if (!activeGroup) return [];
  return activeGroup.issues.map((issue) => ({
    id: `gh:${section.repo.name}:${issue.number}`,
    section: repoName,
    type: "item" as const,
  }));
}

function buildFlatRowsForRepo(
  sections: BoardSection[],
  repoName: string | null,
  statusGroupId: string | null,
): FlatRow[] {
  if (!repoName) {
    return [
      {
        type: "subHeader" as const,
        key: "select-repo",
        navId: null,
        text: "Select a repo in panel [1]",
      },
    ];
  }
  const section = sections.find((s) => s.sectionId === repoName);
  if (!section) return [];
  if (section.error) {
    return [{ type: "error" as const, key: `error:${repoName}`, navId: null, text: section.error }];
  }
  if (section.groups.length === 0) {
    return [
      {
        type: "subHeader" as const,
        key: `empty:${repoName}`,
        navId: null,
        text: "No open issues",
      },
    ];
  }
  const activeGroup = section.groups.find((g) => g.subId === statusGroupId) ?? section.groups[0];
  if (!activeGroup) return [];
  if (activeGroup.issues.length === 0) {
    return [
      {
        type: "subHeader" as const,
        key: `empty-group:${statusGroupId}`,
        navId: null,
        text: "No issues in this status group",
      },
    ];
  }
  return activeGroup.issues.map((issue) => ({
    type: "issue" as const,
    key: `gh:${section.repo.name}:${issue.number}`,
    navId: `gh:${section.repo.name}:${issue.number}`,
    issue,
    repoName: section.repo.name,
  }));
}

function openInBrowser(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    execFile("open", [parsed.href], () => {});
  } catch {
    // Silently ignore invalid URLs
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
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!lastRefresh) return null;
  return <Text color={refreshAgeColor(lastRefresh)}>Updated {timeAgo(lastRefresh)}</Text>;
}

// ── Smart search ──
//
// Tokens are split on whitespace and AND-ed together.
// Each token matches if ANY of the following is true:
//   #123       → exact issue number
//   @alice     → assignee login substring (@ prefix optional)
//   unassigned → no assignees
//   assigned   → has at least one assignee
//   <text>     → substring of title, any label name, projectStatus, or assignee login

function matchesSearch(issue: GitHubIssue, query: string): boolean {
  if (!query.trim()) return true;
  const tokens = query.toLowerCase().trim().split(/\s+/);
  const labels = issue.labels ?? [];
  const assignees = issue.assignees ?? [];

  return tokens.every((token) => {
    // Issue number: #123
    if (token.startsWith("#")) {
      const num = parseInt(token.slice(1), 10);
      return !Number.isNaN(num) && issue.number === num;
    }

    // Explicit assignee: @alice
    if (token.startsWith("@")) {
      const login = token.slice(1);
      return assignees.some((a) => a.login.toLowerCase().includes(login));
    }

    // Special keywords
    if (token === "unassigned") return assignees.length === 0;
    if (token === "assigned") return assignees.length > 0;

    // Title
    if (issue.title.toLowerCase().includes(token)) return true;

    // Labels — full name (e.g. "bug", "priority:high", "size:m")
    // Substring match means "high" finds "priority:high", "m" finds "size:m", etc.
    if (labels.some((l) => l.name.toLowerCase().includes(token))) return true;

    // Project status (e.g. "in progress", "backlog")
    if (issue.projectStatus?.toLowerCase().includes(token)) return true;

    // Custom project fields (Workstream, Size, Priority, Iteration, etc.)
    if (
      issue.customFields &&
      Object.values(issue.customFields).some((v) => v.toLowerCase().includes(token))
    )
      return true;

    // Assignee login without @ prefix
    if (assignees.some((a) => a.login.toLowerCase().includes(token))) return true;

    return false;
  });
}

// ── Issues panel box (scrollable list + detail) ──

const CHROME_ROWS = 3; // header (1) + hintbar (1) + paddingX top/bottom (1)

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
  const allActivity = useMemo(() => data?.activity ?? [], [data?.activity]);

  // UI state machine
  const ui = useUIState();

  // Workflow state (enrichment.json)
  const workflowState = useWorkflowState(config);

  // Panel focus state — default to Issues panel [3]
  const [activePanelId, setActivePanelId] = useState<PanelId>(3);
  const focusPanel = useCallback((id: PanelId) => setActivePanelId(id), []);
  const panelFocus = useMemo(() => ({ activePanelId, focusPanel }), [activePanelId, focusPanel]);

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
    return filtered
      .map((rd) => ({ ...rd, issues: rd.issues.filter((i) => matchesSearch(i, searchQuery)) }))
      .filter((rd) => rd.issues.length > 0);
  }, [allRepos, searchQuery, mineOnly, config.board.assignee]);

  // Single source of truth — computed once (no tasks)
  const boardTree = useMemo(() => buildBoardTree(repos, allActivity), [repos, allActivity]);

  // Panel [1] — Repos cursor
  const [selectedRepoIdx, setSelectedRepoIdx] = useState(0);
  const clampedRepoIdx = Math.min(selectedRepoIdx, Math.max(0, boardTree.sections.length - 1));

  const reposNav = {
    moveUp: useCallback(() => setSelectedRepoIdx((i) => Math.max(0, i - 1)), []),
    moveDown: useCallback(
      () => setSelectedRepoIdx((i) => Math.min(Math.max(0, boardTree.sections.length - 1), i + 1)),
      [boardTree.sections.length],
    ),
  };

  // Panel [2] — Statuses cursor
  const [selectedStatusIdx, setSelectedStatusIdx] = useState(0);
  const selectedSection = boardTree.sections[clampedRepoIdx] ?? null;
  const clampedStatusIdx = Math.min(
    selectedStatusIdx,
    Math.max(0, (selectedSection?.groups.length ?? 1) - 1),
  );

  const statusesNav = {
    moveUp: useCallback(() => setSelectedStatusIdx((i) => Math.max(0, i - 1)), []),
    moveDown: useCallback(
      () =>
        setSelectedStatusIdx((i) =>
          Math.min(Math.max(0, (selectedSection?.groups.length ?? 1) - 1), i + 1),
        ),
      [selectedSection?.groups.length],
    ),
  };

  // Panel [4] — Activity cursor
  const [activitySelectedIdx, setActivitySelectedIdx] = useState(0);
  const clampedActivityIdx = Math.min(
    activitySelectedIdx,
    Math.max(0, boardTree.activity.length - 1),
  );

  const activityNav = {
    moveUp: useCallback(() => setActivitySelectedIdx((i) => Math.max(0, i - 1)), []),
    moveDown: useCallback(
      () =>
        setActivitySelectedIdx((i) => Math.min(Math.max(0, boardTree.activity.length - 1), i + 1)),
      [boardTree.activity.length],
    ),
  };

  // Derived selection state
  const selectedRepoName = selectedSection?.sectionId ?? null;
  const selectedStatusGroup = selectedSection?.groups[clampedStatusIdx] ?? null;
  const selectedStatusGroupId = selectedStatusGroup?.subId ?? null;

  // Panel Enter handlers
  const onRepoEnter = useCallback(() => {
    setSelectedStatusIdx(0);
    panelFocus.focusPanel(3);
  }, [panelFocus]);

  const onStatusEnter = useCallback(() => {
    panelFocus.focusPanel(3);
  }, [panelFocus]);

  const onActivityEnter = useCallback(() => {
    const event = boardTree.activity[clampedActivityIdx];
    if (!event) return;
    const repoIdx = boardTree.sections.findIndex(
      (s) =>
        s.repo.shortName === event.repoShortName || s.sectionId.endsWith(`/${event.repoShortName}`),
    );
    if (repoIdx >= 0) {
      setSelectedRepoIdx(repoIdx);
      setSelectedStatusIdx(0);
      panelFocus.focusPanel(3);
    }
  }, [boardTree, clampedActivityIdx, panelFocus]);

  // Navigation — flat item list for active repo + status group
  const navItems = useMemo(
    () => buildNavItemsForRepo(boardTree.sections, selectedRepoName, selectedStatusGroupId),
    [boardTree.sections, selectedRepoName, selectedStatusGroupId],
  );
  const nav = useNavigation(navItems);

  // Multi-select: resolve nav ID → repo name for same-repo constraint
  const getRepoForId = useCallback((id: string): string | null => {
    if (id.startsWith("gh:")) {
      const parts = id.split(":");
      return parts.length >= 3 ? `${parts[1]}` : null;
    }
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
          const msg = `Picked ${rc.shortName}#${pending.issueNumber} — assigned on GitHub`;
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
    }

    if (!label) return;
    setFocusLabel(label);
    ui.enterFocus();
  }, [nav.selectedId, repos, config.repos, ui]);

  const handleFocusExit = useCallback(() => {
    setFocusLabel(null);
    ui.exitToNormal();
  }, [ui]);

  const handleFocusEndAction = useCallback(
    (action: FocusEndAction) => {
      switch (action) {
        case "restart":
          toast.info("Focus restarted!");
          setFocusLabel((prev) => prev); // no-op to preserve label
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

  const layoutMode = getLayoutMode(termSize.cols);
  const detailPanelWidth =
    layoutMode === "wide" ? getDetailWidth(termSize.cols) : Math.floor(termSize.cols * 0.35);
  const showDetailPanel = layoutMode === "wide";

  // Explicit widths for title-in-border rendering (usableWidth = cols - 2 for paddingX={1})
  const usableWidth = termSize.cols - 2;
  const issuesPanelWidth = Math.max(
    20,
    layoutMode === "wide"
      ? usableWidth - LEFT_COL_WIDTH - getDetailWidth(termSize.cols)
      : layoutMode === "medium"
        ? usableWidth - LEFT_COL_WIDTH
        : usableWidth,
  );
  const activityPanelWidth = usableWidth;

  const overlayBarRows = ui.state.mode === "search" || ui.state.mode === "overlay:comment" ? 1 : 0;
  const toastRows = toasts.length;
  const logPaneRows = logVisible ? 4 : 0;

  // Total height available for the panel layout (issues + activity)
  const totalPanelHeight = Math.max(
    8,
    termSize.rows - CHROME_ROWS - overlayBarRows - toastRows - logPaneRows,
  );
  const issuesPanelHeight = Math.max(5, totalPanelHeight - ACTIVITY_HEIGHT);

  // Build flat rows for issues panel
  const flatRows = useMemo(
    () => buildFlatRowsForRepo(boardTree.sections, selectedRepoName, selectedStatusGroupId),
    [boardTree.sections, selectedRepoName, selectedStatusGroupId],
  );

  // Scroll offset - tracks viewport position
  const scrollRef = useRef(0);
  // Reset scroll to top when switching repos or status groups
  const prevRepoRef = useRef<string | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  if (selectedRepoName !== prevRepoRef.current || selectedStatusGroupId !== prevStatusRef.current) {
    prevRepoRef.current = selectedRepoName;
    prevStatusRef.current = selectedStatusGroupId;
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
    } else if (selectedRowIdx >= scrollRef.current + issuesPanelHeight) {
      scrollRef.current = selectedRowIdx - issuesPanelHeight + 1;
    }
  }
  const maxOffset = Math.max(0, flatRows.length - issuesPanelHeight);
  scrollRef.current = Math.max(0, Math.min(scrollRef.current, maxOffset));

  const visibleRows = flatRows.slice(scrollRef.current, scrollRef.current + issuesPanelHeight);
  const hasMoreAbove = scrollRef.current > 0;
  const hasMoreBelow = scrollRef.current + issuesPanelHeight < flatRows.length;
  const aboveCount = scrollRef.current;
  const belowCount = flatRows.length - scrollRef.current - issuesPanelHeight;

  // Find selected item for detail panel and overlays
  const selectedItem = useMemo((): {
    issue: GitHubIssue | null;
    repoName: string | null;
  } => {
    const id = nav.selectedId;
    if (!id || isHeaderId(id)) return { issue: null, repoName: null };
    if (id.startsWith("gh:")) {
      for (const rd of repos) {
        for (const issue of rd.issues) {
          if (`gh:${rd.repo.name}:${issue.number}` === id) return { issue, repoName: rd.repo.name };
        }
      }
    }
    return { issue: null, repoName: null };
  }, [nav.selectedId, repos]);

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
  const selectedRepoStatusOptions = useMemo(() => {
    const repoName = multiSelect.count > 0 ? multiSelect.constrainedRepo : selectedItem.repoName;
    if (!repoName) return [];
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
      const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.end(found.issue.url);
      child.on("close", (code) => {
        if (code === 0) {
          toast.success(`Copied ${label} to clipboard`);
        } else {
          toast.info(`${label} — ${found.issue.url}`);
        }
      });
    } else {
      toast.info(`${label} — ${found.issue.url}`);
    }
  }, [repos, nav.selectedId, config.repos, toast]);

  const handleLaunchClaude = useCallback(() => {
    const found = findSelectedIssueWithRepo(repos, nav.selectedId);
    if (!found) return; // cursor on header / empty row → silent no-op

    const rc = config.repos.find((r) => r.name === found.repoName);
    if (!rc?.localPath) {
      toast.info(
        `Set localPath for ${rc?.shortName ?? found.repoName} in ~/.config/hog/config.json to enable Claude Code launch`,
      );
      return;
    }

    const resolvedStartCommand = rc.claudeStartCommand ?? config.board.claudeStartCommand;
    const resolvedPromptTemplate = rc.claudePrompt ?? config.board.claudePrompt;
    const result = launchClaude({
      localPath: rc.localPath,
      issue: { number: found.issue.number, title: found.issue.title, url: found.issue.url },
      ...(resolvedStartCommand ? { startCommand: resolvedStartCommand } : {}),
      ...(resolvedPromptTemplate ? { promptTemplate: resolvedPromptTemplate } : {}),
      launchMode: config.board.claudeLaunchMode ?? "auto",
      ...(config.board.claudeTerminalApp ? { terminalApp: config.board.claudeTerminalApp } : {}),
      repoFullName: found.repoName,
    });

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.info(`Claude Code session opened in ${rc.shortName ?? found.repoName}`);
  }, [repos, nav.selectedId, config.repos, config.board, toast]);

  // Workflow overlay handlers
  const handleEnterWorkflow = useCallback(() => {
    const found = findSelectedIssueWithRepo(repos, nav.selectedId);
    if (!found) return;
    ui.enterWorkflow();
  }, [repos, nav.selectedId, ui]);

  const handleWorkflowAction = useCallback(
    (action: WorkflowAction) => {
      const found = findSelectedIssueWithRepo(repos, nav.selectedId);
      if (!found) return;

      const rc = config.repos.find((r) => r.name === found.repoName);

      if (action.type === "resume") {
        if (!rc?.localPath) {
          toast.info(
            `Set localPath for ${rc?.shortName ?? found.repoName} to enable Claude Code launch`,
          );
          ui.exitOverlay();
          return;
        }
        const resolvedStartCommand = rc.claudeStartCommand ?? config.board.claudeStartCommand;
        const result = launchClaude({
          localPath: rc.localPath,
          issue: { number: found.issue.number, title: found.issue.title, url: found.issue.url },
          ...(resolvedStartCommand ? { startCommand: resolvedStartCommand } : {}),
          launchMode: config.board.claudeLaunchMode ?? "auto",
          ...(config.board.claudeTerminalApp
            ? { terminalApp: config.board.claudeTerminalApp }
            : {}),
          repoFullName: found.repoName,
          promptTemplate: `--resume ${action.sessionId}`,
        });
        if (!result.ok) {
          toast.error(result.error.message);
        } else {
          toast.info(`Resumed Claude Code session`);
        }
        ui.exitOverlay();
        return;
      }

      // Launch phase
      if (!rc?.localPath) {
        toast.info(
          `Set localPath for ${rc?.shortName ?? found.repoName} to enable Claude Code launch`,
        );
        ui.exitOverlay();
        return;
      }

      const phasePrompts = rc?.workflow?.phasePrompts ?? config.board.workflow?.phasePrompts ?? {};
      const template = phasePrompts[action.phase] ?? DEFAULT_PHASE_PROMPTS[action.phase];

      const resolvedStartCommand = rc.claudeStartCommand ?? config.board.claudeStartCommand;
      const slug = found.issue.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const result = launchClaude({
        localPath: rc.localPath,
        issue: { number: found.issue.number, title: found.issue.title, url: found.issue.url },
        ...(resolvedStartCommand ? { startCommand: resolvedStartCommand } : {}),
        launchMode: config.board.claudeLaunchMode ?? "auto",
        ...(config.board.claudeTerminalApp ? { terminalApp: config.board.claudeTerminalApp } : {}),
        repoFullName: found.repoName,
        promptTemplate: template,
        promptVariables: {
          slug,
          phase: action.phase,
          repo: found.repoName,
        },
      });

      if (!result.ok) {
        toast.error(result.error.message);
        ui.exitOverlay();
        return;
      }

      // Record session in enrichment
      workflowState.recordSession({
        repo: found.repoName,
        issueNumber: found.issue.number,
        phase: action.phase,
        mode: action.mode,
        startedAt: new Date().toISOString(),
      });

      toast.info(`${action.phase} session opened for #${found.issue.number}`);
      ui.exitOverlay();
    },
    [repos, nav.selectedId, config, ui, toast, workflowState],
  );

  // Multi-select selection type (for bulk action menu)
  const multiSelectType = "github" as const;

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
          ui.enterStatus();
          return;
        case "complete":
        case "delete":
          toast.info(`Bulk ${action.type} not yet implemented`);
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
      ui.exitOverlay();
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
      if (navId.startsWith("gh:")) {
        const parts = navId.split(":");
        const repoName = parts[1];
        if (parts.length >= 3 && repoName) {
          const repoIdx = boardTree.sections.findIndex((s) => s.sectionId === repoName);
          if (repoIdx >= 0) {
            setSelectedRepoIdx(repoIdx);
            const section = boardTree.sections[repoIdx];
            const issueNum = parts[2] ? Number(parts[2]) : null;
            const groupIdx =
              section?.groups.findIndex((g) => g.issues.some((iss) => iss.number === issueNum)) ??
              -1;
            setSelectedStatusIdx(Math.max(0, groupIdx));
          }
        }
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
      handleLaunchClaude,
      handleEnterWorkflow,
    },
    onSearchEscape,
    panelFocus,
    reposNav,
    statusesNav,
    activityNav,
    onRepoEnter,
    onStatusEnter,
    onActivityEnter,
    showDetailPanel,
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

  // Panel [1] — Repos data
  const reposData = boardTree.sections.map(({ repo, groups }) => ({
    name: repo.name,
    openCount: groups.reduce((s, g) => s + g.issues.length, 0),
  }));

  // Panel [2] — Statuses data
  const statusesData = (selectedSection?.groups ?? []).map(({ label, subId, issues }) => ({
    id: subId,
    label,
    count: issues.length,
  }));

  // Panels
  const reposPanel = (
    <ReposPanel
      repos={reposData}
      selectedIdx={clampedRepoIdx}
      isActive={panelFocus.activePanelId === 1}
      width={LEFT_COL_WIDTH}
    />
  );

  const statusesPanel = (
    <StatusesPanel
      groups={statusesData}
      selectedIdx={clampedStatusIdx}
      isActive={panelFocus.activePanelId === 2}
      width={LEFT_COL_WIDTH}
      flexGrow={1}
    />
  );

  const issuesPanelTitle = `[3] Issues${selectedSection ? ` — ${selectedSection.repo.shortName}` : ""}${selectedStatusGroup ? ` / ${selectedStatusGroup.label}` : ""}`;

  const issuesPanel = (
    <Panel
      title={issuesPanelTitle}
      isActive={panelFocus.activePanelId === 3}
      width={issuesPanelWidth}
      flexGrow={1}
    >
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
          panelWidth={issuesPanelWidth}
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
    </Panel>
  );

  const detailPanel = showDetailPanel ? (
    <DetailPanel
      issue={selectedItem.issue}
      width={detailPanelWidth}
      isActive={panelFocus.activePanelId === 0}
      issueRepo={selectedItem.repoName}
      fetchComments={handleFetchComments}
      commentsState={currentCommentsState}
    />
  ) : null;

  const activityPanel = (
    <ActivityPanel
      events={boardTree.activity}
      selectedIdx={clampedActivityIdx}
      isActive={panelFocus.activePanelId === 4}
      height={ACTIVITY_HEIGHT}
      width={activityPanelWidth}
    />
  );

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
        workflowPhases={
          selectedItem.issue && selectedItem.repoName
            ? workflowState.getIssueWorkflow(
                selectedItem.repoName,
                selectedItem.issue.number,
                selectedRepoConfig ?? undefined,
              ).phases
            : []
        }
        workflowLatestSessionId={
          selectedItem.issue && selectedItem.repoName
            ? workflowState.getIssueWorkflow(
                selectedItem.repoName,
                selectedItem.issue.number,
                selectedRepoConfig ?? undefined,
              ).latestSessionId
            : undefined
        }
        onWorkflowAction={handleWorkflowAction}
      />

      {/* Detail overlay — full-screen on narrow layouts (no side panel) */}
      {ui.state.mode === "overlay:detail" ? (
        <DetailPanel
          issue={selectedItem.issue}
          width={usableWidth}
          height={issuesPanelHeight + ACTIVITY_HEIGHT}
          isActive={true}
          issueRepo={selectedItem.repoName}
          fetchComments={handleFetchComments}
          commentsState={currentCommentsState}
        />
      ) : null}

      {/* Main content: 5-panel layout (hidden during full-screen overlays) */}
      {!ui.state.helpVisible &&
      ui.state.mode !== "overlay:status" &&
      ui.state.mode !== "overlay:create" &&
      ui.state.mode !== "overlay:createNl" &&
      ui.state.mode !== "overlay:bulkAction" &&
      ui.state.mode !== "overlay:confirmPick" &&
      ui.state.mode !== "overlay:detail" &&
      ui.state.mode !== "focus" ? (
        <PanelLayout
          cols={termSize.cols}
          issuesPanelHeight={issuesPanelHeight}
          reposPanel={reposPanel}
          statusesPanel={statusesPanel}
          issuesPanel={issuesPanel}
          detailPanel={detailPanel}
          activityPanel={activityPanel}
        />
      ) : null}

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} />

      {/* Action log pane */}
      {logVisible ? <ActionLog entries={logEntries} /> : null}

      {/* Status bar */}
      <HintBar
        uiMode={ui.state.mode}
        activePanelId={panelFocus.activePanelId}
        multiSelectCount={multiSelect.count}
        searchQuery={searchQuery}
        mineOnly={mineOnly}
        hasUndoable={hasUndoable}
      />
    </Box>
  );
}

export { Dashboard, matchesSearch };
export type { DashboardProps };
