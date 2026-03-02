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

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedRenameSync = vi.mocked(renameSync);

const {
  loadEnrichment,
  saveEnrichment,
  upsertSession,
  findSession,
  findSessions,
  findActiveSession,
} = await import("./enrichment.js");

import type { AgentSession, EnrichmentData } from "./enrichment.js";

function makeEnrichment(sessions: AgentSession[] = []): EnrichmentData {
  return {
    version: 1,
    sessions,
    nudgeState: { snoozedIssues: {} },
  };
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "test-session-1",
    repo: "owner/repo",
    issueNumber: 42,
    phase: "brainstorm",
    mode: "interactive",
    startedAt: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

describe("loadEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty enrichment when file does not exist", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = loadEnrichment();

    expect(result.version).toBe(1);
    expect(result.sessions).toEqual([]);
    expect(result.nudgeState).toEqual({ snoozedIssues: {} });
  });

  it("parses valid enrichment file", () => {
    const data = makeEnrichment([makeSession()]);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(data));

    const result = loadEnrichment();

    expect(result.version).toBe(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.id).toBe("test-session-1");
  });

  it("returns empty enrichment on malformed JSON", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("{ not valid json {{");

    const result = loadEnrichment();

    expect(result.version).toBe(1);
    expect(result.sessions).toEqual([]);
  });

  it("returns empty enrichment when schema validation fails", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ version: 999, sessions: "invalid" }));

    const result = loadEnrichment();

    expect(result.version).toBe(1);
    expect(result.sessions).toEqual([]);
  });
});

describe("saveEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes atomically via tmp file + rename", () => {
    const data = makeEnrichment();

    saveEnrichment(data);

    expect(mkdirSync).toHaveBeenCalled();
    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = mockedWriteFileSync.mock.calls[0]?.[0] as string;
    expect(writtenPath).toContain("enrichment.json.tmp");
    expect(mockedRenameSync).toHaveBeenCalledTimes(1);
  });

  it("writes valid JSON content", () => {
    const session = makeSession();
    const data = makeEnrichment([session]);

    saveEnrichment(data);

    const written = mockedWriteFileSync.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.version).toBe(1);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].id).toBe("test-session-1");
  });

  it("sets file mode to 0o600", () => {
    saveEnrichment(makeEnrichment());

    const opts = mockedWriteFileSync.mock.calls[0]?.[2] as { mode: number };
    expect(opts.mode).toBe(0o600);
  });
});

describe("upsertSession", () => {
  it("appends a new session with generated id", () => {
    const data = makeEnrichment();

    const result = upsertSession(data, {
      repo: "owner/repo",
      issueNumber: 42,
      phase: "brainstorm",
      mode: "interactive",
      startedAt: "2026-01-15T10:00:00Z",
    });

    expect(result.data.sessions).toHaveLength(1);
    expect(result.session.id).toBeTruthy();
    expect(result.session.repo).toBe("owner/repo");
  });

  it("updates an existing session by id", () => {
    const existing = makeSession({ id: "session-1", phase: "brainstorm" });
    const data = makeEnrichment([existing]);

    const result = upsertSession(data, {
      id: "session-1",
      repo: "owner/repo",
      issueNumber: 42,
      phase: "brainstorm",
      mode: "interactive",
      startedAt: "2026-01-15T10:00:00Z",
      exitedAt: "2026-01-15T10:30:00Z",
      exitCode: 0,
    });

    expect(result.data.sessions).toHaveLength(1);
    expect(result.session.exitedAt).toBe("2026-01-15T10:30:00Z");
    expect(result.session.exitCode).toBe(0);
  });

  it("preserves other sessions when updating", () => {
    const s1 = makeSession({ id: "s1", issueNumber: 1 });
    const s2 = makeSession({ id: "s2", issueNumber: 2 });
    const data = makeEnrichment([s1, s2]);

    const result = upsertSession(data, {
      id: "s1",
      repo: "owner/repo",
      issueNumber: 1,
      phase: "plan",
      mode: "background",
      startedAt: "2026-01-15T11:00:00Z",
    });

    expect(result.data.sessions).toHaveLength(2);
    expect(result.data.sessions[0]?.phase).toBe("plan");
    expect(result.data.sessions[1]?.id).toBe("s2");
  });
});

describe("findSession", () => {
  it("finds a session by repo, issueNumber, and phase", () => {
    const s = makeSession({ repo: "a/b", issueNumber: 10, phase: "plan" });
    const data = makeEnrichment([s]);

    const result = findSession(data, "a/b", 10, "plan");

    expect(result?.id).toBe("test-session-1");
  });

  it("returns undefined when no match", () => {
    const data = makeEnrichment([makeSession()]);

    expect(findSession(data, "a/b", 999, "plan")).toBeUndefined();
  });
});

describe("findSessions", () => {
  it("finds all sessions for a repo and issue", () => {
    const s1 = makeSession({ id: "s1", phase: "brainstorm" });
    const s2 = makeSession({ id: "s2", phase: "plan" });
    const s3 = makeSession({ id: "s3", issueNumber: 99, phase: "plan" });
    const data = makeEnrichment([s1, s2, s3]);

    const result = findSessions(data, "owner/repo", 42);

    expect(result).toHaveLength(2);
  });
});

describe("findActiveSession", () => {
  it("finds session without exitedAt", () => {
    const active = makeSession({ id: "active" });
    const exited = makeSession({ id: "exited", exitedAt: "2026-01-15T11:00:00Z" });
    const data = makeEnrichment([active, exited]);

    const result = findActiveSession(data, "owner/repo", 42);

    expect(result?.id).toBe("active");
  });

  it("returns undefined when all sessions have exited", () => {
    const s = makeSession({ exitedAt: "2026-01-15T11:00:00Z" });
    const data = makeEnrichment([s]);

    expect(findActiveSession(data, "owner/repo", 42)).toBeUndefined();
  });

  it("returns undefined for empty sessions", () => {
    const data = makeEnrichment();

    expect(findActiveSession(data, "owner/repo", 42)).toBeUndefined();
  });
});
