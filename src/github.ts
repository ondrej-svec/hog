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
  return execFileSync("gh", args, { encoding: "utf-8", timeout: 30_000, stdio: "pipe" }).trim();
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

/**
 * Run a GraphQL query via `gh api graphql`. Handles partial errors: when the
 * query returns data for one alias but NOT_FOUND for another (e.g. org vs user
 * owner), `gh` exits with code 1 but still emits valid JSON on stdout. This
 * helper recovers that JSON from the error object instead of throwing.
 */
function runGhGraphQL<T>(args: string[]): T {
  try {
    return runGhJson<T>(args);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stdout" in err) {
      const stdout = (err as { stdout: string | Buffer }).stdout;
      const output = typeof stdout === "string" ? stdout : stdout?.toString("utf-8");
      if (output) {
        try {
          return JSON.parse(output.trim()) as T;
        } catch {
          // stdout wasn't valid JSON — rethrow original
        }
      }
    }
    throw err;
  }
}

async function runGhGraphQLAsync<T>(args: string[]): Promise<T> {
  try {
    return await runGhJsonAsync<T>(args);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stdout" in err) {
      const stdout = (err as { stdout: string | Buffer }).stdout;
      const output = typeof stdout === "string" ? stdout : stdout?.toString("utf-8");
      if (output) {
        try {
          return JSON.parse(output.trim()) as T;
        } catch {
          // stdout wasn't valid JSON — rethrow original
        }
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal GraphQL response types (hoisted for use by shared helpers)
// ---------------------------------------------------------------------------

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

interface ProjectV2IdNode {
  projectV2?: {
    id?: string;
  };
}

interface GraphQLProjectResult {
  data?: {
    organization?: ProjectV2IdNode;
    user?: ProjectV2IdNode;
  };
}

interface ProjectItemNode {
  content?: { number?: number; repository?: { nameWithOwner?: string } };
  fieldValues?: { nodes?: (FieldValue | null)[] };
}

interface ProjectV2ItemsNode {
  projectV2?: {
    items?: {
      pageInfo?: { hasNextPage: boolean; endCursor?: string };
      nodes?: (ProjectItemNode | null)[];
    };
  };
}

interface ProjectItemsResult {
  data?: {
    organization?: ProjectV2ItemsNode;
    user?: ProjectV2ItemsNode;
  };
}

// ---------------------------------------------------------------------------
// Shared GraphQL queries & helpers
// ---------------------------------------------------------------------------

/** GraphQL query to find a project item by issue number. */
const FIND_PROJECT_ITEM_QUERY = `
  query($owner: String!, $repo: String!, $issueNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $issueNumber) {
        projectItems(first: 10) {
          nodes {
            id
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

/** Build the `gh api graphql` args for {@link FIND_PROJECT_ITEM_QUERY}. */
function findProjectItemArgs(owner: string, repoName: string, issueNumber: number): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${FIND_PROJECT_ITEM_QUERY}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repoName}`,
    "-F",
    `issueNumber=${String(issueNumber)}`,
  ];
}

/** Find a project item synchronously. Returns the matching node or `null`. */
function findProjectItemSync(
  owner: string,
  repoName: string,
  issueNumber: number,
  projectNumber: number,
): ProjectItem | null {
  const result = runGhJson<GraphQLResult>(findProjectItemArgs(owner, repoName, issueNumber));
  const items = result?.data?.repository?.issue?.projectItems?.nodes ?? [];
  return items.find((item) => item?.project?.number === projectNumber) ?? null;
}

/** Find a project item asynchronously. Returns the matching node or `null`. */
async function findProjectItemAsync(
  owner: string,
  repoName: string,
  issueNumber: number,
  projectNumber: number,
): Promise<ProjectItem | null> {
  const result = await runGhJsonAsync<GraphQLResult>(
    findProjectItemArgs(owner, repoName, issueNumber),
  );
  const items = result?.data?.repository?.issue?.projectItems?.nodes ?? [];
  return items.find((item) => item?.project?.number === projectNumber) ?? null;
}

/**
 * Parse field value nodes from a GitHub Projects v2 item into structured data.
 *
 * The `statusKey` parameter controls which key receives the Status value
 * (`"status"` for {@link ProjectFieldValues}, `"projectStatus"` for
 * {@link ProjectEnrichment}).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parses multiple GitHub Project field types
function parseFieldValues(
  fieldValues: (FieldValue | null)[],
  statusKey: "status" | "projectStatus",
): ProjectFieldValues & ProjectEnrichment {
  const result: ProjectFieldValues & ProjectEnrichment = {};
  for (const fv of fieldValues) {
    if (!fv) continue;
    const fieldName = fv.field?.name ?? "";
    if ("date" in fv && fv.date && DATE_FIELD_NAME_RE.test(fieldName)) {
      result.targetDate = fv.date;
    } else if ("name" in fv && fieldName === "Status" && fv.name) {
      (result as Record<string, unknown>)[statusKey] = fv.name;
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
        if (!result.customFields) result.customFields = {};
        result.customFields[fieldName] = value;
      }
    }
  }
  return result;
}

/** Cache for GitHub Projects node IDs — these are immutable per project number. */
const projectNodeIdCache = new Map<string, string>();

/** Resolve a GitHub Projects v2 node ID synchronously (with caching). */
function getProjectNodeIdSync(owner: string, projectNumber: number): string | null {
  const key = `${owner}/${String(projectNumber)}`;
  const cached = projectNodeIdCache.get(key);
  if (cached !== undefined) return cached;

  const idFragment = `projectV2(number: $projectNumber) { id }`;

  const projectQuery = `
    query($owner: String!, $projectNumber: Int!) {
      organization(login: $owner) { ${idFragment} }
      user(login: $owner) { ${idFragment} }
    }
  `;

  const projectResult = runGhGraphQL<GraphQLProjectResult>([
    "api",
    "graphql",
    "-f",
    `query=${projectQuery}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `projectNumber=${String(projectNumber)}`,
  ]);

  const ownerNode = projectResult?.data?.organization ?? projectResult?.data?.user;
  const projectId = ownerNode?.projectV2?.id;
  if (!projectId) return null;
  projectNodeIdCache.set(key, projectId);
  return projectId;
}

/** Resolve a GitHub Projects v2 node ID asynchronously (with caching). */
async function getProjectNodeId(owner: string, projectNumber: number): Promise<string | null> {
  const key = `${owner}/${String(projectNumber)}`;
  const cached = projectNodeIdCache.get(key);
  if (cached !== undefined) return cached;

  const idFragment = `projectV2(number: $projectNumber) { id }`;

  const projectQuery = `
    query($owner: String!, $projectNumber: Int!) {
      organization(login: $owner) { ${idFragment} }
      user(login: $owner) { ${idFragment} }
    }
  `;

  const projectResult = await runGhGraphQLAsync<GraphQLProjectResult>([
    "api",
    "graphql",
    "-f",
    `query=${projectQuery}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `projectNumber=${String(projectNumber)}`,
  ]);

  const ownerNode = projectResult?.data?.organization ?? projectResult?.data?.user;
  const projectId = ownerNode?.projectV2?.id;
  if (!projectId) return null;
  projectNodeIdCache.set(key, projectId);
  return projectId;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

export async function fetchRepoIssuesAsync(
  repo: string,
  options: FetchIssuesOptions = {},
): Promise<GitHubIssue[]> {
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
  return runGhJsonAsync<GitHubIssue[]>(args);
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

export function fetchProjectFields(
  repo: string,
  issueNumber: number,
  projectNumber: number,
): ProjectFieldValues {
  const [owner, repoName] = repo.split("/");
  if (!(owner && repoName)) return {};

  try {
    const projectItem = findProjectItemSync(owner, repoName, issueNumber, projectNumber);
    if (!projectItem) return {};

    return parseFieldValues(projectItem.fieldValues?.nodes ?? [], "status");
  } catch {
    return {};
  }
}

export interface ProjectEnrichment {
  targetDate?: string;
  projectStatus?: string;
  customFields?: Record<string, string>;
}

/** Shared GraphQL fragment for fetching project items with repo info. */
const PROJECT_ITEMS_FRAGMENT = `
  projectV2(number: $projectNumber) {
    items(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        content {
          ... on Issue {
            number
            repository { nameWithOwner }
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
`;

/** Accumulate enrichment data from a page of project items, filtering by target repo. */
function accumulateEnrichment(
  nodes: (ProjectItemNode | null)[],
  targetRepo: string,
  enrichMap: Map<number, ProjectEnrichment>,
): void {
  for (const item of nodes) {
    if (!item?.content?.number) continue;
    // Skip items from other repos to avoid issue number collisions
    const itemRepo = item.content.repository?.nameWithOwner;
    if (itemRepo && itemRepo !== targetRepo) continue;
    const enrichment = parseFieldValues(item.fieldValues?.nodes ?? [], "projectStatus");
    enrichMap.set(item.content.number, enrichment);
  }
}

/**
 * Fetch target dates and project statuses for all issues in a project in one GraphQL call.
 * Returns a Map from issue number to enrichment data.
 *
 * Projects can contain items from multiple repos, so we filter by the target repo
 * to avoid cross-repo issue number collisions overwriting statuses.
 */
export function fetchProjectEnrichment(
  repo: string,
  projectNumber: number,
): Map<number, ProjectEnrichment> {
  const [owner] = repo.split("/");
  if (!owner) return new Map();

  const query = `
    query($owner: String!, $projectNumber: Int!, $cursor: String) {
      organization(login: $owner) { ${PROJECT_ITEMS_FRAGMENT} }
      user(login: $owner) { ${PROJECT_ITEMS_FRAGMENT} }
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
      const result = runGhGraphQL<ProjectItemsResult>(args);
      const ownerNode = result?.data?.organization ?? result?.data?.user;
      const page = ownerNode?.projectV2?.items;
      accumulateEnrichment(page?.nodes ?? [], repo, enrichMap);

      if (!page?.pageInfo?.hasNextPage) break;
      cursor = page.pageInfo.endCursor ?? null;
    } while (cursor);

    return enrichMap;
  } catch {
    return new Map();
  }
}

/** Async version of fetchProjectEnrichment for parallel fetching. */
export async function fetchProjectEnrichmentAsync(
  repo: string,
  projectNumber: number,
): Promise<Map<number, ProjectEnrichment>> {
  const [owner] = repo.split("/");
  if (!owner) return new Map();

  const query = `
    query($owner: String!, $projectNumber: Int!, $cursor: String) {
      organization(login: $owner) { ${PROJECT_ITEMS_FRAGMENT} }
      user(login: $owner) { ${PROJECT_ITEMS_FRAGMENT} }
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
      const result = await runGhGraphQLAsync<ProjectItemsResult>(args);
      const ownerNode = result?.data?.organization ?? result?.data?.user;
      const page = ownerNode?.projectV2?.items;
      accumulateEnrichment(page?.nodes ?? [], repo, enrichMap);

      if (!page?.pageInfo?.hasNextPage) break;
      cursor = page.pageInfo.endCursor ?? null;
    } while (cursor);

    return enrichMap;
  } catch {
    // Non-critical: return empty map if project fields fail
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

  const statusFragment = `
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
  `;

  const query = `
    query($owner: String!, $projectNumber: Int!) {
      organization(login: $owner) { ${statusFragment} }
      user(login: $owner) { ${statusFragment} }
    }
  `;

  try {
    const result = runGhGraphQL<ProjectStatusResult>([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `projectNumber=${String(projectNumber)}`,
    ]);

    const ownerNode = result?.data?.organization ?? result?.data?.user;
    return ownerNode?.projectV2?.field?.options ?? [];
  } catch {
    return [];
  }
}

/** Async version of fetchProjectStatusOptions for parallel fetching. */
export async function fetchProjectStatusOptionsAsync(
  repo: string,
  projectNumber: number,
  _statusFieldId: string,
): Promise<StatusOption[]> {
  const [owner] = repo.split("/");
  if (!owner) return [];

  const statusFragment = `
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
  `;

  const query = `
    query($owner: String!, $projectNumber: Int!) {
      organization(login: $owner) { ${statusFragment} }
      user(login: $owner) { ${statusFragment} }
    }
  `;

  try {
    const result = await runGhGraphQLAsync<ProjectStatusResult>([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `projectNumber=${String(projectNumber)}`,
    ]);

    const ownerNode = result?.data?.organization ?? result?.data?.user;
    return ownerNode?.projectV2?.field?.options ?? [];
  } catch {
    // Non-critical: return empty options if project fields fail
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

/** Clears the project node ID cache. Intended for use in tests only. */
export function clearProjectNodeIdCache(): void {
  projectNodeIdCache.clear();
}

export function updateProjectItemStatus(
  repo: string,
  issueNumber: number,
  projectConfig: RepoProjectConfig,
): void {
  const [owner, repoName] = repo.split("/");
  if (!(owner && repoName)) return;

  const projectItem = findProjectItemSync(
    owner,
    repoName,
    issueNumber,
    projectConfig.projectNumber,
  );
  if (!projectItem?.id) return;

  const projectId = getProjectNodeIdSync(owner, projectConfig.projectNumber);
  if (!projectId) return;

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
    `fieldId=${projectConfig.statusFieldId}`,
    "-F",
    `optionId=${projectConfig.optionId}`,
  ]);
}

export async function updateProjectItemStatusAsync(
  repo: string,
  issueNumber: number,
  projectConfig: RepoProjectConfig,
): Promise<void> {
  const [owner, repoName] = repo.split("/");
  if (!(owner && repoName)) return;

  const projectItem = await findProjectItemAsync(
    owner,
    repoName,
    issueNumber,
    projectConfig.projectNumber,
  );
  if (!projectItem?.id) return;

  const projectId = await getProjectNodeId(owner, projectConfig.projectNumber);
  if (!projectId) return;

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
    `fieldId=${projectConfig.statusFieldId}`,
    "-F",
    `optionId=${projectConfig.optionId}`,
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

  const projectItem = await findProjectItemAsync(
    owner,
    repoName,
    issueNumber,
    projectConfig.projectNumber,
  );
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

interface ProjectV2StatusNode {
  projectV2?: {
    field?: {
      options?: StatusOption[];
    };
  };
}

interface ProjectStatusResult {
  data?: {
    organization?: ProjectV2StatusNode;
    user?: ProjectV2StatusNode;
  };
}
