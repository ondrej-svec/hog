import { useCallback } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import { findIssueByNavId } from "../board-utils.js";
import type { TriageAction } from "../components/triage-overlay.js";
import type { WorkflowAction } from "../components/workflow-overlay.js";
import type { RepoData } from "../fetch.js";
import { DEFAULT_PHASE_PROMPTS, launchClaude } from "../launch-claude.js";
import type { UseAgentSessionsResult } from "./use-agent-sessions.js";
import type { UseWorkflowStateResult } from "./use-workflow-state.js";

// ── Types ──

interface LaunchOrchestrationDeps {
  readonly config: HogConfig;
  readonly repos: RepoData[];
  readonly selectedId: string | null;
  readonly toast: {
    readonly info: (msg: string) => void;
    readonly error: (msg: string) => void;
  };
  readonly ui: {
    readonly enterWorkflow: () => void;
    readonly exitOverlay: () => void;
  };
  readonly zen: {
    readonly swapToAgent: (issueNumber: number) => void;
  };
  readonly agentSessions: UseAgentSessionsResult;
  readonly workflowState: UseWorkflowStateResult;
  readonly nudges: {
    readonly snooze: (repo: string, issueNumber: number, days: number) => void;
  };
}

export interface LaunchOrchestrationResult {
  /** Launch Claude Code for the currently selected issue (simple mode, "c" key). */
  readonly handleLaunchClaude: () => void;
  /** Enter the workflow overlay for the currently selected issue. */
  readonly handleEnterWorkflow: () => void;
  /** Handle a workflow overlay action (phase launch, resume, completion-check). */
  readonly handleWorkflowAction: (action: WorkflowAction) => void;
  /** Handle a triage overlay action (snooze or batch-launch agents). */
  readonly handleTriageAction: (action: TriageAction) => void;
}

// ── Helpers ──

/** Resolve launch config for a workflow phase (template + start command + slug). */
export function resolvePhaseConfig(
  rc: RepoConfig,
  config: HogConfig,
  issueTitle: string,
  phase: string,
): {
  template: string | undefined;
  startCommand: { command: string; extraArgs: readonly string[] } | undefined;
  slug: string;
} {
  const phasePrompts = rc.workflow?.phasePrompts ?? config.board.workflow?.phasePrompts ?? {};
  const template = phasePrompts[phase] ?? DEFAULT_PHASE_PROMPTS[phase];
  const startCommand = rc.claudeStartCommand ?? config.board.claudeStartCommand;
  const slug = issueTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { template, startCommand, slug };
}

// ── Hook ──

