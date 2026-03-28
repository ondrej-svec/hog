import { describe, expect, it } from "vitest";
import type { EventLogEntry } from "./event-log.js";
import { summarizeEventLog } from "./event-log.js";

describe("summarizeEventLog", () => {
  it("calculates phase count and agent count", () => {
    const entries: EventLogEntry[] = [
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        event: "agent:spawned",
        data: { sessionId: "s1", phase: "stories" },
      },
      {
        timestamp: "2026-01-01T00:01:00.000Z",
        event: "agent:progress",
        data: { sessionId: "s1", phase: "stories", toolName: "Read" },
      },
      {
        timestamp: "2026-01-01T00:02:00.000Z",
        event: "agent:completed",
        data: { sessionId: "s1", phase: "stories" },
      },
      {
        timestamp: "2026-01-01T00:03:00.000Z",
        event: "agent:spawned",
        data: { sessionId: "s2", phase: "impl" },
      },
      {
        timestamp: "2026-01-01T00:05:00.000Z",
        event: "agent:completed",
        data: { sessionId: "s2", phase: "impl" },
      },
    ];

    const summary = summarizeEventLog(entries);
    expect(summary.phaseCount).toBe(2);
    expect(summary.agentCount).toBe(2);
    expect(summary.totalDurationMs).toBe(5 * 60 * 1000);
    expect(summary.phases).toHaveLength(2);
  });

  it("tracks tools used per phase", () => {
    const entries: EventLogEntry[] = [
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        event: "agent:spawned",
        data: { sessionId: "s1", phase: "impl" },
      },
      {
        timestamp: "2026-01-01T00:00:01.000Z",
        event: "agent:progress",
        data: { sessionId: "s1", phase: "impl", toolName: "Read" },
      },
      {
        timestamp: "2026-01-01T00:00:02.000Z",
        event: "agent:progress",
        data: { sessionId: "s1", phase: "impl", toolName: "Edit" },
      },
      {
        timestamp: "2026-01-01T00:00:03.000Z",
        event: "agent:completed",
        data: { sessionId: "s1", phase: "impl" },
      },
    ];

    const summary = summarizeEventLog(entries);
    const implPhase = summary.phases.find((p) => p.phase === "impl");
    expect(implPhase?.tools).toContain("Read");
    expect(implPhase?.tools).toContain("Edit");
  });

  it("returns empty summary for no entries", () => {
    const summary = summarizeEventLog([]);
    expect(summary.phaseCount).toBe(0);
    expect(summary.agentCount).toBe(0);
    expect(summary.totalDurationMs).toBe(0);
  });
});
