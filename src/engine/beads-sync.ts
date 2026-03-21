import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG_DIR } from "../config.js";

// ── Sync State ──

const SYNC_FILE = join(CONFIG_DIR, "beads-sync.json");

const SYNC_ENTRY_SCHEMA = z.object({
  githubRepo: z.string(),
  githubIssueNumber: z.number(),
  beadId: z.string(),
  lastSyncedAt: z.string(),
});

const SYNC_STATE_SCHEMA = z.object({
  version: z.literal(1),
  entries: z.array(SYNC_ENTRY_SCHEMA).default([]),
});

export type SyncEntry = z.infer<typeof SYNC_ENTRY_SCHEMA>;
export type BeadsSyncState = z.infer<typeof SYNC_STATE_SCHEMA>;

const EMPTY_STATE: BeadsSyncState = { version: 1, entries: [] };

// ── I/O ──

export function loadBeadsSyncState(): BeadsSyncState {
  if (!existsSync(SYNC_FILE)) return { ...EMPTY_STATE, entries: [] };
  try {
    const raw: unknown = JSON.parse(readFileSync(SYNC_FILE, "utf-8"));
    const result = SYNC_STATE_SCHEMA.safeParse(raw);
    return result.success ? result.data : { ...EMPTY_STATE, entries: [] };
  } catch {
    return { ...EMPTY_STATE, entries: [] };
  }
}

export function saveBeadsSyncState(state: BeadsSyncState): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${SYNC_FILE}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, SYNC_FILE);
}

// ── Helpers ──

/** Find the bead ID for a GitHub issue. */
export function findBeadId(
  state: BeadsSyncState,
  repo: string,
  issueNumber: number,
): string | undefined {
  return state.entries.find((e) => e.githubRepo === repo && e.githubIssueNumber === issueNumber)
    ?.beadId;
}

/** Find the GitHub issue for a bead ID. */
export function findGitHubIssue(
  state: BeadsSyncState,
  beadId: string,
): { repo: string; issueNumber: number } | undefined {
  const entry = state.entries.find((e) => e.beadId === beadId);
  if (!entry) return undefined;
  return { repo: entry.githubRepo, issueNumber: entry.githubIssueNumber };
}

/** Link a GitHub issue to a bead. */
export function linkIssueToBead(
  state: BeadsSyncState,
  repo: string,
  issueNumber: number,
  beadId: string,
): BeadsSyncState {
  const now = new Date().toISOString();
  const idx = state.entries.findIndex(
    (e) => e.githubRepo === repo && e.githubIssueNumber === issueNumber,
  );

  const entry: SyncEntry = {
    githubRepo: repo,
    githubIssueNumber: issueNumber,
    beadId,
    lastSyncedAt: now,
  };

  const entries = [...state.entries];
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  return { ...state, entries };
}

/** Remove a link by GitHub issue. */
export function unlinkIssue(
  state: BeadsSyncState,
  repo: string,
  issueNumber: number,
): BeadsSyncState {
  return {
    ...state,
    entries: state.entries.filter(
      (e) => !(e.githubRepo === repo && e.githubIssueNumber === issueNumber),
    ),
  };
}
