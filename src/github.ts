import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly labels: { name: string }[];
  readonly assignees?: { login: string }[];
  readonly targetDate?: string;
  readonly body?: string;
  readonly projectStatus?: string;
  readonly slackThreadUrl?: string;
}

export interface ProjectFieldValues {
  targetDate?: string;
  status?: string;
}

export interface RepoProjectConfig {
  projectNumber: number;
  statusFieldId: string;
  optionId: string;
}

/** Matches common date field names used in GitHub Projects v2 (case-insensitive). */
const DATE_FIELD_NAME_RE = /^(target\s*date|due\s*date|due|deadline)$/i;

function runGh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf-8", timeout: 30_000 }).trim();
}

function runGhJson<T>(args: string[]): T {
  const output = runGh(args);
  return JSON.parse(output) as T;
}

async function runGhAsync(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, { encoding: "utf-8", timeout: 30_000 });
  return stdout.trim();
}

async function runGhJsonAsync<T>(args: string[]): Promise<T> {
  const output = await runGhAsync(args);
  return JSON.parse(output) as T;
}

export function fetchAssignedIssues(repo: string, assignee: string): GitHubIssue[] {
  return runGhJson<GitHubIssue[]>([
    "issue",
    "list",
    "--repo",
    repo,
    "--assignee",
    assignee,
    "--state",
    "open",
    "--json",
    "number,title,url,state,updatedAt,labels",
    "--limit",
    "100",
  ]);
}

export interface FetchIssuesOptions {
  assignee?: string | undefined;
  state?: "open" | "closed" | "all" | undefined;
  limit?: number | undefined;
}

export function fetchRepoIssues(repo: string, options: FetchIssuesOptions = {}): GitHubIssue[] {
  const { state = "open", limit = 100 } = options;
  const args = [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    state,
    "--json",
    "number,title,url,state,updatedAt,labels,assignees,body",
    "--limit",
    String(limit),
  ];
  if (options.assignee) {
    args.push("--assignee", options.assignee);
  }
  return runGhJson<GitHubIssue[]>(args);
}

export function assignIssue(repo: string, issueNumber: number): void {
  runGh(["issue", "edit", String(issueNumber), "--repo", repo, "--add-assignee", "@me"]);
}

export async function assignIssueAsync(repo: string, issueNumber: number): Promise<void> {
  await runGhAsync(["issue", "edit", String(issueNumber), "--repo", repo, "--add-assignee", "@me"]);
}

export async function assignIssueToAsync(
  repo: string,
  issueNumber: number,
  user: string,
): Promise<void> {
  await runGhAsync(["issue", "edit", String(issueNumber), "--repo", repo, "--add-assignee", user]);
}

export async function unassignIssueAsync(
  repo: string,
  issueNumber: number,
  user: string,
): Promise<void> {
  await runGhAsync([
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repo,
    "--remove-assignee",
    user,
  ]);
}

export async function fetchIssueAsync(repo: string, issueNumber: number): Promise<GitHubIssue> {
  return runGhJsonAsync<GitHubIssue>([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "number,title,url,state,updatedAt,labels,assignees,body,projectStatus",
  ]);
}

export async function addCommentAsync(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await runGhAsync(["issue", "comment", String(issueNumber), "--repo", repo, "--body", body]);
}

export async function addLabelAsync(
  repo: string,
  issueNumber: number,
  label: string,
): Promise<void> {
  await runGhAsync(["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", label]);
}

export async function removeLabelAsync(
  repo: string,
  issueNumber: number,
  label: string,
): Promise<void> {
  await runGhAsync(["issue", "edit", String(issueNumber), "--repo", repo, "--remove-label", label]);
}

export interface IssueComment {
  readonly body: string;
  readonly author: { readonly login: string };
  readonly createdAt: string;
}

export async function fetchIssueCommentsAsync(
  repo: string,
  issueNumber: number,
): Promise<IssueComment[]> {
  const result = await runGhJsonAsync<{ comments: IssueComment[] }>([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "comments",
  ]);
  return result.comments ?? [];
}

