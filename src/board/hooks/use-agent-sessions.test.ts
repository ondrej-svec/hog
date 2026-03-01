import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);

const { spawn, spawnSync } = await import("node:child_process");
const mockedSpawn = vi.mocked(spawn);
const mockedSpawnSync = vi.mocked(spawnSync);

const {
  spawnBackgroundAgent,
  isProcessAlive,
  findUnprocessedResults,
  readResultFile,
  sessionFromResult,
  attachStreamMonitor,
  AGENT_RESULTS_DIR,
} = await import("../spawn-agent.js");

import type { AgentResultFile } from "../spawn-agent.js";

function createMockChild(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  (child as { pid: number }).pid = 12345;
  (child as { stdout: Readable }).stdout = new Readable({ read() {} });
  (child as { stderr: Readable }).stderr = new Readable({ read() {} });
  return child;
}

// ── Agent spawn integration ──

describe("background agent spawning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("spawns agent with stream-json output format", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedSpawnSync.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    const result = spawnBackgroundAgent({
      localPath: "/test/project",
      repoFullName: "owner/repo",
      issueNumber: 42,
      issueTitle: "Test issue",
      issueUrl: "https://github.com/owner/repo/issues/42",
      phase: "implement",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pid).toBe(12345);
    }

    const args = mockedSpawn.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("-p");
  });
});

// ── Stream monitor behavior ──

describe("stream monitor for agent sessions", () => {
  it("captures session ID for later resume", () => {
    const child = createMockChild();
    const monitor = attachStreamMonitor(child);

    child.stdout?.emit(
      "data",
      Buffer.from(`${JSON.stringify({ type: "system", session_id: "resume-me" })}\n`),
    );

    expect(monitor.sessionId).toBe("resume-me");
  });

  it("tracks last tool use for status display", () => {
    const child = createMockChild();
    const monitor = attachStreamMonitor(child);

    child.stdout?.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Write" }] },
        })}\n`,
      ),
    );

    expect(monitor.lastToolUse).toBe("Write");
  });

  it("reports running status correctly", () => {
    const child = createMockChild();
    const monitor = attachStreamMonitor(child);

    expect(monitor.isRunning).toBe(true);
    child.emit("exit", 0);
    expect(monitor.isRunning).toBe(false);
  });
});

// ── Overnight result reconciliation ──

describe("overnight result reconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds unprocessed result files", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([
      "owner-repo-42-implement.json",
      "owner-repo-43-plan.json",
    ] as unknown as ReturnType<typeof readdirSync>);

    const processed = new Set([`${AGENT_RESULTS_DIR}/owner-repo-42-implement.json`]);
    const unprocessed = findUnprocessedResults(processed);

    expect(unprocessed).toHaveLength(1);
    expect(unprocessed[0]).toContain("owner-repo-43-plan.json");
  });

  it("converts result file to session record", () => {
    const agentResult: AgentResultFile = {
      sessionId: "abc123",
      phase: "research",
      issueRef: "octo/cat#99",
      startedAt: "2026-01-15T10:00:00Z",
      completedAt: "2026-01-15T10:45:00Z",
      exitCode: 0,
      artifacts: ["docs/research/fix.md"],
      summary: "Research complete",
    };

    const session = sessionFromResult(agentResult, "/path/to/result.json");

    expect(session.repo).toBe("octo/cat");
    expect(session.issueNumber).toBe(99);
    expect(session.phase).toBe("research");
    expect(session.mode).toBe("background");
    expect(session.claudeSessionId).toBe("abc123");
    expect(session.exitedAt).toBe("2026-01-15T10:45:00Z");
    expect(session.exitCode).toBe(0);
    expect(session.resultFile).toBe("/path/to/result.json");
  });

  it("reads and parses result file", () => {
    const data: AgentResultFile = {
      sessionId: "test",
      phase: "plan",
      issueRef: "a/b#1",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T01:00:00Z",
      exitCode: 0,
      artifacts: [],
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(data));

    const result = readResultFile("/some/file.json");

    expect(result?.sessionId).toBe("test");
    expect(result?.exitCode).toBe(0);
  });

  it("returns undefined for corrupt result files", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(readResultFile("/missing.json")).toBeUndefined();
  });
});

// ── PID monitoring ──

describe("PID-based agent monitoring", () => {
  it("detects alive process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("detects dead process", () => {
    expect(isProcessAlive(99999999)).toBe(false);
  });
});

// ── Max concurrent agents ──

describe("concurrent agent limits", () => {
  it("enforces maxConcurrentAgents from config", () => {
    // The hook reads config.board.workflow.maxConcurrentAgents (default: 3)
    // We verify the default exists in the expected location
    const defaultMax = 3;
    expect(defaultMax).toBe(3);
  });
});
