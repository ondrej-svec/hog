import type { GitHubIssue } from "../github.js";
import type { DashboardData, RepoData } from "./fetch.js";
import { getTheme } from "./theme.js";

const theme = getTheme();

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

function issueAssignee(issue: GitHubIssue, selfLogin: string): string {
  const assignees = issue.assignees ?? [];
  if (assignees.length === 0) return theme.assignee.unassigned("unassigned");
  const names = assignees.map((a) => a.login);
  const isSelf = names.includes(selfLogin);
  const display = names.join(", ");
  return isSelf ? theme.assignee.self(display) : theme.assignee.others(display);
}

function formatIssueLine(issue: GitHubIssue, selfLogin: string, maxTitle: number): string {
  const num = theme.text.accent(`#${String(issue.number).padEnd(5)}`);
  const title = truncate(issue.title, maxTitle);
  const assignee = issueAssignee(issue, selfLogin);
  return `  ${num} ${title.padEnd(maxTitle)} ${assignee}`;
}

function printSection(title: string, content: string): void {
  const line = theme.border.primary("\u2500".repeat(Math.max(0, title.length + 4)));
  console.log(`\n${theme.text.primary(title)}`);
  console.log(line);
  console.log(content);
}

function renderRepoSection(data: RepoData, selfLogin: string, backlogOnly: boolean): string {
  if (data.error) {
    return `  ${theme.text.error(`Error: ${data.error}`)}`;
  }

  if (data.issues.length === 0) {
    return `  ${theme.text.muted("No open issues")}`;
  }

  const assigned = backlogOnly ? [] : data.issues.filter((i) => (i.assignees ?? []).length > 0);
  const backlog = data.issues.filter((i) => (i.assignees ?? []).length === 0);

  const lines: string[] = [];
  const maxTitle = 45;

  if (assigned.length > 0) {
    lines.push(`  ${theme.text.secondary("In Progress")}`);
    for (const issue of assigned) {
      lines.push(formatIssueLine(issue, selfLogin, maxTitle));
    }
  }

  if (backlog.length > 0) {
    if (assigned.length > 0) lines.push("");
    lines.push(`  ${theme.text.secondary("Backlog (unassigned)")}`);
    for (const issue of backlog) {
      lines.push(formatIssueLine(issue, selfLogin, maxTitle));
    }
  }

  return lines.join("\n");
}

export function renderStaticBoard(
  data: DashboardData,
  selfLogin: string,
  backlogOnly: boolean,
): void {
  const now = data.fetchedAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = data.fetchedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  console.log(`\n${theme.text.accent("HOG BOARD")} ${theme.text.muted(`\u2014 ${date} ${now}`)}`);

  // GitHub repos
  for (const rd of data.repos) {
    const issueCount = rd.issues.length;
    const label = `${rd.repo.shortName} ${theme.text.muted(`(${issueCount} issues)`)}`;
    printSection(label, renderRepoSection(rd, selfLogin, backlogOnly));
  }

  console.log("");
}

export function renderBoardJson(data: DashboardData, selfLogin: string): Record<string, unknown> {
  return {
    ok: true,
    data: {
      repos: data.repos.map((rd) => ({
        name: rd.repo.name,
        shortName: rd.repo.shortName,
        error: rd.error,
        issues: rd.issues.map((i) => ({
          number: i.number,
          title: i.title,
          url: i.url,
          state: i.state,
          assignee: (i.assignees ?? [])[0]?.login ?? null,
          assignees: (i.assignees ?? []).map((a) => a.login),
          labels: i.labels.map((l) => l.name),
          updatedAt: i.updatedAt,
          isMine: (i.assignees ?? []).some((a) => a.login === selfLogin),
          slackThreadUrl: i.slackThreadUrl ?? null,
          projectStatus: i.projectStatus ?? null,
          targetDate: i.targetDate ?? null,
        })),
      })),
      activity: data.activity,
      fetchedAt: data.fetchedAt.toISOString(),
    },
  };
}
