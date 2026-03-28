import type { HogConfig, RepoConfig } from "../config.js";
import type { AgentSession, EnrichmentData } from "../enrichment.js";
import {
  findActiveSession,
  findSessions,
  loadEnrichment,
  saveEnrichment,
  upsertSession,
} from "../enrichment.js";
import type { EventBus } from "./event-bus.js";

// ── Types ──

export interface PhaseStatus {
  readonly name: string;
  readonly state: "pending" | "active" | "completed";
  readonly session?: AgentSession | undefined;
}

export interface IssueWorkflowState {
  readonly phases: PhaseStatus[];
  readonly activeSession?: AgentSession | undefined;
  readonly latestSessionId?: string | undefined;
}

// ── Pure helpers ──

export function resolvePhases(_config: HogConfig, _repoConfig?: RepoConfig): string[] {
  return ["brainstorm", "stories", "test", "impl", "redteam", "merge"];
}

export function derivePhaseStatus(phaseName: string, sessions: AgentSession[]): PhaseStatus {
  const phaseSessions = sessions.filter((s) => s.phase === phaseName);
  if (phaseSessions.length === 0) {
    return { name: phaseName, state: "pending" };
  }

  const active = phaseSessions.find((s) => !s.exitedAt);
  if (active) {
    return { name: phaseName, state: "active", session: active };
  }

  const completed = phaseSessions.find((s) => s.exitCode === 0);
  if (completed) {
    return { name: phaseName, state: "completed", session: completed };
  }

  const latest = [...phaseSessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return { name: phaseName, state: "pending", session: latest };
}

// ── WorkflowEngine ──

export class WorkflowEngine {
  private enrichment: EnrichmentData;
  private readonly config: HogConfig;
  private readonly eventBus: EventBus;

  constructor(config: HogConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
    this.enrichment = loadEnrichment();
  }

  getEnrichment(): EnrichmentData {
    return this.enrichment;
  }

  reload(): void {
    this.enrichment = loadEnrichment();
  }

  updateEnrichment(data: EnrichmentData): void {
    this.enrichment = data;
    saveEnrichment(data);
  }

  getIssueWorkflow(repo: string, issueNumber: number, repoConfig?: RepoConfig): IssueWorkflowState {
    const phaseNames = resolvePhases(this.config, repoConfig);
    const sessions = findSessions(this.enrichment, repo, issueNumber);
    const phases = phaseNames.map((name) => derivePhaseStatus(name, sessions));
    const activeSession = findActiveSession(this.enrichment, repo, issueNumber);
    const allSessions = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const latestSessionId = allSessions[0]?.claudeSessionId;

    return { phases, activeSession, latestSessionId };
  }

  recordSession(session: Omit<AgentSession, "id">): AgentSession {
    const result = upsertSession(this.enrichment, session);
    this.enrichment = result.data;
    saveEnrichment(result.data);

    this.eventBus.emit("workflow:phase-changed", {
      repo: result.session.repo,
      issueNumber: result.session.issueNumber,
      phase: result.session.phase,
      state: result.session.exitedAt
        ? result.session.exitCode === 0
          ? "completed"
          : "pending"
        : "active",
      session: result.session,
    });

    return result.session;
  }

  markSessionExited(sessionId: string, exitCode: number): void {
    const session = this.enrichment.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const result = upsertSession(this.enrichment, {
      ...session,
      exitedAt: new Date().toISOString(),
      exitCode,
    });
    this.enrichment = result.data;
    saveEnrichment(result.data);

    this.eventBus.emit("workflow:phase-changed", {
      repo: session.repo,
      issueNumber: session.issueNumber,
      phase: session.phase,
      state: exitCode === 0 ? "completed" : "pending",
      session: result.session,
    });
  }
}
