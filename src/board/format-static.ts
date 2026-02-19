import type { GitHubIssue } from "../github.js";
import type { Task } from "../types.js";
import { Priority } from "../types.js";
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

function formatTaskLine(task: Task, maxTitle: number): string {
  const pri =
    task.priority === Priority.High
      ? theme.priority.high("[!]")
      : task.priority === Priority.Medium
        ? theme.priority.medium("[~]")
        : "   ";
  const title = truncate(task.title, maxTitle);
  const due = task.dueDate ? formatDueDate(task.dueDate) : "";
  return `  ${pri} ${title.padEnd(maxTitle)} ${theme.text.secondary(due)}`;
}

function formatDueDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);

  if (days < 0) return theme.text.error(`${Math.abs(days)}d overdue`);
  if (days === 0) return theme.text.warning("today");
  if (days === 1) return "tomorrow";
  if (days <= 7) return `in ${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function renderTickTickSection(tasks: Task[], error: string | null): string {
  if (error) {
    return `  ${theme.text.error(`Error: ${error}`)}`;
  }

  if (tasks.length === 0) {
    return `  ${theme.text.muted("No active tasks")}`;
  }

  const maxTitle = 45;
  const sorted = [...tasks].sort((a, b) => {
    // Overdue first, then by due date, then by priority
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return b.priority - a.priority;
  });

  return sorted.map((t) => formatTaskLine(t, maxTitle)).join("\n");
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

  // TickTick
  if (!backlogOnly) {
    const taskCount = data.ticktick.length;
    const dueToday = data.ticktick.filter((t) => {
      if (!t.dueDate) return false;
      const days = Math.ceil((new Date(t.dueDate).getTime() - Date.now()) / 86_400_000);
      return days <= 0;
    }).length;
    const label =
      dueToday > 0
        ? `Personal (TickTick) ${theme.text.warning(`${dueToday} due today`)} / ${taskCount} total`
        : `Personal (TickTick) ${theme.text.muted(`${taskCount} tasks`)}`;
    printSection(label, renderTickTickSection(data.ticktick, data.ticktickError));
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
        })),
      })),
      ticktick: {
        error: data.ticktickError,
        tasks: data.ticktick.map((t) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          dueDate: t.dueDate,
          tags: t.tags,
        })),
      },
      fetchedAt: data.fetchedAt.toISOString(),
    },
  };
}
