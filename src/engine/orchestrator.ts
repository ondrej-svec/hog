import { DEFAULT_PHASE_PROMPTS, launchClaude } from "../board/launch-claude.js";
import type { SpawnAgentOptions } from "../board/spawn-agent.js";
import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentManager } from "./agent-manager.js";
import type { EventBus } from "./event-bus.js";
import type { WorkflowEngine } from "./workflow.js";

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

// ── Types ──

export interface LaunchIssueContext {
  readonly repoName: string;
  readonly repoConfig: RepoConfig;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly issueUrl: string;
}

// ── Orchestrator ──

export class Orchestrator {
  private readonly config: HogConfig;
  private readonly eventBus: EventBus;
  private readonly agentManager: AgentManager;
  private readonly workflow: WorkflowEngine;

  constructor(
    config: HogConfig,
    eventBus: EventBus,
    agentManager: AgentManager,
    workflow: WorkflowEngine,
  ) {
    this.config = config;
    this.eventBus = eventBus;
    this.agentManager = agentManager;
    this.workflow = workflow;
  }

  /** Launch Claude Code interactively for an issue. */
  launchInteractive(
    ctx: LaunchIssueContext,
    phase?: string,
    promptTemplate?: string,
  ): { ok: true } | { ok: false; error: string } {
    const rc = ctx.repoConfig;

    if (!rc.localPath) {
      return {
        ok: false,
        error: `Set localPath for ${rc.shortName ?? ctx.repoName} to enable Claude Code launch`,
      };
    }

    const resolvedStartCommand = rc.claudeStartCommand ?? this.config.board.claudeStartCommand;
    const resolvedPromptTemplate =
      promptTemplate ?? rc.claudePrompt ?? this.config.board.claudePrompt;

    const result = launchClaude({
      localPath: rc.localPath,
      issue: { number: ctx.issueNumber, title: ctx.issueTitle, url: ctx.issueUrl },
      ...(resolvedStartCommand ? { startCommand: resolvedStartCommand } : {}),
      ...(resolvedPromptTemplate ? { promptTemplate: resolvedPromptTemplate } : {}),
      launchMode: this.config.board.claudeLaunchMode ?? "auto",
      ...(this.config.board.claudeTerminalApp
        ? { terminalApp: this.config.board.claudeTerminalApp }
        : {}),
      repoFullName: ctx.repoName,
    });

    if (!result.ok) {
      return { ok: false, error: result.error.message };
    }

    // Record interactive session in enrichment
    if (phase) {
      this.workflow.recordSession({
        repo: ctx.repoName,
        issueNumber: ctx.issueNumber,
        phase,
        mode: "interactive",
        startedAt: new Date().toISOString(),
      });
    }

    return { ok: true };
  }

  /** Launch a background agent for a workflow phase. */
  launchPhaseAgent(ctx: LaunchIssueContext, phase: string): string | { error: string } {
    const rc = ctx.repoConfig;

    if (!rc.localPath) {
      return {
        error: `Set localPath for ${rc.shortName ?? ctx.repoName} to enable Claude Code launch`,
      };
    }

    const { template, startCommand, slug } = resolvePhaseConfig(
      rc,
      this.config,
      ctx.issueTitle,
      phase,
    );

    const opts: SpawnAgentOptions = {
      localPath: rc.localPath,
      repoFullName: ctx.repoName,
      issueNumber: ctx.issueNumber,
      issueTitle: ctx.issueTitle,
      issueUrl: ctx.issueUrl,
      phase,
      promptTemplate: template,
      promptVariables: { slug, phase, repo: ctx.repoName },
      ...(startCommand ? { startCommand } : {}),
    };

    return this.agentManager.launchAgent(opts);
  }

  /** Resume a Claude Code session interactively. */
  resumeSession(
    ctx: LaunchIssueContext,
    sessionId: string,
  ): { ok: true } | { ok: false; error: string } {
    return this.launchInteractive(ctx, undefined, `--resume ${sessionId}`);
  }
}
