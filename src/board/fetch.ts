import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { HogConfig, RepoConfig } from "../config.js";
import type { GitHubIssue, StatusOption } from "../github.js";
import {
  fetchProjectEnrichmentAsync,
  fetchProjectStatusOptionsAsync,
  fetchRepoIssuesAsync,
} from "../github.js";
import { formatError } from "../utils.js";

const execFileAsync = promisify(execFile);

export interface RepoData {
  repo: RepoConfig;
  issues: GitHubIssue[];
  statusOptions: StatusOption[];
  error: string | null;
}

export interface ActivityEvent {
  type:
    | "comment"
    | "status"
    | "assignment"
    | "opened"
    | "closed"
    | "labeled"
    | "branch_created"
    | "pr_opened"
    | "pr_merged"
    | "pr_closed";
  repoShortName: string;
  issueNumber: number;
  actor: string;
  summary: string;
  timestamp: Date;
  /** For branch_created events: the full branch name */
  branchName?: string | undefined;
  /** For pr_* events: the PR number (distinct from linked issueNumber) */
  prNumber?: number | undefined;
}

export interface DashboardData {
  repos: RepoData[];
  activity: ActivityEvent[];
  fetchedAt: Date;
}

export interface FetchOptions {
  repoFilter?: string | undefined;
  mineOnly?: boolean | undefined;
  backlogOnly?: boolean | undefined;
}

export const SLACK_URL_RE = /https:\/\/[^/]+\.slack\.com\/archives\/[A-Z0-9]+\/p[0-9]+/i;

export function extractSlackUrl(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const match = body.match(SLACK_URL_RE);
  return match?.[0];
}

/** Extract issue numbers from a branch name (e.g. "feat/42-add-auth" → [42]) */
export function extractIssueNumbersFromBranch(branchName: string): number[] {
  // Find numbers that look like issue numbers (1-5 digits, word boundary)
  const matches = branchName.match(/\b(\d{1,5})\b/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => parseInt(m, 10)).filter((n) => n > 0))];
}

