import type { RepoConfig } from "../config.js";
import type { GitHubIssue, StatusOption } from "../github.js";
import type { FlatRow } from "./components/row-renderer.js";
import { isTerminalStatus } from "./constants.js";
import type { ActivityEvent, RepoData } from "./fetch.js";
import type { NavItem } from "./hooks/use-navigation.js";

// ── Types ──

export interface StatusGroup {
  label: string;
  statuses: string[];
}

export interface BoardGroup {
  label: string;
  subId: string; // `sub:${repo.name}:${label}` — globally unique
  issues: GitHubIssue[];
}

export interface BoardSection {
  repo: RepoConfig;
  sectionId: string; // repo.name — globally unique
  groups: BoardGroup[];
  error: string | null;
}

export interface BoardTree {
  activity: ActivityEvent[];
  sections: BoardSection[];
}

// ── Functions ──

/**
 * Resolve status groups for a repo.
 * If `configuredGroups` is provided, use those (each entry is "Status1,Status2" — first is header).
 * Otherwise, auto-detect from statusOptions (non-terminal statuses, Backlog last).
 */
export function resolveStatusGroups(
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
export const PRIORITY_RANK: Record<string, number> = {
  "priority:critical": 0,
  "priority:high": 1,
  "priority:medium": 2,
  "priority:low": 3,
};

export function issuePriorityRank(issue: GitHubIssue): number {
  for (const label of issue.labels ?? []) {
    const rank = PRIORITY_RANK[label.name.toLowerCase()];
    if (rank != null) return rank;
  }
  return 99; // no priority label
}

/** Group issues by project status. Issues without status go to "Backlog". Sorted by priority within groups. */
export function groupByStatus(issues: GitHubIssue[]): Map<string, GitHubIssue[]> {
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
export function buildBoardTree(repos: RepoData[], activity: ActivityEvent[]): BoardTree {
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

export function buildNavItemsForRepo(
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

export function buildFlatRowsForRepo(
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

/** Search filter: tokens are AND-ed, supports #123, @alice, unassigned/assigned, substring matching. */
export function matchesSearch(issue: GitHubIssue, query: string): boolean {
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

export function findSelectedIssueWithRepo(
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
