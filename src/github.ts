import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt: string;
  labels: { name: string }[];
  assignees?: { login: string }[];
  targetDate?: string;
  body?: string;
  projectStatus?: string;
  slackThreadUrl?: string;
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
      if ("date" in fv && fv.field?.name === "Target date") {
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
        if ("date" in fv && fv.field?.name === "Target date" && fv.date) {
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
  statusFieldId: string,
): StatusOption[] {
  const [owner] = repo.split("/");

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

export function updateProjectItemStatus(
  repo: string,
  issueNumber: number,
  projectConfig: RepoProjectConfig,
): void {
  const [owner, repoName] = repo.split("/");

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
