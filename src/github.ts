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
  /**
   * All other GitHub Project custom field values keyed by field name.
   * Includes single-select, text, number, and iteration fields — excluding
   * Status (→ projectStatus) and date fields (→ targetDate).
   * Example: { Workstream: "Platform", Size: "M", Priority: "High" }
   */
  readonly customFields?: Record<string, string>;
}

export interface ProjectFieldValues {
  targetDate?: string;
  status?: string;
  customFields?: Record<string, string>;
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

export async function closeIssueAsync(repo: string, issueNumber: number): Promise<void> {
  await runGhAsync(["issue", "close", String(issueNumber), "--repo", repo]);
}

export async function reopenIssueAsync(repo: string, issueNumber: number): Promise<void> {
  await runGhAsync(["issue", "reopen", String(issueNumber), "--repo", repo]);
}

export async function createIssueAsync(
  repo: string,
  title: string,
  body: string,
  labels?: string[],
): Promise<string> {
  const args = ["issue", "create", "--repo", repo, "--title", title, "--body", body];
  if (labels && labels.length > 0) {
    for (const label of labels) {
      args.push("--label", label);
    }
  }
  return runGhAsync(args);
}

export async function editIssueTitleAsync(
  repo: string,
  issueNumber: number,
  title: string,
): Promise<void> {
  await runGhAsync(["issue", "edit", String(issueNumber), "--repo", repo, "--title", title]);
}

export async function editIssueBodyAsync(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await runGhAsync(["issue", "edit", String(issueNumber), "--repo", repo, "--body", body]);
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

export async function updateLabelsAsync(
  repo: string,
  issueNumber: number,
  addLabels: string[],
  removeLabels: string[],
): Promise<void> {
  const args = ["issue", "edit", String(issueNumber), "--repo", repo];
  for (const label of addLabels) args.push("--add-label", label);
  for (const label of removeLabels) args.push("--remove-label", label);
  await runGhAsync(args);
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parses multiple GitHub Project field types
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
                  ... on ProjectV2ItemFieldTextValue {
                    field { ... on ProjectV2Field { name } }
                    text
                  }
                  ... on ProjectV2ItemFieldNumberValue {
                    field { ... on ProjectV2Field { name } }
                    number
                  }
                  ... on ProjectV2ItemFieldIterationValue {
                    field { ... on ProjectV2IterationField { name } }
                    title
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
      const fieldName = fv.field?.name ?? "";
      if ("date" in fv && DATE_FIELD_NAME_RE.test(fieldName)) {
        fields.targetDate = fv.date;
      } else if ("name" in fv && fieldName === "Status") {
        fields.status = fv.name;
      } else if (fieldName) {
        const value =
          "text" in fv && fv.text != null
            ? fv.text
            : "number" in fv && fv.number != null
              ? String(fv.number)
              : "name" in fv && fv.name != null
                ? fv.name
                : "title" in fv && fv.title != null
                  ? fv.title
                  : null;
        if (value != null) {
          if (!fields.customFields) fields.customFields = {};
          fields.customFields[fieldName] = value;
        }
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
  customFields?: Record<string, string>;
}

/**
 * Fetch target dates and project statuses for all issues in a project in one GraphQL call.
 * Returns a Map from issue number to enrichment data.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parses multiple GitHub Project field types across all items
export function fetchProjectEnrichment(
  repo: string,
  projectNumber: number,
): Map<number, ProjectEnrichment> {
  const [owner] = repo.split("/");
  if (!owner) return new Map();

  const query = `
    query($owner: String!, $projectNumber: Int!, $cursor: String) {
      organization(login: $owner) {
        projectV2(number: $projectNumber) {
          items(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
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
                  ... on ProjectV2ItemFieldTextValue {
                    field { ... on ProjectV2Field { name } }
                    text
                  }
                  ... on ProjectV2ItemFieldNumberValue {
                    field { ... on ProjectV2Field { name } }
                    number
                  }
                  ... on ProjectV2ItemFieldIterationValue {
                    field { ... on ProjectV2IterationField { name } }
                    title
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
    const enrichMap = new Map<number, ProjectEnrichment>();
    let cursor: string | null = null;

    do {
      const args = [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `projectNumber=${String(projectNumber)}`,
      ];
      if (cursor) args.push("-f", `cursor=${cursor}`);
      const result = runGhJson<ProjectItemsResult>(args);
      const page = result?.data?.organization?.projectV2?.items;
      const nodes = page?.nodes ?? [];

      for (const item of nodes) {
        if (!item?.content?.number) continue;
        const enrichment: ProjectEnrichment = {};
        const fieldValues = item.fieldValues?.nodes ?? [];
        for (const fv of fieldValues) {
          if (!fv) continue;
          const fieldName = fv.field?.name ?? "";
          if ("date" in fv && fv.date && DATE_FIELD_NAME_RE.test(fieldName)) {
            enrichment.targetDate = fv.date;
          } else if ("name" in fv && fieldName === "Status" && fv.name) {
            enrichment.projectStatus = fv.name;
          } else if (fieldName) {
            const value =
              "text" in fv && fv.text != null
                ? fv.text
                : "number" in fv && fv.number != null
                  ? String(fv.number)
                  : "name" in fv && fv.name != null
                    ? fv.name
                    : "title" in fv && fv.title != null
                      ? fv.title
                      : null;
            if (value != null) {
              if (!enrichment.customFields) enrichment.customFields = {};
              enrichment.customFields[fieldName] = value;
            }
          }
        }
        enrichMap.set(item.content.number, enrichment);
      }

      if (!page?.pageInfo?.hasNextPage) break;
      cursor = page.pageInfo.endCursor ?? null;
    } while (cursor);

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
    query($owner: String!, $projectNumber: Int!) {
      organization(login: $owner) {
        projectV2(number: $projectNumber) {
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
    "-F",
    `projectNumber=${String(projectNumber)}`,
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
    query($owner: String!, $projectNumber: Int!) {
      organization(login: $owner) {
        projectV2(number: $projectNumber) {
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
    "-F",
    `projectNumber=${String(projectNumber)}`,
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
  text?: string;
  number?: number;
  title?: string; // iteration field title
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
          pageInfo?: { hasNextPage: boolean; endCursor?: string };
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
