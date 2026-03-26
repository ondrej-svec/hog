/**
 * GitHub Sync Bridge — push pipeline phase transitions to GitHub Issues.
 *
 * This is a push-only, fire-and-forget layer. GitHub sync failures are
 * logged but never block pipeline advancement.
 */
import { addCommentAsync, addLabelAsync, closeIssueAsync, removeLabelAsync } from "../github.js";
import type { Pipeline } from "./conductor.js";
import type { PipelineRole } from "./roles.js";

// ── Types ──

export interface GitHubSyncConfig {
  /** Map pipeline phase → GitHub label to add. */
  readonly phaseToLabel?: Partial<Record<PipelineRole, string>>;
  /** Map pipeline phase → GitHub Projects status column name. */
  readonly phaseToStatus?: Partial<Record<PipelineRole, string>>;
  /** Post a comment on the issue when each phase completes. */
  readonly syncComments?: boolean;
  /** Trigger the repo's completionAction when merge phase completes. */
  readonly triggerCompletionAction?: boolean;
}

/** Ordered pipeline phases for label cleanup. */
const PHASE_ORDER: PipelineRole[] = ["brainstorm", "stories", "test", "impl", "redteam", "merge"];

// ── GitHubSync ──

export class GitHubSync {
  private readonly config: GitHubSyncConfig;

  constructor(config: GitHubSyncConfig) {
    this.config = config;
  }

  /**
   * Called when a pipeline phase completes.
   * Pushes labels, status, and comments to the linked GitHub issue.
   * All errors are caught — never blocks the pipeline.
   */
  async onPhaseCompleted(
    pipeline: Pipeline,
    phase: string,
    githubRepo: string,
    issueNumber: number,
  ): Promise<void> {
    // No linked issue → nothing to do
    if (!githubRepo || issueNumber <= 0) return;

    const role = phase as PipelineRole;

    // Label sync
    if (this.config.phaseToLabel?.[role]) {
      await this.syncLabel(githubRepo, issueNumber, role);
    }

    // Comment sync
    if (this.config.syncComments) {
      await this.postPhaseComment(githubRepo, issueNumber, pipeline, phase);
    }

    // Completion action on merge
    if (role === "merge" && this.config.triggerCompletionAction) {
      await this.triggerCompletion(pipeline, githubRepo, issueNumber);
    }
  }

  // ── Private ──

  private async syncLabel(
    repo: string,
    issueNumber: number,
    currentPhase: PipelineRole,
  ): Promise<void> {
    const labelMap = this.config.phaseToLabel;
    if (!labelMap) return;

    const newLabel = labelMap[currentPhase];
    if (!newLabel) return;

    try {
      // Remove label from previous phase (if any)
      const currentIdx = PHASE_ORDER.indexOf(currentPhase);
      if (currentIdx > 0) {
        const prevPhase = PHASE_ORDER[currentIdx - 1];
        const prevLabel = prevPhase ? labelMap[prevPhase] : undefined;
        if (prevLabel) {
          await removeLabelAsync(repo, issueNumber, prevLabel).catch(() => {
            // Label may not exist — that's fine
          });
        }
      }

      // Add new label
      await addLabelAsync(repo, issueNumber, newLabel);
    } catch {
      // Best-effort — don't block pipeline
    }
  }

  private async postPhaseComment(
    repo: string,
    issueNumber: number,
    pipeline: Pipeline,
    phase: string,
  ): Promise<void> {
    try {
      const msg = `Pipeline phase \`${phase}\` completed for "${pipeline.title}" (${pipeline.completedBeads}/6 phases done).`;
      await addCommentAsync(repo, issueNumber, msg);
    } catch {
      // Best-effort
    }
  }

  private async triggerCompletion(
    pipeline: Pipeline,
    repo: string,
    issueNumber: number,
  ): Promise<void> {
    try {
      const action = pipeline.repoConfig.completionAction;
      if (action.type === "closeIssue") {
        await closeIssueAsync(repo, issueNumber);
      } else if (action.type === "addLabel") {
        await addLabelAsync(repo, issueNumber, action.label);
      }
      // updateProjectStatus requires field ID resolution — skip for now
    } catch {
      // Best-effort
    }
  }
}
