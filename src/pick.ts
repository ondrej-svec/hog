import { TickTickClient } from "./api.js";
import type { HogConfig, RepoConfig } from "./config.js";
import { findRepo, requireAuth } from "./config.js";
import type { GitHubIssue } from "./github.js";
import { assignIssue, fetchProjectFields, fetchRepoIssues } from "./github.js";
import { findMapping, loadSyncState, saveSyncState, upsertMapping } from "./sync-state.js";
import type { BoardIssue, PickResult, Task } from "./types.js";
import { Priority } from "./types.js";

const ISSUE_REF_PATTERN = /^([a-zA-Z0-9_.-]+)\/(\d+)$/;

export interface ParsedIssueRef {
  repo: RepoConfig;
  issueNumber: number;
}

export function parseIssueRef(input: string, config: HogConfig): ParsedIssueRef {
  const match = input.match(ISSUE_REF_PATTERN);
  if (!(match?.[1] && match[2])) {
    throw new Error("Invalid format. Use: shortName/number (e.g., myrepo/145)");
  }

  const repoShortName = match[1];
  const repo = findRepo(config, repoShortName);
  if (!repo) {
    throw new Error(`Unknown repo "${repoShortName}". Run: hog config repos`);
  }

  const num = Number.parseInt(match[2], 10);
  if (num < 1 || num > 999999) {
    throw new Error("Invalid issue number");
  }

  return { repo, issueNumber: num };
}

function appendWarning(existing: string | undefined, addition: string): string {
  return existing ? `${existing}. ${addition}` : addition;
}

function mapPriority(labels: readonly string[]): Priority {
  for (const label of labels) {
    if (label === "priority:critical" || label === "priority:high") return Priority.High;
    if (label === "priority:medium") return Priority.Medium;
    if (label === "priority:low") return Priority.Low;
  }
  return Priority.None;
}

function toBoardIssue(issue: GitHubIssue, repoName: string): BoardIssue {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    assignee: issue.assignees?.[0]?.login ?? null,
    labels: issue.labels.map((l) => l.name),
    updatedAt: issue.updatedAt,
    repo: repoName,
  };
}

async function syncToTickTick(
  repo: RepoConfig,
  issue: GitHubIssue,
  boardIssue: BoardIssue,
): Promise<{ task?: Task; warning?: string }> {
  const state = loadSyncState();
  const existing = findMapping(state, repo.name, issue.number);

  if (existing) {
    return { warning: "TickTick task already exists from sync." };
  }

  const auth = requireAuth();
  const api = new TickTickClient(auth.accessToken);
  const projectFields = fetchProjectFields(repo.name, issue.number, repo.projectNumber);

  const input = {
    title: issue.title,
    content: `GitHub: ${issue.url}`,
    priority: mapPriority(boardIssue.labels),
    tags: ["github", repo.shortName],
    ...(projectFields.targetDate ? { dueDate: projectFields.targetDate, isAllDay: true } : {}),
  };

  const task = await api.createTask(input);

  upsertMapping(state, {
    githubRepo: repo.name,
    githubIssueNumber: issue.number,
    githubUrl: issue.url,
    ticktickTaskId: task.id,
    ticktickProjectId: task.projectId,
    githubUpdatedAt: issue.updatedAt,
    lastSyncedAt: new Date().toISOString(),
  });
  saveSyncState(state);

  return { task };
}

export async function pickIssue(config: HogConfig, ref: ParsedIssueRef): Promise<PickResult> {
  const { repo, issueNumber } = ref;

  // 1. Fetch open issues and find the target
  const allIssues = fetchRepoIssues(repo.name, { state: "open", limit: 200 });
  const issue = allIssues.find((i) => i.number === issueNumber);

  if (!issue) {
    throw new Error(`Issue #${issueNumber} not found in ${repo.name}. Is it open?`);
  }

  const boardIssue = toBoardIssue(issue, repo.name);
  let warning: string | undefined;

  // 2. Check if already assigned
  if (boardIssue.assignee === config.board.assignee) {
    warning = "Issue is already assigned to you";
  } else if (boardIssue.assignee) {
    warning = `Issue is currently assigned to ${boardIssue.assignee}. Reassigning to you.`;
  }

  // 3. Assign on GitHub
  assignIssue(repo.name, issueNumber);

  // 4. Try to create TickTick task (non-critical — log warning on failure)
  let ticktickTask: Task | undefined;
  try {
    const result = await syncToTickTick(repo, issue, boardIssue);
    ticktickTask = result.task;
    if (result.warning) {
      warning = appendWarning(warning, result.warning);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warning = appendWarning(warning, `TickTick sync failed: ${msg}. Run 'hog sync run' to retry.`);
  }

  return {
    success: true,
    issue: boardIssue,
    ...(ticktickTask ? { ticktickTask } : {}),
    ...(warning ? { warning } : {}),
  } satisfies PickResult;
}