export function fetchProjectFields(
  repo: string,
  issueNumber: number,
  projectNumber: number,
): ProjectFieldValues {
  // GraphQL query to get project item fields for this issue
  const query = `
    query($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          projectItems(first: 10) {
            nodes {
              project { number }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldDateValue {
                    field { ... on ProjectV2Field { name } }
                    date
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field { ... on ProjectV2SingleSelectField { name } }
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const [owner, repoName] = repo.split("/");
  if (!(owner && repoName)) return {};

  try {
    const result = runGhJson<GraphQLResult>([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repoName}`,
      "-F",
      `issueNumber=${String(issueNumber)}`,
    ]);

    const items = result?.data?.repository?.issue?.projectItems?.nodes ?? [];
    const projectItem = items.find((item) => item?.project?.number === projectNumber);

    if (!projectItem) return {};

    const fields: ProjectFieldValues = {};
    const fieldValues = projectItem.fieldValues?.nodes ?? [];

    for (const fv of fieldValues) {
      if (!fv) continue;
      if ("date" in fv && DATE_FIELD_NAME_RE.test(fv.field?.name ?? "")) {
        fields.targetDate = fv.date;
      }
      if ("name" in fv && fv.field?.name === "Status") {
        fields.status = fv.name;
      }
    }

    return fields;
  } catch {
    return {};
  }
}

export interface ProjectEnrichment {
  targetDate?: string;
  projectStatus?: string;
}

/**
 * Fetch target dates and project statuses for all issues in a project in one GraphQL call.
 * Returns a Map from issue number to enrichment data.
 */
