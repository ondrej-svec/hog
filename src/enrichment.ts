import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG_DIR } from "./config.js";

const ENRICHMENT_FILE = join(CONFIG_DIR, "enrichment.json");

// ── Schemas ──

const AGENT_SESSION_SCHEMA = z.object({
  id: z.string(),
  repo: z.string(),
  issueNumber: z.number(),
  phase: z.string(),
  mode: z.enum(["interactive", "background"]),
  claudeSessionId: z.string().optional(),
  pid: z.number().optional(),
  startedAt: z.string(),
  exitedAt: z.string().optional(),
  exitCode: z.number().optional(),
  resultFile: z.string().optional(),
});

const NUDGE_STATE_SCHEMA = z.object({
  lastDailyNudge: z.string().optional(),
  snoozedIssues: z.record(z.string(), z.string()).default({}),
});

const ENRICHMENT_SCHEMA = z.object({
  version: z.literal(1),
  sessions: z.array(AGENT_SESSION_SCHEMA).default([]),
  nudgeState: NUDGE_STATE_SCHEMA.default({ snoozedIssues: {} }),
});

export type AgentSession = z.infer<typeof AGENT_SESSION_SCHEMA>;
export type NudgeState = z.infer<typeof NUDGE_STATE_SCHEMA>;
export type EnrichmentData = z.infer<typeof ENRICHMENT_SCHEMA>;

// ── I/O ──

const EMPTY_ENRICHMENT: EnrichmentData = {
  version: 1,
  sessions: [],
  nudgeState: { snoozedIssues: {} },
};

export function loadEnrichment(): EnrichmentData {
  if (!existsSync(ENRICHMENT_FILE)) return { ...EMPTY_ENRICHMENT, sessions: [] };
  try {
    const raw: unknown = JSON.parse(readFileSync(ENRICHMENT_FILE, "utf-8"));
    const result = ENRICHMENT_SCHEMA.safeParse(raw);
    return result.success ? result.data : { ...EMPTY_ENRICHMENT, sessions: [] };
  } catch {
    return { ...EMPTY_ENRICHMENT, sessions: [] };
  }
}

/** Atomic write: write to tmp file then rename. */
export function saveEnrichment(data: EnrichmentData): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${ENRICHMENT_FILE}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, ENRICHMENT_FILE);
}

// ── Session helpers ──

/** Generate a unique session ID. */
function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Insert or update a session. Matches on id if existing, otherwise appends. */
export function upsertSession(
  data: EnrichmentData,
  session: Omit<AgentSession, "id"> & { id?: string | undefined },
): { data: EnrichmentData; session: AgentSession } {
  const id = session.id ?? generateSessionId();
  const full: AgentSession = { ...session, id };
  const idx = data.sessions.findIndex((s) => s.id === id);
  const sessions = [...data.sessions];
  if (idx >= 0) {
    sessions[idx] = full;
  } else {
    sessions.push(full);
  }
  return { data: { ...data, sessions }, session: full };
}

/** Find sessions for a specific issue. */
export function findSessions(
  data: EnrichmentData,
  repo: string,
  issueNumber: number,
): AgentSession[] {
  return data.sessions.filter((s) => s.repo === repo && s.issueNumber === issueNumber);
}

/** Find sessions for a specific issue and phase. */
export function findSession(
  data: EnrichmentData,
  repo: string,
  issueNumber: number,
  phase: string,
): AgentSession | undefined {
  return data.sessions.find(
    (s) => s.repo === repo && s.issueNumber === issueNumber && s.phase === phase,
  );
}

/** Find an active (not exited) session for an issue. */
export function findActiveSession(
  data: EnrichmentData,
  repo: string,
  issueNumber: number,
): AgentSession | undefined {
  return data.sessions.find((s) => s.repo === repo && s.issueNumber === issueNumber && !s.exitedAt);
}

/** Find the most recent session for an issue (by startedAt). */
export function findLatestSession(
  data: EnrichmentData,
  repo: string,
  issueNumber: number,
): AgentSession | undefined {
  const sessions = findSessions(data, repo, issueNumber);
  if (sessions.length === 0) return undefined;
  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

// ── Nudge helpers ──

/** Build a snooze key for an issue. */
export function snoozeKey(repo: string, issueNumber: number): string {
  return `${repo}#${issueNumber}`;
}

/** Check if an issue is currently snoozed. */
export function isSnoozed(data: EnrichmentData, repo: string, issueNumber: number): boolean {
  const key = snoozeKey(repo, issueNumber);
  const until = data.nudgeState.snoozedIssues[key];
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

/** Snooze an issue for the given number of days. */
export function snoozeIssue(
  data: EnrichmentData,
  repo: string,
  issueNumber: number,
  days: number,
): EnrichmentData {
  const key = snoozeKey(repo, issueNumber);
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  return {
    ...data,
    nudgeState: {
      ...data.nudgeState,
      snoozedIssues: { ...data.nudgeState.snoozedIssues, [key]: until },
    },
  };
}

/** Mark the daily nudge as shown today. */
export function markNudgeShown(data: EnrichmentData): EnrichmentData {
  return {
    ...data,
    nudgeState: {
      ...data.nudgeState,
      lastDailyNudge: new Date().toISOString().slice(0, 10),
    },
  };
}
