/**
 * Append-only event log — writes every EventBus event to a JSONL file.
 *
 * File: ~/.config/hog/pipelines/<featureId>.events.jsonl
 * Schema: { timestamp, event, data } per line.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../config.js";
import type { EngineEvents, EventBus } from "../engine/event-bus.js";

const LOG_DIR = join(CONFIG_DIR, "pipelines");

export interface EventLogEntry {
  readonly timestamp: string;
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/**
 * Start logging all EventBus events to per-pipeline JSONL files.
 *
 * @param resolveFeatureId — maps sessionId → featureId so events route to the right file.
 *   Falls back to shared events.jsonl when featureId can't be resolved.
 */
export function startEventLog(
  eventBus: EventBus,
  resolveFeatureId?: (sessionId: string) => string | undefined,
): void {
  mkdirSync(LOG_DIR, { recursive: true });

  const logEvent = <K extends keyof EngineEvents>(eventName: K): void => {
    eventBus.on(eventName, (payload) => {
      const data = payload as Record<string, unknown>;
      const entry: EventLogEntry = {
        timestamp: new Date().toISOString(),
        event: eventName,
        data,
      };
      const line = `${JSON.stringify(entry)}\n`;

      // Route to per-pipeline file when possible, shared file as fallback
      const sessionId = data["sessionId"] as string | undefined;
      const featureId =
        (data["featureId"] as string | undefined) ??
        (sessionId && resolveFeatureId ? resolveFeatureId(sessionId) : undefined);

      const logFile = featureId
        ? join(LOG_DIR, `${featureId}.events.jsonl`)
        : join(LOG_DIR, "events.jsonl");

      try {
        appendFileSync(logFile, line, "utf-8");
      } catch {
        // best-effort
      }
    });
  };

  logEvent("agent:spawned");
  logEvent("agent:progress");
  logEvent("agent:completed");
  logEvent("agent:failed");
  logEvent("workflow:phase-changed");
}

/** Read event log entries, optionally filtered. */
export function readEventLog(options?: { featureId?: string; limit?: number }): EventLogEntry[] {
  // Prefer per-pipeline file, fall back to shared log
  const logFile = options?.featureId
    ? join(LOG_DIR, `${options.featureId}.events.jsonl`)
    : join(LOG_DIR, "events.jsonl");

  // If per-pipeline file doesn't exist, try shared file with session filtering (legacy compat)
  const targetFile = existsSync(logFile) ? logFile : join(LOG_DIR, "events.jsonl");
  if (!existsSync(targetFile)) return [];

  try {
    const content = readFileSync(targetFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    let entries: EventLogEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as EventLogEntry);
      } catch {
        // skip malformed lines
      }
    }

    // If reading from shared file with featureId filter, apply session-based matching
    if (options?.featureId && targetFile.endsWith("events.jsonl") && !targetFile.includes(options.featureId)) {
      entries = entries.filter((e) => {
        const sessionId = e.data["sessionId"] as string | undefined;
        return sessionId?.includes(options.featureId!) ?? false;
      });
    }

    // Limit
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  } catch {
    return [];
  }
}

/** Get summary stats from an event log for a pipeline. */
export function summarizeEventLog(entries: EventLogEntry[]): {
  phaseCount: number;
  agentCount: number;
  totalDurationMs: number;
  phases: Array<{ phase: string; durationMs: number; tools: string[] }>;
} {
  const phases = new Map<string, { startMs: number; endMs: number; tools: Set<string> }>();
  let agentCount = 0;

  for (const entry of entries) {
    const phase = entry.data["phase"] as string | undefined;
    const ts = new Date(entry.timestamp).getTime();

    if (entry.event === "agent:spawned" && phase) {
      agentCount++;
      if (!phases.has(phase)) {
        phases.set(phase, { startMs: ts, endMs: ts, tools: new Set() });
      }
    }

    if (entry.event === "agent:progress" && phase) {
      const existing = phases.get(phase);
      if (existing) {
        existing.endMs = ts;
        const tool = entry.data["toolName"] as string | undefined;
        if (tool) existing.tools.add(tool);
      }
    }

    if ((entry.event === "agent:completed" || entry.event === "agent:failed") && phase) {
      const existing = phases.get(phase);
      if (existing) existing.endMs = ts;
    }
  }

  const phaseList = [...phases.entries()].map(([phase, info]) => ({
    phase,
    durationMs: info.endMs - info.startMs,
    tools: [...info.tools],
  }));

  const first = entries[0];
  const last = entries[entries.length - 1];
  const totalDurationMs =
    first && last ? new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime() : 0;

  return {
    phaseCount: phases.size,
    agentCount,
    totalDurationMs,
    phases: phaseList,
  };
}
