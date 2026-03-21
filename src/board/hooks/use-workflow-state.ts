import { useCallback, useRef, useState } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import type { IssueWorkflowState } from "../../engine/workflow.js";
import { derivePhaseStatus, resolvePhases } from "../../engine/workflow.js";
import type { AgentSession, EnrichmentData } from "../../enrichment.js";
import {
  findActiveSession,
  findSessions,
  loadEnrichment,
  saveEnrichment,
  upsertSession,
} from "../../enrichment.js";

// Re-export types from engine so existing consumers don't break
export type { IssueWorkflowState, PhaseStatus } from "../../engine/workflow.js";

export interface UseWorkflowStateResult {
  readonly enrichment: EnrichmentData;
  /** Get workflow state for a specific issue. */
  readonly getIssueWorkflow: (
    repo: string,
    issueNumber: number,
    repoConfig?: RepoConfig,
  ) => IssueWorkflowState;
  /** Record a new session launch. */
  readonly recordSession: (session: Omit<AgentSession, "id">) => AgentSession;
  /** Mark a session as exited. */
  readonly markSessionExited: (sessionId: string, exitCode: number) => void;
  /** Reload enrichment from disk. */
  readonly reload: () => void;
  /** Update in-memory enrichment state and persist it to disk. */
  readonly updateEnrichment: (data: EnrichmentData) => void;
}

// ── Hook ──

export function useWorkflowState(config: HogConfig): UseWorkflowStateResult {
  const [enrichment, setEnrichment] = useState<EnrichmentData>(loadEnrichment);
  const enrichmentRef = useRef(enrichment);
  enrichmentRef.current = enrichment;

  const reload = useCallback(() => {
    const data = loadEnrichment();
    setEnrichment(data);
    enrichmentRef.current = data;
  }, []);

  const getIssueWorkflow = useCallback(
    (repo: string, issueNumber: number, repoConfig?: RepoConfig): IssueWorkflowState => {
      const phaseNames = resolvePhases(config, repoConfig);
      const sessions = findSessions(enrichmentRef.current, repo, issueNumber);
      const phases = phaseNames.map((name) => derivePhaseStatus(name, sessions));
      const activeSession = findActiveSession(enrichmentRef.current, repo, issueNumber);
      const allSessions = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const latestSessionId = allSessions[0]?.claudeSessionId;

      return { phases, activeSession, latestSessionId };
    },
    [config],
  );

  const recordSession = useCallback((session: Omit<AgentSession, "id">): AgentSession => {
    const result = upsertSession(enrichmentRef.current, session);
    setEnrichment(result.data);
    enrichmentRef.current = result.data;
    saveEnrichment(result.data);
    return result.session;
  }, []);

  const markSessionExited = useCallback((sessionId: string, exitCode: number) => {
    const data = enrichmentRef.current;
    const session = data.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const result = upsertSession(data, {
      ...session,
      exitedAt: new Date().toISOString(),
      exitCode,
    });
    setEnrichment(result.data);
    enrichmentRef.current = result.data;
    saveEnrichment(result.data);
  }, []);

  const updateEnrichment = useCallback((data: EnrichmentData) => {
    setEnrichment(data);
    enrichmentRef.current = data;
    saveEnrichment(data);
  }, []);

  return {
    enrichment,
    getIssueWorkflow,
    recordSession,
    markSessionExited,
    reload,
    updateEnrichment,
  };
}
