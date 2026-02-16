import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "hog");
const STATE_FILE = join(CONFIG_DIR, "sync-state.json");

export interface SyncMapping {
  githubRepo: string;
  githubIssueNumber: number;
  githubUrl: string;
  ticktickTaskId: string;
  ticktickProjectId: string;
  githubUpdatedAt: string;
  lastSyncedAt: string;
}

export interface SyncState {
  mappings: SyncMapping[];
  lastSyncAt?: string;
}

export function loadSyncState(): SyncState {
  if (!existsSync(STATE_FILE)) return { mappings: [] };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as SyncState;
  } catch {
    return { mappings: [] };
  }
}

export function saveSyncState(state: SyncState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export function findMapping(
  state: SyncState,
  githubRepo: string,
  issueNumber: number,
): SyncMapping | undefined {
  return state.mappings.find(
    (m) => m.githubRepo === githubRepo && m.githubIssueNumber === issueNumber,
  );
}

export function findMappingByTaskId(
  state: SyncState,
  ticktickTaskId: string,
): SyncMapping | undefined {
  return state.mappings.find((m) => m.ticktickTaskId === ticktickTaskId);
}

export function upsertMapping(state: SyncState, mapping: SyncMapping): void {
  const idx = state.mappings.findIndex(
    (m) => m.githubRepo === mapping.githubRepo && m.githubIssueNumber === mapping.githubIssueNumber,
  );
  if (idx >= 0) {
    state.mappings[idx] = mapping;
  } else {
    state.mappings.push(mapping);
  }
}

export function removeMapping(state: SyncState, githubRepo: string, issueNumber: number): void {
  state.mappings = state.mappings.filter(
    (m) => !(m.githubRepo === githubRepo && m.githubIssueNumber === issueNumber),
  );
}
