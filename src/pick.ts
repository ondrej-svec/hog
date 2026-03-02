import type { HogConfig, RepoConfig } from "./config.js";
import { findRepo } from "./config.js";
import type { GitHubIssue } from "./github.js";
import { assignIssue, fetchRepoIssues } from "./github.js";
import type { BoardIssue, PickResult } from "./types.js";

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

  return {
    success: true,
    issue: boardIssue,
    ...(warning ? { warning } : {}),
  } satisfies PickResult;
}
