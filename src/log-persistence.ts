import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOG_FILE = join(homedir(), ".config", "hog", "action-log.json");
const MAX_ENTRIES = 1000;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export interface PersistedLogEntry {
  readonly id: string;
  readonly description: string;
  readonly status: "success" | "error" | "pending";
  readonly timestamp: number;
  readonly repo?: string;
}

function readLog(): PersistedLogEntry[] {
  if (!existsSync(LOG_FILE)) return [];
  try {
    const raw = readFileSync(LOG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersistedLogEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLog(entries: PersistedLogEntry[]): void {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function appendActionLog(entry: PersistedLogEntry): void {
  // Check size and rotate if needed
  if (existsSync(LOG_FILE)) {
    const stats = statSync(LOG_FILE);
    if (stats.size > MAX_SIZE_BYTES) {
      truncateSync(LOG_FILE, 0);
    }
  }
  const entries = readLog();
  entries.push(entry);
  // Keep only last MAX_ENTRIES
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  writeLog(entries);
}

export function getActionLog(limit = 50): PersistedLogEntry[] {
  const entries = readLog();
  return entries.slice(-limit);
}

export function clearActionLog(): void {
  writeLog([]);
}