/** Extract issue numbers linked in PR title/body (e.g. "Fixes #42" → [42]) */
export function extractLinkedIssueNumbers(title: string | null, body: string | null): number[] {
  const text = `${title ?? ""} ${body ?? ""}`;
  const matches = text.match(/#(\d{1,5})\b/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => parseInt(m.slice(1), 10)).filter((n) => n > 0))];
}

/** Parse raw gh CLI activity output into ActivityEvent[]. Shared by sync and async fetchers. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parses multiple GitHub event types
function parseActivityOutput(output: string, shortName: string): ActivityEvent[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const events: ActivityEvent[] = [];

  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as {
        type: string;
        actor: string;
        action: string;
        number: number | null;
        title: string | null;
        body: string | null;
        created_at: string;
        ref: string | null;
        ref_type: string | null;
        merged: boolean | null;
      };

      const timestamp = new Date(ev.created_at);
      if (timestamp.getTime() < cutoff) continue;

      if (ev.type === "CreateEvent") {
        if (ev.ref_type !== "branch" || !ev.ref) continue;
        const issueNumbers = extractIssueNumbersFromBranch(ev.ref);
        for (const num of issueNumbers) {
          events.push({
            type: "branch_created",
            repoShortName: shortName,
            issueNumber: num,
            actor: ev.actor,
            summary: `created branch ${ev.ref}`,
            timestamp,
            branchName: ev.ref,
          });
        }
        continue;
      }

      if (!ev.number) continue;

      let eventType: ActivityEvent["type"];
      let summary: string;
      let extras: Partial<Pick<ActivityEvent, "prNumber">> = {};

      if (ev.type === "IssueCommentEvent") {
        eventType = "comment";
        const preview = ev.body ? ev.body.slice(0, 60).replace(/\n/g, " ") : "";
        summary = `commented on #${ev.number}${preview ? ` — "${preview}${(ev.body?.length ?? 0) > 60 ? "..." : ""}"` : ""}`;
      } else if (ev.type === "IssuesEvent") {
        switch (ev.action) {
          case "opened":
            eventType = "opened";
            summary = `opened #${ev.number}: ${ev.title ?? ""}`;
            break;
          case "closed":
            eventType = "closed";
            summary = `closed #${ev.number}`;
            break;
          case "assigned":
            eventType = "assignment";
            summary = `assigned #${ev.number}`;
            break;
          case "labeled":
            eventType = "labeled";
            summary = `labeled #${ev.number}`;
            break;
          default:
            continue;
        }
      } else if (ev.type === "PullRequestEvent") {
        const prNumber = ev.number;
        extras = { prNumber };
        if (ev.action === "opened") {
          eventType = "pr_opened";
          summary = `opened PR #${prNumber}: ${ev.title ?? ""}`;
        } else if (ev.action === "closed" && ev.merged) {
          eventType = "pr_merged";
          summary = `merged PR #${prNumber}: ${ev.title ?? ""}`;
        } else if (ev.action === "closed") {
          eventType = "pr_closed";
          summary = `closed PR #${prNumber}`;
        } else {
          continue;
        }

        const linkedIssues = extractLinkedIssueNumbers(ev.title, ev.body);
        for (const issueNum of linkedIssues) {
          events.push({
            type: eventType,
            repoShortName: shortName,
            issueNumber: issueNum,
            actor: ev.actor,
            summary,
            timestamp,
            prNumber,
          });
        }
        if (linkedIssues.length === 0) {
          events.push({
            type: eventType,
            repoShortName: shortName,
            issueNumber: prNumber,
            actor: ev.actor,
            summary,
            timestamp,
            prNumber,
          });
        }
        continue;
      } else {
        continue;
      }

      events.push({
        type: eventType,
        repoShortName: shortName,
        issueNumber: ev.number,
        actor: ev.actor,
        summary,
        timestamp,
        ...extras,
      });
    } catch {
      // Skip malformed event JSON
    }
  }

  return events.slice(0, 15);
}

/** Fetch recent activity events for a repo (last 24h, max 30 events) */
export function fetchRecentActivity(repoName: string, shortName: string): ActivityEvent[] {
  try {
    const output = execFileSync(
      "gh",
      [
        "api",
        `repos/${repoName}/events`,
        "-f",
        "per_page=30",
        "-q",
        '.[] | select(.type == "IssuesEvent" or .type == "IssueCommentEvent" or .type == "PullRequestEvent" or .type == "CreateEvent") | {type: .type, actor: .actor.login, action: .payload.action, number: (.payload.issue.number // .payload.pull_request.number), title: (.payload.issue.title // .payload.pull_request.title), body: (.payload.comment.body // .payload.pull_request.body), created_at: .created_at, ref: .payload.ref, ref_type: .payload.ref_type, merged: .payload.pull_request.merged}',
      ],
      { encoding: "utf-8", timeout: 15_000, stdio: "pipe" },
    );
    return parseActivityOutput(output, shortName);
  } catch {
    // Best-effort: activity fetch is non-critical
    return [];
  }
}

/** Fetch a single repo's data asynchronously. */
async function fetchRepoDataAsync(
  repo: RepoConfig,
  assignee?: string | undefined,
): Promise<RepoData> {
  try {
    const fetchOpts: { assignee?: string } = {};
    if (assignee) fetchOpts.assignee = assignee;
    const issues = await fetchRepoIssuesAsync(repo.name, fetchOpts);

    // Enrich issues with target dates + statuses from GitHub Projects (parallel)
    let enrichedIssues = issues;
    let statusOptions: StatusOption[] = [];
    try {
      const [enrichMap, opts] = await Promise.all([
        fetchProjectEnrichmentAsync(repo.name, repo.projectNumber),
        fetchProjectStatusOptionsAsync(repo.name, repo.projectNumber, repo.statusFieldId),
      ]);
      enrichedIssues = issues.map((issue): GitHubIssue => {
        const e = enrichMap.get(issue.number);
        const slackUrl = extractSlackUrl(issue.body ?? "");
        return {
          ...issue,
          ...(e?.targetDate !== undefined ? { targetDate: e.targetDate } : {}),
          ...(e?.projectStatus !== undefined ? { projectStatus: e.projectStatus } : {}),
          ...(e?.customFields !== undefined ? { customFields: e.customFields } : {}),
          ...(slackUrl ? { slackThreadUrl: slackUrl } : {}),
        };
      });
      statusOptions = opts;
    } catch {
      // Non-critical: silently skip if project fields fail
      enrichedIssues = issues.map((issue): GitHubIssue => {
        const slackUrl = extractSlackUrl(issue.body ?? "");
        return slackUrl ? { ...issue, slackThreadUrl: slackUrl } : issue;
      });
    }

    return { repo, issues: enrichedIssues, statusOptions, error: null };
  } catch (err) {
    return { repo, issues: [], statusOptions: [], error: formatError(err) };
  }
}

/** Fetch recent activity for a repo asynchronously. */
async function fetchRecentActivityAsync(
  repoName: string,
  shortName: string,
): Promise<ActivityEvent[]> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "api",
        `repos/${repoName}/events`,
        "-f",
        "per_page=30",
        "-q",
        '.[] | select(.type == "IssuesEvent" or .type == "IssueCommentEvent" or .type == "PullRequestEvent" or .type == "CreateEvent") | {type: .type, actor: .actor.login, action: .payload.action, number: (.payload.issue.number // .payload.pull_request.number), title: (.payload.issue.title // .payload.pull_request.title), body: (.payload.comment.body // .payload.pull_request.body), created_at: .created_at, ref: .payload.ref, ref_type: .payload.ref_type, merged: .payload.pull_request.merged}',
      ],
      { encoding: "utf-8", timeout: 15_000 },
    );
    return parseActivityOutput(stdout, shortName);
  } catch {
    // Best-effort: activity fetch is non-critical
    return [];
  }
}

export async function fetchDashboard(
  config: HogConfig,
  options: FetchOptions = {},
): Promise<DashboardData> {
  const repos = options.repoFilter
    ? config.repos.filter(
        (r) => r.shortName === options.repoFilter || r.name === options.repoFilter,
      )
    : config.repos;

  const assignee = options.mineOnly ? config.board.assignee : undefined;

  // Fetch all repos and activity in parallel
  const [repoData, ...activityResults] = await Promise.all([
    Promise.all(repos.map((repo) => fetchRepoDataAsync(repo, assignee))),
    ...repos.map((repo) => fetchRecentActivityAsync(repo.name, repo.shortName)),
  ]);

  // Merge and sort activity by timestamp descending
  const activity = activityResults
    .flat()
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return {
    repos: repoData,
    activity: activity.slice(0, 15),
    fetchedAt: new Date(),
  };
}
