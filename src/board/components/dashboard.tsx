import { execFile, spawn } from "node:child_process";
import { Spinner } from "@inkjs/ui";
import { Box, Text, useApp, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClipboardArgs } from "../../clipboard.js";
import type { HogConfig, RepoConfig } from "../../config.js";
import type { EnrichmentData } from "../../enrichment.js";
import type { GitHubIssue, IssueComment, LabelOption } from "../../github.js";
import { fetchIssueCommentsAsync } from "../../github.js";
import {
  buildBoardTree,
  buildFlatRowsForRepo,
  buildNavItemsForRepo,
  findSelectedIssueWithRepo,
  matchesSearch,
} from "../board-tree.js";
import type { PanelId } from "../constants.js";
import { isHeaderId, timeAgo } from "../constants.js";
import type { FetchOptions } from "../fetch.js";
import { useActionLog } from "../hooks/use-action-log.js";
import { useActions } from "../hooks/use-actions.js";
import { useAgentSessions } from "../hooks/use-agent-sessions.js";
import { useAutoStatus } from "../hooks/use-auto-status.js";
import { refreshAgeColor, useData } from "../hooks/use-data.js";
import { useKeyboard } from "../hooks/use-keyboard.js";
import { useMultiSelect } from "../hooks/use-multi-select.js";
import { useNavigation } from "../hooks/use-navigation.js";
import { useNudges } from "../hooks/use-nudges.js";
import { useToast } from "../hooks/use-toast.js";
import { useUIState } from "../hooks/use-ui-state.js";
import { useViewportScroll } from "../hooks/use-viewport-scroll.js";
import { useWorkflowState } from "../hooks/use-workflow-state.js";
import { useZenMode } from "../hooks/use-zen-mode.js";
import { DEFAULT_PHASE_PROMPTS, launchClaude } from "../launch-claude.js";
import { ActionLog } from "./action-log.js";
import { ActivityPanel } from "./activity-panel.js";
import { AgentActivityPanel } from "./agent-activity-panel.js";
import type { BulkAction } from "./bulk-action-menu.js";
import { DetailPanel } from "./detail-panel.js";
import type { FocusEndAction } from "./focus-mode.js";
import { HintBar } from "./hint-bar.js";
import type { NudgeAction } from "./nudge-overlay.js";
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
import { RowRenderer } from "./row-renderer.js";
import { StatusesPanel } from "./statuses-panel.js";
import { ToastContainer } from "./toast-container.js";
import type { TriageAction } from "./triage-overlay.js";
import type { WorkflowAction } from "./workflow-overlay.js";

// ── Types ──

interface DashboardProps {
  readonly config: HogConfig;
  readonly options: FetchOptions;
  readonly activeProfile?: string | null;
}

// ── Helpers ──