export function useLaunchOrchestration({
  config,
  repos,
  selectedId,
  toast,
  ui,
  zen,
  agentSessions,
  workflowState,
  nudges,
}: LaunchOrchestrationDeps): LaunchOrchestrationResult {
  const handleLaunchClaude = useCallback(() => {
    const found = findIssueByNavId(repos, selectedId);
    if (!found) return; // cursor on header / empty row → silent no-op

    const rc = config.repos.find((r) => r.name === found.repoName);
    if (!rc?.localPath) {
      toast.info(
        `Set localPath for ${rc?.shortName ?? found.repoName} in ~/.config/hog/config.json to enable Claude Code launch`,
      );
      return;
    }

    const resolvedStartCommand = rc.claudeStartCommand ?? config.board.claudeStartCommand;
    const resolvedPromptTemplate = rc.claudePrompt ?? config.board.claudePrompt;
    const result = launchClaude({
      localPath: rc.localPath,
      issue: { number: found.issue.number, title: found.issue.title, url: found.issue.url },
      ...(resolvedStartCommand ? { startCommand: resolvedStartCommand } : {}),
      ...(resolvedPromptTemplate ? { promptTemplate: resolvedPromptTemplate } : {}),
      launchMode: config.board.claudeLaunchMode ?? "auto",
      ...(config.board.claudeTerminalApp ? { terminalApp: config.board.claudeTerminalApp } : {}),
      repoFullName: found.repoName,
    });

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.info(`Claude Code session opened in ${rc.shortName ?? found.repoName}`);

    // In zen mode: swap right pane to show the newly launched agent
    zen.swapToAgent(found.issue.number);
  }, [repos, selectedId, config.repos, config.board, toast, zen]);

  const handleEnterWorkflow = useCallback(() => {
    const found = findIssueByNavId(repos, selectedId);
    if (!found) return;
    ui.enterWorkflow();
  }, [repos, selectedId, ui]);

  const handleWorkflowAction = useCallback(
    (action: WorkflowAction) => {
      const found = findIssueByNavId(repos, selectedId);
      if (!found) return;

      const rc = config.repos.find((r) => r.name === found.repoName);

      if (action.type === "resume") {
        if (!rc?.localPath) {
          toast.info(
            `Set localPath for ${rc?.shortName ?? found.repoName} to enable Claude Code launch`,
          );
          ui.exitOverlay();
          return;
        }
        const resolvedStartCommand = rc.claudeStartCommand ?? config.board.claudeStartCommand;
        const result = launchClaude({
          localPath: rc.localPath,
          issue: { number: found.issue.number, title: found.issue.title, url: found.issue.url },
          ...(resolvedStartCommand ? { startCommand: resolvedStartCommand } : {}),
          launchMode: config.board.claudeLaunchMode ?? "auto",
          ...(config.board.claudeTerminalApp
            ? { terminalApp: config.board.claudeTerminalApp }
            : {}),
          repoFullName: found.repoName,
          promptTemplate: `--resume ${action.sessionId}`,
        });
        if (!result.ok) {
          toast.error(result.error.message);
        } else {
          toast.info("Resumed Claude Code session");
        }
        ui.exitOverlay();
        return;
      }

      // Completion check — launch background agent with completion-check phase
      if (action.type === "completion-check") {
        if (!rc?.localPath) {
          toast.info(
            `Set localPath for ${rc?.shortName ?? found.repoName} to enable Claude Code launch`,
          );
          ui.exitOverlay();
          return;
        }
        const { template, startCommand, slug } = resolvePhaseConfig(
          rc,
          config,
          found.issue.title,
          "completion-check",
        );
        const agentResult = agentSessions.launchAgent({
          localPath: rc.localPath,
          repoFullName: found.repoName,
          issueNumber: found.issue.number,
          issueTitle: found.issue.title,
          issueUrl: found.issue.url,
          phase: "completion-check",
          promptTemplate: template,
          promptVariables: { slug, phase: "completion-check", repo: found.repoName },
          ...(startCommand ? { startCommand } : {}),
        });
        if (typeof agentResult === "object" && "error" in agentResult) {
          toast.error(agentResult.error);
        } else {
          toast.info(`Completion check started for #${found.issue.number}`);
        }
        ui.exitOverlay();
        return;
      }

      // Launch phase
      if (!rc?.localPath) {
        toast.info(
          `Set localPath for ${rc?.shortName ?? found.repoName} to enable Claude Code launch`,
        );
        ui.exitOverlay();
        return;
      }

      const { template, startCommand, slug } = resolvePhaseConfig(
        rc,
        config,
        found.issue.title,
        action.phase,
      );

      if (action.mode === "background") {
        const agentResult = agentSessions.launchAgent({
          localPath: rc.localPath,
          repoFullName: found.repoName,
          issueNumber: found.issue.number,
          issueTitle: found.issue.title,
          issueUrl: found.issue.url,
          phase: action.phase,
          promptTemplate: template,
          promptVariables: { slug, phase: action.phase, repo: found.repoName },
          ...(startCommand ? { startCommand } : {}),
        });

        if (typeof agentResult === "object" && "error" in agentResult) {
          toast.error(agentResult.error);
        } else {
          toast.info(`Background agent started: ${action.phase} for #${found.issue.number}`);
        }
        ui.exitOverlay();
        return;
      }

      // Interactive: launch in terminal/tmux
      const result = launchClaude({
        localPath: rc.localPath,
        issue: { number: found.issue.number, title: found.issue.title, url: found.issue.url },
        ...(startCommand ? { startCommand } : {}),
        launchMode: config.board.claudeLaunchMode ?? "auto",
        ...(config.board.claudeTerminalApp ? { terminalApp: config.board.claudeTerminalApp } : {}),
        repoFullName: found.repoName,
        promptTemplate: template,
        promptVariables: { slug, phase: action.phase, repo: found.repoName },
      });

      if (!result.ok) {
        toast.error(result.error.message);
        ui.exitOverlay();
        return;
      }

      // Record interactive session in enrichment
      workflowState.recordSession({
        repo: found.repoName,
        issueNumber: found.issue.number,
        phase: action.phase,
        mode: "interactive",
        startedAt: new Date().toISOString(),
      });

      toast.info(`${action.phase} session opened for #${found.issue.number}`);
      ui.exitOverlay();
    },
    [repos, selectedId, config, ui, toast, workflowState, agentSessions],
  );

  const handleTriageAction = useCallback(
    (action: TriageAction) => {
      if (action.type === "snooze") {
        nudges.snooze(action.repo, action.issueNumber, action.days);
        toast.info(`Snoozed #${action.issueNumber} for ${action.days}d`);
        return;
      }

      // Launch agents for selected candidates
      let launched = 0;
      for (const candidate of action.candidates) {
        const rc = config.repos.find((r) => r.name === candidate.repo);
        if (!rc?.localPath) continue;

        const { template, startCommand, slug } = resolvePhaseConfig(
          rc,
          config,
          candidate.issue.title,
          action.phase,
        );

        if (action.mode === "background") {
          const result = agentSessions.launchAgent({
            localPath: rc.localPath,
            repoFullName: candidate.repo,
            issueNumber: candidate.issue.number,
            issueTitle: candidate.issue.title,
            issueUrl: candidate.issue.url,
            phase: action.phase,
            promptTemplate: template,
            promptVariables: { slug, phase: action.phase, repo: candidate.repo },
            ...(startCommand ? { startCommand } : {}),
          });
          if (typeof result === "string") launched++;
        } else {
          // Interactive: launch first only
          const result = launchClaude({
            localPath: rc.localPath,
            issue: {
              number: candidate.issue.number,
              title: candidate.issue.title,
              url: candidate.issue.url,
            },
            ...(startCommand ? { startCommand } : {}),
            launchMode: config.board.claudeLaunchMode ?? "auto",
            ...(config.board.claudeTerminalApp
              ? { terminalApp: config.board.claudeTerminalApp }
              : {}),
            repoFullName: candidate.repo,
            promptTemplate: template,
            promptVariables: { slug, phase: action.phase, repo: candidate.repo },
          });
          if (result.ok) {
            workflowState.recordSession({
              repo: candidate.repo,
              issueNumber: candidate.issue.number,
              phase: action.phase,
              mode: "interactive",
              startedAt: new Date().toISOString(),
            });
            launched++;
          }
          break; // Only one interactive launch
        }
      }

      if (launched > 0) {
        toast.info(`Launched ${launched} ${action.phase} agent${launched > 1 ? "s" : ""}`);
      }
      ui.exitOverlay();
    },
    [config, agentSessions, workflowState, nudges, toast, ui],
  );

  return {
    handleLaunchClaude,
    handleEnterWorkflow,
    handleWorkflowAction,
    handleTriageAction,
  };
}
