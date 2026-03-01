import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

// We test the non-hook helpers by importing the module's functions directly
// through enrichment.ts (which the hook uses internally).
// For the hook itself, we'd need React test utilities.
// Here we test the phase resolution logic indirectly through the enrichment module.

const { loadEnrichment, findSessions, findActiveSession } = await import("../../enrichment.js");

import type { AgentSession, EnrichmentData } from "../../enrichment.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

function makeEnrichment(sessions: AgentSession[] = []): EnrichmentData {
  return {
    version: 1,
    sessions,
    nudgeState: { snoozedIssues: {} },
  };
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "test-1",
    repo: "owner/repo",
    issueNumber: 42,
    phase: "brainstorm",
    mode: "interactive",
    startedAt: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

describe("workflow state phase derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty sessions for issue with no sessions", () => {
    const data = makeEnrichment();
    const sessions = findSessions(data, "owner/repo", 42);
    expect(sessions).toEqual([]);
  });

  it("finds sessions for an issue across multiple phases", () => {
    const s1 = makeSession({
      id: "s1",
      phase: "brainstorm",
      exitedAt: "2026-01-15T11:00:00Z",
      exitCode: 0,
    });
    const s2 = makeSession({ id: "s2", phase: "plan" });
    const data = makeEnrichment([s1, s2]);

    const sessions = findSessions(data, "owner/repo", 42);
    expect(sessions).toHaveLength(2);
  });

  it("finds active session (no exitedAt)", () => {
    const active = makeSession({ id: "active", phase: "implement" });
    const done = makeSession({
      id: "done",
      phase: "brainstorm",
      exitedAt: "2026-01-15T11:00:00Z",
      exitCode: 0,
    });
    const data = makeEnrichment([active, done]);

    const result = findActiveSession(data, "owner/repo", 42);
    expect(result?.id).toBe("active");
  });

  it("loads enrichment from file", () => {
    const data = makeEnrichment([makeSession()]);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(data));

    const result = loadEnrichment();
    expect(result.sessions).toHaveLength(1);
  });
});
