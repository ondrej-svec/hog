import { TickTickClient } from "./api.js";
import { formatError } from "./board/constants.js";
import type { HogConfig, RepoConfig } from "./config.js";
import { loadFullConfig, requireAuth } from "./config.js";
import type { GitHubIssue, ProjectEnrichment } from "./github.js";
import {
  addLabel,
  fetchAssignedIssues,
  fetchProjectEnrichment,
  updateProjectItemStatus,
} from "./github.js";
import type { SyncMapping, SyncState } from "./sync-state.js";
import {
  findMapping,
  loadSyncState,
  removeMapping,
  saveSyncState,
  upsertMapping,
} from "./sync-state.js";
import type { CreateTaskInput, UpdateTaskInput } from "./types.js";
import { Priority, TaskStatus } from "./types.js";

export interface SyncResult {
  created: string[];
  updated: string[];
  completed: string[];
  ghUpdated: string[];
  errors: string[];
}

interface SyncOptions {
  dryRun?: boolean;
}

function emptySyncResult(): SyncResult {
  return { created: [], updated: [], completed: [], ghUpdated: [], errors: [] };
}

function repoShortName(repo: string): string {
  return repo.split("/")[1] ?? repo;
}

function issueTaskTitle(issue: GitHubIssue): string {
  return issue.title;
}

function issueTaskContent(
  issue: GitHubIssue,
  projectFields: { targetDate?: string; status?: string },
): string {
  const lines = [`GitHub: ${issue.url}`];
  if (projectFields.status) lines.push(`Status: ${projectFields.status}`);
  return lines.join("\n");
}

function mapPriority(labels: { name: string }[]): Priority {
  for (const label of labels) {
    if (label.name === "priority:critical" || label.name === "priority:high") return Priority.High;
    if (label.name === "priority:medium") return Priority.Medium;
    if (label.name === "priority:low") return Priority.Low;
  }
  return Priority.None;
}

function buildCreateInput(
  repo: string,
  issue: GitHubIssue,
  projectFields: { targetDate?: string; status?: string },
): CreateTaskInput {
  const input: CreateTaskInput = {
    title: issueTaskTitle(issue),
    content: issueTaskContent(issue, projectFields),
    priority: mapPriority(issue.labels),
    tags: ["github", repoShortName(repo)],
  };
  if (projectFields.targetDate) {
    input.dueDate = projectFields.targetDate;
    input.isAllDay = true;
  }
  return input;
}

function buildUpdateInput(
  repo: string,
  issue: GitHubIssue,
  projectFields: { targetDate?: string; status?: string },
  mapping: SyncMapping,
): UpdateTaskInput {
  const input: UpdateTaskInput = {
    id: mapping.ticktickTaskId,
    projectId: mapping.ticktickProjectId,
    title: issueTaskTitle(issue),
    content: issueTaskContent(issue, projectFields),
    priority: mapPriority(issue.labels),
    tags: ["github", repoShortName(repo)],
  };
  if (projectFields.targetDate) {
    input.dueDate = projectFields.targetDate;
  }
  return input;
}

/** Phase 1: Sync GitHub issues to TickTick (create/update). Returns open issue keys and repos that failed to fetch. */
async function syncGitHubToTickTick(
  config: HogConfig,
  state: SyncState,
  api: TickTickClient,
  result: SyncResult,
  dryRun: boolean,
): Promise<{ openIssueKeys: Set<string>; failedRepos: Set<string> }> {
  const openIssueKeys = new Set<string>();
  const failedRepos = new Set<string>();

  for (const repoConfig of config.repos) {
    let issues: GitHubIssue[];
    try {
      issues = fetchAssignedIssues(repoConfig.name, config.board.assignee);
    } catch (err) {
      result.errors.push(`Failed to fetch issues from ${repoConfig.name}: ${formatError(err)}`);
      failedRepos.add(repoConfig.name);
      continue;
    }

    let enrichMap: Map<number, ProjectEnrichment>;
    try {
      enrichMap = fetchProjectEnrichment(repoConfig.name, repoConfig.projectNumber);
    } catch {
      enrichMap = new Map();
    }

    for (const issue of issues) {
      const key = `${repoConfig.name}#${issue.number}`;
      openIssueKeys.add(key);
      await syncSingleIssue(state, api, result, dryRun, repoConfig, issue, key, enrichMap);
    }
  }

  return { openIssueKeys, failedRepos };
}

async function syncSingleIssue(
  state: SyncState,
  api: TickTickClient,
  result: SyncResult,
  dryRun: boolean,
  repoConfig: RepoConfig,
  issue: GitHubIssue,
  key: string,
  enrichMap: Map<number, ProjectEnrichment>,
): Promise<void> {
  try {
    const existing = findMapping(state, repoConfig.name, issue.number);

    if (existing && existing.githubUpdatedAt === issue.updatedAt) return;

    const enrichment = enrichMap.get(issue.number);
    const projectFields: { targetDate?: string; status?: string } = {
      ...(enrichment?.targetDate !== undefined && { targetDate: enrichment.targetDate }),
      ...(enrichment?.projectStatus !== undefined && { status: enrichment.projectStatus }),
    };

    if (!existing) {
      await createTickTickTask(
        state,
        api,
        result,
        dryRun,
        repoConfig.name,
        issue,
        projectFields,
        key,
      );
    } else {
      await updateTickTickTask(
        state,
        api,
        result,
        dryRun,
        repoConfig.name,
        issue,
        projectFields,
        existing,
        key,
      );
    }
  } catch (err) {
    result.errors.push(`${key}: ${formatError(err)}`);
  }
}