/** Resolve launch config for a workflow phase (template + start command + slug). */
function resolvePhaseConfig(
  rc: RepoConfig,
  config: HogConfig,
  issueTitle: string,
  phase: string,
): {
  template: string | undefined;
  startCommand: { command: string; extraArgs: readonly string[] } | undefined;
  slug: string;
} {
  const phasePrompts = rc.workflow?.phasePrompts ?? config.board.workflow?.phasePrompts ?? {};
  const template = phasePrompts[phase] ?? DEFAULT_PHASE_PROMPTS[phase];
  const startCommand = rc.claudeStartCommand ?? config.board.claudeStartCommand;
  const slug = issueTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { template, startCommand, slug };
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

  // Toast notification system (replaces old statusMessage) — declared early for agent sessions
  const { toasts, toast, handleErrorAction } = useToast();

  // Background agent sessions
  const agentSessions = useAgentSessions(config, workflowState, toast);

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

  // Left panel visibility
  const [leftPanelHidden, setLeftPanelHidden] = useState(false);
  const handleToggleLeftPanel = useCallback(() => {
    setLeftPanelHidden((v) => !v);
    // Auto-switch to issues panel if currently focused on a hidden panel
    setActivePanelId((id) => (id === 1 || id === 2 ? 3 : id));
  }, []);

  // Action log
  const [logVisible, setLogVisible] = useState(false);
  const { entries: logEntries, pushEntry, undoLast, hasUndoable } = useActionLog(toast, refresh);

  // Auto-status updates — detects branch/PR events and updates GitHub Project status
  useAutoStatus({
    config,
    data,
    toast,
    mutateData,
    pushEntry,
    registerPendingMutation,
  });

  // Stable callback to avoid invalidating useCallbacks in use-nudges.ts
  const handleEnrichmentChange = useCallback(
    (data: EnrichmentData) => {
      workflowState.updateEnrichment(data);
    },
    [workflowState],
  );

  // Nudge system — staleness detection and snooze tracking
  const nudges = useNudges({
    config,
    repos: allRepos,
    enrichment: workflowState.enrichment,
    onEnrichmentChange: handleEnrichmentChange,
  });

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

  // Zen mode (tmux pane orchestration)
  const zen = useZenMode({
    ui,
    toast,
    termCols: termSize.cols,
    repos,
    selectedId: nav.selectedId,
  });

  const layoutMode = getLayoutMode(termSize.cols);
  const detailPanelWidth =
    layoutMode === "wide" ? getDetailWidth(termSize.cols) : Math.floor(termSize.cols * 0.35);
  const showDetailPanel = layoutMode === "wide";

  // Explicit widths for title-in-border rendering (usableWidth = cols - 2 for paddingX={1})
  const usableWidth = termSize.cols - 2;
  const effectiveLeftWidth = leftPanelHidden ? 0 : LEFT_COL_WIDTH;
  const issuesPanelWidth = Math.max(
    20,
    layoutMode === "wide"
      ? usableWidth - effectiveLeftWidth - getDetailWidth(termSize.cols)
      : layoutMode === "medium"
        ? usableWidth - effectiveLeftWidth
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
  // Rows available for content inside the Panel (title row + bottom border = 2 rows of chrome)
  const contentRowCount = Math.max(1, issuesPanelHeight - 2);

  // Build flat rows for issues panel, enriched with phase indicators and age
  const flatRows = useMemo(() => {
    const rows = buildFlatRowsForRepo(boardTree.sections, selectedRepoName, selectedStatusGroupId);
    return rows.map((row) => {
      if (row.type !== "issue") return row;
      // Phase indicator: derive from enrichment sessions
      const wf = workflowState.getIssueWorkflow(
        row.repoName,
        row.issue.number,
        config.repos.find((r) => r.name === row.repoName),
      );
      const activePhase = wf.phases.find((p) => p.state === "active");
      const lastCompleted = [...wf.phases].reverse().find((p) => p.state === "completed");
      const phaseIndicator = activePhase?.name ?? lastCompleted?.name;

      // Status age: days since last update (approximation for time in current status)
      const updatedMs = new Date(row.issue.updatedAt).getTime();
      const statusAgeDays = Math.floor((Date.now() - updatedMs) / 86_400_000);

      return { ...row, phaseIndicator, statusAgeDays };
    });
  }, [boardTree.sections, selectedRepoName, selectedStatusGroupId, workflowState, config.repos]);

  const selectedRowIdx = useMemo(
    () => flatRows.findIndex((r) => r.navId === nav.selectedId),
    [flatRows, nav.selectedId],
  );

  // Viewport-aware scrolling with scroll margin and indicator row accounting
  const scrollResetKey = `${selectedRepoName ?? ""}:${selectedStatusGroupId ?? ""}`;
  const viewport = useViewportScroll(
    flatRows.length,
    contentRowCount,
    selectedRowIdx,
    scrollResetKey,
  );
  const { hasMoreAbove, hasMoreBelow, aboveCount, belowCount } = viewport;
  const visibleRows = flatRows.slice(
    viewport.scrollOffset,
    viewport.scrollOffset + viewport.visibleCount,
  );

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

  // Memoize workflow lookup for the selected issue to avoid repeated linear scans
  const selectedIssueWorkflow = useMemo(() => {
    if (!(selectedItem.issue && selectedItem.repoName)) return null;
    return workflowState.getIssueWorkflow(
      selectedItem.repoName,
      selectedItem.issue.number,
      selectedRepoConfig ?? undefined,
    );
  }, [selectedItem.issue, selectedItem.repoName, selectedRepoConfig, workflowState]);

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

    // In zen mode: swap right pane to show the newly launched agent
    zen.swapToAgent(found.issue.number);
  }, [repos, nav.selectedId, config.repos, config.board, toast, zen]);

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

      // Completion check — launch background agent with completion-check phase
      if (action.type === "completion-check") {
        if (!rc?.localPath) {
          toast.info(
            `Set localPath for ${rc?.shortName ?? found.repoName} to enable Claude Code launch`,
          );
          ui.exitOverlay();
          return;
        }
        const { template, startCommand, slug } = resolvePhaseConfig(
          rc,
          config,
          found.issue.title,
          "completion-check",
        );
        const agentResult = agentSessions.launchAgent({
          localPath: rc.localPath,
          repoFullName: found.repoName,
          issueNumber: found.issue.number,
          issueTitle: found.issue.title,
          issueUrl: found.issue.url,
          phase: "completion-check",
          promptTemplate: template,
          promptVariables: { slug, phase: "completion-check", repo: found.repoName },
          ...(startCommand ? { startCommand } : {}),
        });
        if (typeof agentResult === "object" && "error" in agentResult) {
          toast.error(agentResult.error);
        } else {
          toast.info(`Completion check started for #${found.issue.number}`);
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

      const { template, startCommand, slug } = resolvePhaseConfig(
        rc,
        config,
        found.issue.title,
        action.phase,
      );

      if (action.mode === "background") {
        const agentResult = agentSessions.launchAgent({
          localPath: rc.localPath,
          repoFullName: found.repoName,
          issueNumber: found.issue.number,
          issueTitle: found.issue.title,
          issueUrl: found.issue.url,
          phase: action.phase,
          promptTemplate: template,
          promptVariables: { slug, phase: action.phase, repo: found.repoName },
          ...(startCommand ? { startCommand } : {}),
        });

        if (typeof agentResult === "object" && "error" in agentResult) {
          toast.error(agentResult.error);
        } else {
          toast.info(`Background agent started: ${action.phase} for #${found.issue.number}`);
        }
        ui.exitOverlay();
        return;
      }

      // Interactive: launch in terminal/tmux
      const result = launchClaude({
        localPath: rc.localPath,
        issue: { number: found.issue.number, title: found.issue.title, url: found.issue.url },
        ...(startCommand ? { startCommand } : {}),
        launchMode: config.board.claudeLaunchMode ?? "auto",
        ...(config.board.claudeTerminalApp ? { terminalApp: config.board.claudeTerminalApp } : {}),
        repoFullName: found.repoName,
        promptTemplate: template,
        promptVariables: { slug, phase: action.phase, repo: found.repoName },
      });

      if (!result.ok) {
        toast.error(result.error.message);
        ui.exitOverlay();
        return;
      }

      // Record interactive session in enrichment
      workflowState.recordSession({
        repo: found.repoName,
        issueNumber: found.issue.number,
        phase: action.phase,
        mode: "interactive",
        startedAt: new Date().toISOString(),
      });

      toast.info(`${action.phase} session opened for #${found.issue.number}`);
      ui.exitOverlay();
    },
    [repos, nav.selectedId, config, ui, toast, workflowState, agentSessions],
  );

  // Nudge action handler
  const handleNudgeAction = useCallback(
    (action: NudgeAction) => {
      if (action.type === "snooze") {
        nudges.snooze(action.repo, action.issueNumber, action.days);
        toast.info(`Snoozed #${action.issueNumber} for ${action.days}d`);
      } else {
        nudges.dismissNudge();
      }
    },
    [nudges, toast],
  );

  // Triage action handler
  const handleTriageAction = useCallback(
    (action: TriageAction) => {
      if (action.type === "snooze") {
        nudges.snooze(action.repo, action.issueNumber, action.days);
        toast.info(`Snoozed #${action.issueNumber} for ${action.days}d`);
        return;
      }

      // Launch agents for selected candidates
      let launched = 0;
      for (const candidate of action.candidates) {
        const rc = config.repos.find((r) => r.name === candidate.repo);
        if (!rc?.localPath) continue;

        const { template, startCommand, slug } = resolvePhaseConfig(
          rc,
          config,
          candidate.issue.title,
          action.phase,
        );

        if (action.mode === "background") {
          const result = agentSessions.launchAgent({
            localPath: rc.localPath,
            repoFullName: candidate.repo,
            issueNumber: candidate.issue.number,
            issueTitle: candidate.issue.title,
            issueUrl: candidate.issue.url,
            phase: action.phase,
            promptTemplate: template,
            promptVariables: { slug, phase: action.phase, repo: candidate.repo },
            ...(startCommand ? { startCommand } : {}),
          });
          if (typeof result === "string") launched++;
        } else {
          // Interactive: launch first only
          const result = launchClaude({
            localPath: rc.localPath,
            issue: {
              number: candidate.issue.number,
              title: candidate.issue.title,
              url: candidate.issue.url,
            },
            ...(startCommand ? { startCommand } : {}),
            launchMode: config.board.claudeLaunchMode ?? "auto",
            ...(config.board.claudeTerminalApp
              ? { terminalApp: config.board.claudeTerminalApp }
              : {}),
            repoFullName: candidate.repo,
            promptTemplate: template,
            promptVariables: { slug, phase: action.phase, repo: candidate.repo },
          });
          if (result.ok) {
            workflowState.recordSession({
              repo: candidate.repo,
              issueNumber: candidate.issue.number,
              phase: action.phase,
              mode: "interactive",
              startedAt: new Date().toISOString(),
            });
            launched++;
          }
          break; // Only one interactive launch
        }
      }

      if (launched > 0) {
        toast.info(`Launched ${launched} ${action.phase} agent${launched > 1 ? "s" : ""}`);
      }
      ui.exitOverlay();
    },
    [config, agentSessions, workflowState, nudges, toast, ui],
  );

  // Triage entry point handler
  const handleEnterTriage = useCallback(() => {
    if (nudges.candidates.length === 0) {
      toast.info("No stale issues to triage");
      return;
    }
    ui.enterTriage();
  }, [nudges.candidates.length, toast, ui]);

  // Multi-select selection type (for bulk action menu)

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
      }
    },
    [multiSelect, actions, ui],
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
      handleEnterTriage,
      handleToggleLeftPanel,
      handleToggleZen: zen.handleToggleZen,
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
    leftPanelHidden,
    issuesPageSize: viewport.visibleCount,
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
          stalenessConfig={config.board.workflow?.staleness}
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
    <Box flexDirection="column">
      {agentSessions.agents.length > 0 ? (
        <AgentActivityPanel agents={agentSessions.agents} maxHeight={2} />
      ) : null}
      <ActivityPanel
        events={boardTree.activity}
        selectedIdx={clampedActivityIdx}
        isActive={panelFocus.activePanelId === 4}
        height={
          agentSessions.agents.length > 0 ? Math.max(1, ACTIVITY_HEIGHT - 2) : ACTIVITY_HEIGHT
        }
        width={activityPanelWidth}
      />
    </Box>
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
        {agentSessions.runningCount > 0 ? (
          <Text color="magenta">
            {" "}
            [{agentSessions.runningCount} agent{agentSessions.runningCount > 1 ? "s" : ""}]
          </Text>
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
        workflowPhases={selectedIssueWorkflow?.phases ?? []}
        workflowLatestSessionId={selectedIssueWorkflow?.latestSessionId}
        onWorkflowAction={handleWorkflowAction}
        nudgeCandidates={nudges.candidates}
        onNudgeAction={handleNudgeAction}
        triageCandidates={nudges.candidates}
        onTriageAction={handleTriageAction}
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

      {/* Zen mode layout */}
      {ui.state.mode === "zen" ? (
        zen.zenPaneId ? (
          // Agent pane is joined — show narrow issue list (agent fills the rest via tmux)
          <Box flexDirection="column" height={issuesPanelHeight + ACTIVITY_HEIGHT}>
            <Panel title="Issues (Zen)" isActive width={usableWidth}>
              {visibleRows.map((row) => (
                <RowRenderer
                  key={row.key}
                  row={row}
                  selectedId={nav.selectedId}
                  selfLogin={config.board.assignee}
                  panelWidth={usableWidth}
                  stalenessConfig={config.board.workflow?.staleness}
                />
              ))}
            </Panel>
          </Box>
        ) : (
          // No agent — show issue list + detail panel side by side
          <Box flexDirection="row" height={issuesPanelHeight + ACTIVITY_HEIGHT}>
            <Box flexDirection="column" width={issuesPanelWidth}>
              <Panel title="Issues (Zen)" isActive width={issuesPanelWidth}>
                {visibleRows.map((row) => (
                  <RowRenderer
                    key={row.key}
                    row={row}
                    selectedId={nav.selectedId}
                    selfLogin={config.board.assignee}
                    panelWidth={issuesPanelWidth}
                    stalenessConfig={config.board.workflow?.staleness}
                  />
                ))}
              </Panel>
            </Box>
            <DetailPanel
              issue={selectedItem.issue}
              width={detailPanelWidth}
              isActive={false}
              issueRepo={selectedItem.repoName}
              fetchComments={handleFetchComments}
              commentsState={currentCommentsState}
            />
          </Box>
        )
      ) : null}

      {/* Main content: 5-panel layout (hidden during full-screen overlays) */}
      {!ui.state.helpVisible &&
      ui.state.mode !== "overlay:status" &&
      ui.state.mode !== "overlay:create" &&
      ui.state.mode !== "overlay:createNl" &&
      ui.state.mode !== "overlay:bulkAction" &&
      ui.state.mode !== "overlay:confirmPick" &&
      ui.state.mode !== "overlay:detail" &&
      ui.state.mode !== "overlay:nudge" &&
      ui.state.mode !== "overlay:triage" &&
      ui.state.mode !== "focus" &&
      ui.state.mode !== "zen" ? (
        <PanelLayout
          cols={termSize.cols}
          issuesPanelHeight={issuesPanelHeight}
          reposPanel={reposPanel}
          statusesPanel={statusesPanel}
          issuesPanel={issuesPanel}
          detailPanel={detailPanel}
          activityPanel={activityPanel}
          hideLeftPanel={leftPanelHidden}
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

export { Dashboard };
export type { DashboardProps };
