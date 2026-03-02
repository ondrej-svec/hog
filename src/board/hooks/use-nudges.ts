import { useCallback, useMemo, useRef } from "react";
import type { HogConfig } from "../../config.js";
import type { EnrichmentData } from "../../enrichment.js";
import { isSnoozed, markNudgeShown, snoozeIssue } from "../../enrichment.js";
import type { GitHubIssue } from "../../github.js";
import type { RepoData } from "../fetch.js";

// ── Types ──

export interface NudgeCandidate {
  readonly repo: string;
  readonly issue: GitHubIssue;
  readonly ageDays: number;
  readonly severity: "warning" | "critical";
}

export interface UseNudgesResult {
  /** Issues that are stale and should be nudged. */
  readonly candidates: NudgeCandidate[];
  /** Whether the daily nudge should be shown (first board open today). */
  readonly shouldShowDailyNudge: boolean;
  /** Snooze an issue for N days. */
  readonly snooze: (repo: string, issueNumber: number, days: number) => void;
  /** Dismiss the daily nudge (marks today as shown). */
  readonly dismissNudge: () => void;
}

interface UseNudgesOptions {
  readonly config: HogConfig;
  readonly repos: RepoData[];
  readonly enrichment: EnrichmentData;
  readonly onEnrichmentChange: (data: EnrichmentData) => void;
}

// ── Hook ──

export function useNudges({
  config,
  repos,
  enrichment,
  onEnrichmentChange,
}: UseNudgesOptions): UseNudgesResult {
  const enrichmentRef = useRef(enrichment);
  enrichmentRef.current = enrichment;

  const warningDays = config.board.workflow?.staleness?.warningDays ?? 7;
  const criticalDays = config.board.workflow?.staleness?.criticalDays ?? 14;

  const candidates = useMemo((): NudgeCandidate[] => {
    const result: NudgeCandidate[] = [];
    for (const rd of repos) {
      for (const issue of rd.issues) {
        if (isSnoozed(enrichment, rd.repo.name, issue.number)) continue;

        const updatedMs = new Date(issue.updatedAt).getTime();
        const ageDays = Math.floor((Date.now() - updatedMs) / 86_400_000);

        if (ageDays >= warningDays) {
          result.push({
            repo: rd.repo.name,
            issue,
            ageDays,
            severity: ageDays >= criticalDays ? "critical" : "warning",
          });
        }
      }
    }
    return result.sort((a, b) => b.ageDays - a.ageDays);
  }, [repos, enrichment, warningDays, criticalDays]);

  const shouldShowDailyNudge = useMemo((): boolean => {
    if (candidates.length === 0) return false;
    const today = new Date().toISOString().slice(0, 10);
    return enrichment.nudgeState.lastDailyNudge !== today;
  }, [candidates.length, enrichment.nudgeState.lastDailyNudge]);

  const snooze = useCallback(
    (repo: string, issueNumber: number, days: number) => {
      const updated = snoozeIssue(enrichmentRef.current, repo, issueNumber, days);
      enrichmentRef.current = updated;
      onEnrichmentChange(updated);
    },
    [onEnrichmentChange],
  );

  const dismissNudge = useCallback(() => {
    const updated = markNudgeShown(enrichmentRef.current);
    enrichmentRef.current = updated;
    onEnrichmentChange(updated);
  }, [onEnrichmentChange]);

  return { candidates, shouldShowDailyNudge, snooze, dismissNudge };
}