async function createTickTickTask(
  state: SyncState,
  api: TickTickClient,
  result: SyncResult,
  dryRun: boolean,
  repo: string,
  issue: GitHubIssue,
  projectFields: { targetDate?: string; status?: string },
  key: string,
): Promise<void> {
  if (dryRun) {
    result.created.push(key);
    return;
  }
  const input = buildCreateInput(repo, issue, projectFields);
  const task = await api.createTask(input);

  upsertMapping(state, {
    githubRepo: repo,
    githubIssueNumber: issue.number,
    githubUrl: issue.url,
    ticktickTaskId: task.id,
    ticktickProjectId: task.projectId,
    githubUpdatedAt: issue.updatedAt,
    lastSyncedAt: new Date().toISOString(),
  });
  result.created.push(key);
}

async function updateTickTickTask(
  state: SyncState,
  api: TickTickClient,
  result: SyncResult,
  dryRun: boolean,
  repo: string,
  issue: GitHubIssue,
  projectFields: { targetDate?: string; status?: string },
  existing: SyncMapping,
  key: string,
): Promise<void> {
  if (dryRun) {
    result.updated.push(key);
    return;
  }
  const input = buildUpdateInput(repo, issue, projectFields, existing);
  await api.updateTask(input);

  upsertMapping(state, {
    ...existing,
    githubUpdatedAt: issue.updatedAt,
    lastSyncedAt: new Date().toISOString(),
  });
  result.updated.push(key);
}

/** Phase 2: Complete TickTick tasks for issues no longer open on GitHub. */
async function syncClosedIssues(
  state: SyncState,
  api: TickTickClient,
  result: SyncResult,
  dryRun: boolean,
  openIssueKeys: Set<string>,
  failedRepos: Set<string>,
): Promise<void> {
  for (const mapping of [...state.mappings]) {
    // SAFETY: Never complete tasks from repos we couldn't fetch — we don't know their real state
    if (failedRepos.has(mapping.githubRepo)) continue;

    const key = `${mapping.githubRepo}#${mapping.githubIssueNumber}`;
    if (openIssueKeys.has(key)) continue;

    try {
      if (dryRun) {
        result.completed.push(key);
        continue;
      }
      await api.completeTask(mapping.ticktickProjectId, mapping.ticktickTaskId);
      removeMapping(state, mapping.githubRepo, mapping.githubIssueNumber);
      result.completed.push(key);
    } catch (err) {
      result.errors.push(`Complete ${key}: ${formatError(err)}`);
    }
  }
}

/** Phase 3: Update GitHub when TickTick tasks are completed. */
async function syncCompletedTasksToGitHub(
  config: HogConfig,
  state: SyncState,
  api: TickTickClient,
  result: SyncResult,
  dryRun: boolean,
): Promise<void> {
  for (const mapping of [...state.mappings]) {
    const key = `${mapping.githubRepo}#${mapping.githubIssueNumber}`;
    try {
      await processCompletedMapping(config, state, api, result, dryRun, mapping, key);
    } catch (err) {
      result.errors.push(`GH update ${key}: ${formatError(err)}`);
    }
  }
}

async function processCompletedMapping(
  config: HogConfig,
  state: SyncState,
  api: TickTickClient,
  result: SyncResult,
  dryRun: boolean,
  mapping: SyncMapping,
  key: string,
): Promise<void> {
  let task: Awaited<ReturnType<TickTickClient["getTask"]>>;
  try {
    task = await api.getTask(mapping.ticktickProjectId, mapping.ticktickTaskId);
  } catch {
    return; // Task might have been deleted
  }

  if (task.status !== TaskStatus.Completed) return;

  if (dryRun) {
    result.ghUpdated.push(key);
    return;
  }

  const repo = mapping.githubRepo;
  const repoConfig = config.repos.find((r) => r.name === repo);

  if (repoConfig) {
    const action = repoConfig.completionAction;
    switch (action.type) {
      case "addLabel":
        addLabel(repo, mapping.githubIssueNumber, action.label);
        break;
      case "updateProjectStatus":
        updateProjectItemStatus(repo, mapping.githubIssueNumber, {
          projectNumber: repoConfig.projectNumber,
          statusFieldId: repoConfig.statusFieldId,
          optionId: action.optionId,
        });
        break;
      case "closeIssue":
        // Future: close the issue
        break;
    }
  }

  removeMapping(state, repo, mapping.githubIssueNumber);
  result.ghUpdated.push(key);
}

export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const { dryRun = false } = options;
  const result = emptySyncResult();

  const config = loadFullConfig();
  const auth = requireAuth();
  const api = new TickTickClient(auth.accessToken);
  const state = loadSyncState();

  const { openIssueKeys, failedRepos } = await syncGitHubToTickTick(
    config,
    state,
    api,
    result,
    dryRun,
  );
  await syncClosedIssues(state, api, result, dryRun, openIssueKeys, failedRepos);
  await syncCompletedTasksToGitHub(config, state, api, result, dryRun);

  if (!dryRun) {
    state.lastSyncAt = new Date().toISOString();
    saveSyncState(state);
  }

  return result;
}

export function getSyncStatus(): { state: SyncState; repos: string[] } {
  const config = loadFullConfig();
  return { state: loadSyncState(), repos: config.repos.map((r) => r.name) };
}
