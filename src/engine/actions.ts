import type { HogConfig, RepoConfig } from "../config.js";
import type { RepoDueDateConfig, RepoProjectConfig } from "../github.js";
import {
  addCommentAsync,
  addLabelAsync,
  assignIssueAsync,
  closeIssueAsync,
  createIssueAsync,
  unassignIssueAsync,
  updateLabelsAsync,
  updateProjectItemDateAsync,
  updateProjectItemStatusAsync,
} from "../github.js";
import type { Result } from "../types.js";
import { formatError } from "../utils.js";
import type { EventBus } from "./event-bus.js";

// ── Types ──

export interface MutationSuccess {
  readonly description: string;
}

export type MutationResult = Result<MutationSuccess, { description: string; error: string }>;

// ── ActionExecutor ──

export class ActionExecutor {
  private readonly config: HogConfig;
  private readonly eventBus: EventBus;

  constructor(config: HogConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
  }

  async pick(repoConfig: RepoConfig, issueNumber: number): Promise<MutationResult> {
    const description = `Pick ${repoConfig.shortName}#${issueNumber}`;
    this.eventBus.emit("mutation:started", { description });

    try {
      await assignIssueAsync(repoConfig.name, issueNumber);
      this.eventBus.emit("mutation:completed", { description });
      return { ok: true, value: { description } };
    } catch (err) {
      const error = formatError(err);
      this.eventBus.emit("mutation:failed", { description, error });
      return { ok: false, error: { description, error } };
    }
  }

  async comment(repoName: string, issueNumber: number, body: string): Promise<MutationResult> {
    const description = `Comment on #${issueNumber}`;
    this.eventBus.emit("mutation:started", { description });

    try {
      await addCommentAsync(repoName, issueNumber, body);
      this.eventBus.emit("mutation:completed", { description });
      return { ok: true, value: { description } };
    } catch (err) {
      const error = formatError(err);
      this.eventBus.emit("mutation:failed", { description, error });
      return { ok: false, error: { description, error } };
    }
  }

  async changeStatus(
    repoName: string,
    issueNumber: number,
    repoConfig: RepoConfig,
    optionId: string,
  ): Promise<MutationResult> {
    const description = `#${issueNumber} status change`;
    this.eventBus.emit("mutation:started", { description });

    try {
      const projectConfig: RepoProjectConfig = {
        projectNumber: repoConfig.projectNumber,
        statusFieldId: repoConfig.statusFieldId,
        optionId,
      };
      await updateProjectItemStatusAsync(repoName, issueNumber, projectConfig);
      this.eventBus.emit("mutation:completed", { description });
      return { ok: true, value: { description } };
    } catch (err) {
      const error = formatError(err);
      this.eventBus.emit("mutation:failed", { description, error });
      return { ok: false, error: { description, error } };
    }
  }

  async assign(repoName: string, issueNumber: number): Promise<MutationResult> {
    const description = `Assign #${issueNumber}`;
    this.eventBus.emit("mutation:started", { description });

    try {
      await assignIssueAsync(repoName, issueNumber);
      this.eventBus.emit("mutation:completed", { description });
      return { ok: true, value: { description } };
    } catch (err) {
      const error = formatError(err);
      this.eventBus.emit("mutation:failed", { description, error });
      return { ok: false, error: { description, error } };
    }
  }

  async unassign(repoName: string, issueNumber: number): Promise<MutationResult> {
    const description = `Unassign #${issueNumber}`;
    this.eventBus.emit("mutation:started", { description });

    try {
      await unassignIssueAsync(repoName, issueNumber, "@me");
      this.eventBus.emit("mutation:completed", { description });
      return { ok: true, value: { description } };
    } catch (err) {
      const error = formatError(err);
      this.eventBus.emit("mutation:failed", { description, error });
      return { ok: false, error: { description, error } };
    }
  }

  async changeLabels(
    repoName: string,
    issueNumber: number,
    addLabels: string[],
    removeLabels: string[],
  ): Promise<MutationResult> {
    const description = `Update labels on #${issueNumber}`;
    this.eventBus.emit("mutation:started", { description });

    try {
      await updateLabelsAsync(repoName, issueNumber, addLabels, removeLabels);
      this.eventBus.emit("mutation:completed", { description });
      return { ok: true, value: { description } };
    } catch (err) {
      const error = formatError(err);
      this.eventBus.emit("mutation:failed", { description, error });
      return { ok: false, error: { description, error } };
    }
  }

  async createIssue(
    repo: string,
    title: string,
    body: string,
    dueDate?: string | null,
    labels?: string[],
  ): Promise<
    Result<
      { repo: string; issueNumber: number; description: string },
      { description: string; error: string }
    >
  > {
    const description = `Create issue in ${repo}`;
    this.eventBus.emit("mutation:started", { description });

    const repoConfig = this.config.repos.find((r) => r.name === repo);

    let effectiveBody = body;
    if (dueDate && !repoConfig?.dueDateFieldId) {
      const dueLine = `Due: ${dueDate}`;
      effectiveBody = body ? `${body}\n\n${dueLine}` : dueLine;
    }

    try {
      const output = await createIssueAsync(repo, title, effectiveBody, labels);
      const match = output.match(/\/(\d+)$/);
      const issueNumber = match?.[1] ? parseInt(match[1], 10) : 0;

      if (issueNumber > 0 && dueDate && repoConfig?.dueDateFieldId) {
        const dueDateConfig: RepoDueDateConfig = {
          projectNumber: repoConfig.projectNumber,
          dueDateFieldId: repoConfig.dueDateFieldId,
        };
        updateProjectItemDateAsync(repo, issueNumber, dueDateConfig, dueDate).catch(() => {
          // best-effort
        });
      }

      this.eventBus.emit("mutation:completed", { description: `Created ${repo}#${issueNumber}` });
      return {
        ok: true,
        value: { repo, issueNumber, description: `Created ${repo}#${issueNumber}` },
      };
    } catch (err) {
      const error = formatError(err);
      this.eventBus.emit("mutation:failed", { description, error });
      return { ok: false, error: { description, error } };
    }
  }

  async closeIssue(repoName: string, issueNumber: number): Promise<MutationResult> {
    const description = `Close #${issueNumber}`;
    this.eventBus.emit("mutation:started", { description });

    try {
      await closeIssueAsync(repoName, issueNumber);
      this.eventBus.emit("mutation:completed", { description });
      return { ok: true, value: { description } };
    } catch (err) {
      const error = formatError(err);
      this.eventBus.emit("mutation:failed", { description, error });
      return { ok: false, error: { description, error } };
    }
  }

  async triggerCompletionAction(
    action: RepoConfig["completionAction"],
    repoName: string,
    issueNumber: number,
  ): Promise<void> {
    switch (action.type) {
      case "closeIssue":
        await closeIssueAsync(repoName, issueNumber);
        break;
      case "addLabel":
        await addLabelAsync(repoName, issueNumber, action.label);
        break;
      case "updateProjectStatus":
        break;
    }
  }
}