export function fetchProjectEnrichment(
  repo: string,
  projectNumber: number,
): Map<number, ProjectEnrichment> {
  const [owner] = repo.split("/");
  if (!owner) return new Map();

  const query = `
    query($owner: String!, $projectNumber: Int!) {
      organization(login: $owner) {
        projectV2(number: $projectNumber) {
          items(first: 100) {
            nodes {
              content {
                ... on Issue {
                  number
                }
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldDateValue {
                    field { ... on ProjectV2Field { name } }
                    date
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field { ... on ProjectV2SingleSelectField { name } }
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const result = runGhJson<ProjectItemsResult>([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `projectNumber=${String(projectNumber)}`,
    ]);

    const items = result?.data?.organization?.projectV2?.items?.nodes ?? [];
    const enrichMap = new Map<number, ProjectEnrichment>();

    for (const item of items) {
      if (!item?.content?.number) continue;
      const enrichment: ProjectEnrichment = {};
      const fieldValues = item.fieldValues?.nodes ?? [];
      for (const fv of fieldValues) {
        if (!fv) continue;
        if ("date" in fv && fv.date && DATE_FIELD_NAME_RE.test(fv.field?.name ?? "")) {
          enrichment.targetDate = fv.date;
        }
        if ("name" in fv && fv.field?.name === "Status" && fv.name) {
          enrichment.projectStatus = fv.name;
        }
      }
      enrichMap.set(item.content.number, enrichment);
    }

    return enrichMap;
  } catch {
    return new Map();
  }
}

/** Backwards-compatible wrapper for fetchProjectEnrichment. */
export function fetchProjectTargetDates(repo: string, projectNumber: number): Map<number, string> {
  const enrichMap = fetchProjectEnrichment(repo, projectNumber);
  const dateMap = new Map<number, string>();
  for (const [num, e] of enrichMap) {
    if (e.targetDate) dateMap.set(num, e.targetDate);
  }
  return dateMap;
}

export interface StatusOption {
  id: string;
  name: string;
}

/**
 * Fetch available project status options (the SingleSelectField values).
 * Returns options in the order defined on the project board.
 */
export function fetchProjectStatusOptions(
  repo: string,
  projectNumber: number,
  _statusFieldId: string,
): StatusOption[] {
  const [owner] = repo.split("/");
  if (!owner) return [];

  const query = `
    query($owner: String!, $projectNumber: Int!) {
      organization(login: $owner) {
        projectV2(number: $projectNumber) {
          field(name: "Status") {
            ... on ProjectV2SingleSelectField {
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  `;

  try {
    const result = runGhJson<ProjectStatusResult>([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `projectNumber=${String(projectNumber)}`,
    ]);

    return result?.data?.organization?.projectV2?.field?.options ?? [];
  } catch {
    return [];
  }
}

export function addLabel(repo: string, issueNumber: number, label: string): void {
  runGh(["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", label]);
}

export interface LabelOption {
  name: string;
  color: string;
}

/**
 * Fetch all labels defined in the repo asynchronously.
 * Uses execFileAsync (not execFileSync) to avoid blocking the React render thread.
 */
export async function fetchRepoLabelsAsync(repo: string): Promise<LabelOption[]> {
  try {
    const result = await runGhJsonAsync<LabelOption[]>([
      "label",
      "list",
      "--repo",
      repo,
      "--json",
      "name,color",
    ]);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/** Cache for GitHub Projects node IDs — these are immutable per project number. */
const projectNodeIdCache = new Map<string, string>();

/** Clears the project node ID cache. Intended for use in tests only. */
export function clearProjectNodeIdCache(): void {
  projectNodeIdCache.clear();
}

async function getProjectNodeId(owner: string, projectNumber: number): Promise<string | null> {
  const key = `${owner}/${String(projectNumber)}`;
  const cached = projectNodeIdCache.get(key);
  if (cached !== undefined) return cached;

  const projectQuery = `
    query($owner: String!) {
      organization(login: $owner) {
        projectV2(number: ${projectNumber}) {
          id
        }
      }
    }
  `;

  const projectResult = await runGhJsonAsync<GraphQLProjectResult>([
    "api",
    "graphql",
    "-f",
    `query=${projectQuery}`,
    "-F",
    `owner=${owner}`,
  ]);

  const projectId = projectResult?.data?.organization?.projectV2?.id;
  if (!projectId) return null;
  projectNodeIdCache.set(key, projectId);
  return projectId;
}

export function updateProjectItemStatus(
  repo: string,
  issueNumber: number,
  projectConfig: RepoProjectConfig,
): void {
  const [owner, repoName] = repo.split("/");
  if (!(owner && repoName)) return;

  // First get the project item ID
  const findItemQuery = `
    query($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          projectItems(first: 10) {
            nodes {
              id
              project { number }
            }
          }
        }
      }
    }
  `;

  const findResult = runGhJson<GraphQLResult>([
    "api",
    "graphql",
    "-f",
    `query=${findItemQuery}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repoName}`,
    "-F",
    `issueNumber=${String(issueNumber)}`,
  ]);

  const items = findResult?.data?.repository?.issue?.projectItems?.nodes ?? [];
  const projectNumber = projectConfig.projectNumber;
  const projectItem = items.find((item) => item?.project?.number === projectNumber);

  if (!projectItem?.id) return;

  // Get the project ID
  const projectQuery = `
    query($owner: String!) {
      organization(login: $owner) {
        projectV2(number: ${projectNumber}) {
          id
        }
      }
    }
  `;

  const projectResult = runGhJson<GraphQLProjectResult>([
    "api",
    "graphql",
    "-f",
    `query=${projectQuery}`,
    "-F",
    `owner=${owner}`,
  ]);

  const projectId = projectResult?.data?.organization?.projectV2?.id;
  if (!projectId) return;

  const statusFieldId = projectConfig.statusFieldId;
  const optionId = projectConfig.optionId;

  // Mutation to update the status
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }
      ) {
        projectV2Item { id }
      }
    }
  `;

  runGh([
    "api",
    "graphql",
    "-f",
    `query=${mutation}`,
    "-F",
    `projectId=${projectId}`,
    "-F",
    `itemId=${projectItem.id}`,
    "-F",
    `fieldId=${statusFieldId}`,
    "-F",
    `optionId=${optionId}`,
  ]);
}

export async function updateProjectItemStatusAsync(
  repo: string,
  issueNumber: number,
  projectConfig: RepoProjectConfig,
): Promise<void> {
  const [owner, repoName] = repo.split("/");
  if (!(owner && repoName)) return;

  const findItemQuery = `
    query($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          projectItems(first: 10) {
            nodes {
              id
              project { number }
            }
          }
        }
      }
    }
  `;

  const findResult = await runGhJsonAsync<GraphQLResult>([
    "api",
    "graphql",
    "-f",
    `query=${findItemQuery}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repoName}`,
    "-F",
    `issueNumber=${String(issueNumber)}`,
  ]);

  const items = findResult?.data?.repository?.issue?.projectItems?.nodes ?? [];
  const projectNumber = projectConfig.projectNumber;
  const projectItem = items.find((item) => item?.project?.number === projectNumber);

  if (!projectItem?.id) return;

  const projectId = await getProjectNodeId(owner, projectNumber);
  if (!projectId) return;

  const statusFieldId = projectConfig.statusFieldId;
  const optionId = projectConfig.optionId;

  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }
      ) {
        projectV2Item { id }
      }
    }
  `;

  await runGhAsync([
    "api",
    "graphql",
    "-f",
    `query=${mutation}`,
    "-F",
    `projectId=${projectId}`,
    "-F",
    `itemId=${projectItem.id}`,
    "-F",
    `fieldId=${statusFieldId}`,
    "-F",
    `optionId=${optionId}`,
  ]);
}

export interface RepoDueDateConfig {
  projectNumber: number;
  dueDateFieldId: string;
}

/**
 * Set a date field value on a GitHub Projects v2 item for the given issue.
 * Uses the same 3-step pattern as updateProjectItemStatusAsync.
 */
export async function updateProjectItemDateAsync(
  repo: string,
  issueNumber: number,
  projectConfig: RepoDueDateConfig,
  dueDate: string,
): Promise<void> {
  const [owner, repoName] = repo.split("/");
  if (!(owner && repoName)) return;

  const findItemQuery = `
    query($owner: String!, $repo: String!, $issueNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issueNumber) {
          projectItems(first: 10) {
            nodes {
              id
              project { number }
            }
          }
        }
      }
    }
  `;

  const findResult = await runGhJsonAsync<GraphQLResult>([
    "api",
    "graphql",
    "-f",
    `query=${findItemQuery}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repoName}`,
    "-F",
    `issueNumber=${String(issueNumber)}`,
  ]);

  const items = findResult?.data?.repository?.issue?.projectItems?.nodes ?? [];
  const projectItem = items.find((item) => item?.project?.number === projectConfig.projectNumber);

  if (!projectItem?.id) return;

  const projectId = await getProjectNodeId(owner, projectConfig.projectNumber);
  if (!projectId) return;

  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { date: $date }
        }
      ) {
        projectV2Item { id }
      }
    }
  `;

  await runGhAsync([
    "api",
    "graphql",
    "-f",
    `query=${mutation}`,
    "-F",
    `projectId=${projectId}`,
    "-F",
    `itemId=${projectItem.id}`,
    "-F",
    `fieldId=${projectConfig.dueDateFieldId}`,
    "-F",
    `date=${dueDate}`,
  ]);
}

// Internal GraphQL response types

interface FieldValue {
  field?: { name?: string };
  date?: string;
  name?: string;
}

interface ProjectItem {
  id?: string;
  project?: { number?: number };
  fieldValues?: { nodes?: (FieldValue | null)[] };
}

interface GraphQLResult {
  data?: {
    repository?: {
      issue?: {
        projectItems?: {
          nodes?: (ProjectItem | null)[];
        };
      };
    };
  };
}

interface GraphQLProjectResult {
  data?: {
    organization?: {
      projectV2?: {
        id?: string;
      };
    };
  };
}

interface ProjectItemNode {
  content?: { number?: number };
  fieldValues?: { nodes?: (FieldValue | null)[] };
}

interface ProjectItemsResult {
  data?: {
    organization?: {
      projectV2?: {
        items?: {
          nodes?: (ProjectItemNode | null)[];
        };
      };
    };
  };
}

interface ProjectStatusResult {
  data?: {
    organization?: {
      projectV2?: {
        field?: {
          options?: StatusOption[];
        };
      };
    };
  };
}
