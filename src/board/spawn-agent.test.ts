import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

const { spawn, spawnSync } = await import("node:child_process");
const mockedSpawn = vi.mocked(spawn);
const mockedSpawnSync = vi.mocked(spawnSync);

const {
  parseStreamLine,
  buildResultFilePath,
  writeResultFile,
  spawnBackgroundAgent,
  attachStreamMonitor,
  isProcessAlive,
  findUnprocessedResults,
  readResultFile,
  sessionFromResult,
  AGENT_RESULTS_DIR,
} = await import("./spawn-agent.js");

import type { AgentResultFile, SpawnAgentOptions } from "./spawn-agent.js";

function makeSpawnOptions(overrides: Partial<SpawnAgentOptions> = {}): SpawnAgentOptions {
  return {
    localPath: "/test/project",
    repoFullName: "owner/repo",
    issueNumber: 42,
    issueTitle: "Fix auth flow",
    issueUrl: "https://github.com/owner/repo/issues/42",
    phase: "implement",
    ...overrides,
  };
}

function createMockChild(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  (child as { pid: number }).pid = 12345;
  (child as { stdout: Readable }).stdout = new Readable({ read() {} });
  (child as { stderr: Readable }).stderr = new Readable({ read() {} });
  return child;
}

// ── parseStreamLine ──

describe("parseStreamLine", () => {
  it("returns undefined for empty lines", () => {
    expect(parseStreamLine("")).toBeUndefined();
    expect(parseStreamLine("   ")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseStreamLine("not json")).toBeUndefined();
  });

  it("parses system event with session_id", () => {
    const event = parseStreamLine(JSON.stringify({ type: "system", session_id: "abc123" }));
    expect(event).toEqual({ type: "system", sessionId: "abc123" });
  });

  it("parses result event with session_id", () => {
    const event = parseStreamLine(JSON.stringify({ type: "result", session_id: "xyz789" }));
    expect(event).toEqual({ type: "result", sessionId: "xyz789" });
  });

  it("parses assistant text content", () => {
    const event = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello world" }] },
      }),
    );
    expect(event).toEqual({ type: "text", text: "Hello world" });
  });

  it("parses assistant tool_use content", () => {
    const event = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: {} }],
        },
      }),
    );
    expect(event).toEqual({ type: "tool_use", toolName: "Read" });
  });

  it("parses error event", () => {
    const event = parseStreamLine(
      JSON.stringify({ type: "error", error: { message: "rate limit" } }),
    );
    expect(event).toEqual({ type: "error", text: "rate limit" });
  });

  it("returns unknown for unrecognized event types", () => {
    const event = parseStreamLine(JSON.stringify({ type: "something_else" }));
    expect(event).toEqual({ type: "unknown" });
  });
});

// ── buildResultFilePath ──

describe("buildResultFilePath", () => {
  it("builds path with slugified repo name", () => {
    const path = buildResultFilePath("owner/repo", 42, "implement");
    expect(path).toContain("owner-repo-42-implement.json");
    expect(path).toContain("agent-results");
  });
});

// ── writeResultFile ──

describe("writeResultFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates directory and writes JSON", () => {
    const result: AgentResultFile = {
      sessionId: "abc",
      phase: "implement",
      issueRef: "owner/repo#42",
      startedAt: "2026-01-15T10:00:00Z",
      completedAt: "2026-01-15T10:30:00Z",
      exitCode: 0,
      artifacts: [],
    };

    writeResultFile("/test/result.json", result);

    expect(mkdirSync).toHaveBeenCalledWith(AGENT_RESULTS_DIR, { recursive: true });
    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    const written = mockedWriteFileSync.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.sessionId).toBe("abc");
    expect(parsed.exitCode).toBe(0);
  });
});

// ── spawnBackgroundAgent ──

describe("spawnBackgroundAgent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when directory not found", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = spawnBackgroundAgent(makeSpawnOptions());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("directory-not-found");
    }
  });

  it("returns error when claude not in PATH", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedSpawnSync.mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);

    const result = spawnBackgroundAgent(makeSpawnOptions());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("claude-not-found");
    }
  });

  it("spawns claude with correct args", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedSpawnSync.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    const result = spawnBackgroundAgent(makeSpawnOptions());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pid).toBe(12345);
      expect(result.value.resultFilePath).toContain("owner-repo-42-implement.json");
    }

    // Check spawn was called with correct args
    const spawnCall = mockedSpawn.mock.calls[0];
    expect(spawnCall?.[0]).toBe("claude");
    const args = spawnCall?.[1] as string[];
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
  });

  it("uses custom start command when provided", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedSpawnSync.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    spawnBackgroundAgent(
      makeSpawnOptions({
        startCommand: { command: "my-claude", extraArgs: ["--model", "opus"] },
      }),
    );

    const spawnCall = mockedSpawn.mock.calls[0];
    expect(spawnCall?.[0]).toBe("my-claude");
    const args = spawnCall?.[1] as string[];
    expect(args).toContain("--model");
    expect(args).toContain("opus");
  });

  it("returns error when PID is undefined", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedSpawnSync.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

    const mockChild = createMockChild();
    (mockChild as { pid: number | undefined }).pid = undefined;
    mockedSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    const result = spawnBackgroundAgent(makeSpawnOptions());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("spawn-failed");
    }
  });
});

// ── attachStreamMonitor ──

describe("attachStreamMonitor", () => {
  it("captures session ID from system event", () => {
    const child = createMockChild();
    const monitor = attachStreamMonitor(child);

    child.stdout?.emit("data", Buffer.from(`${JSON.stringify({ type: "system", session_id: "sess-1" })}\n`));

    expect(monitor.sessionId).toBe("sess-1");
  });

  it("captures tool use events", () => {
    const child = createMockChild();
    const events: Array<{ type: string }> = [];
    const monitor = attachStreamMonitor(child, (e) => events.push(e));

    child.stdout?.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } })}\n`,
      ),
    );

    expect(monitor.lastToolUse).toBe("Edit");
    expect(events).toHaveLength(1);
  });

  it("calls onExit with exit code", () => {
    const child = createMockChild();
    let exitCalled = false;
    let exitCode = -1;

    attachStreamMonitor(child, undefined, (code) => {
      exitCalled = true;
      exitCode = code;
    });

    child.emit("exit", 0);

    expect(exitCalled).toBe(true);
    expect(exitCode).toBe(0);
  });

  it("handles partial line buffering", () => {
    const child = createMockChild();
    const monitor = attachStreamMonitor(child);

    // Send partial line
    child.stdout?.emit("data", Buffer.from('{"type":"sys'));
    // Complete the line
    child.stdout?.emit("data", Buffer.from(`tem","session_id":"partial-test"}\n`));

    expect(monitor.sessionId).toBe("partial-test");
  });

  it("defaults exit code to 1 when null", () => {
    const child = createMockChild();
    let capturedCode = -1;

    attachStreamMonitor(child, undefined, (code) => {
      capturedCode = code;
    });

    child.emit("exit", null);

    expect(capturedCode).toBe(1);
  });

  it("marks isRunning false after exit", () => {
    const child = createMockChild();
    const monitor = attachStreamMonitor(child);

    expect(monitor.isRunning).toBe(true);
    child.emit("exit", 0);
    expect(monitor.isRunning).toBe(false);
  });
});

// ── isProcessAlive ──

describe("isProcessAlive", () => {
  it("returns true for current process PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for non-existent PID", () => {
    // PID 99999999 is extremely unlikely to exist
    expect(isProcessAlive(99999999)).toBe(false);
  });
});

// ── findUnprocessedResults ──

describe("findUnprocessedResults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty when directory does not exist", () => {
    mockedExistsSync.mockReturnValue(false);

    const results = findUnprocessedResults(new Set());

    expect(results).toEqual([]);
  });

  it("returns JSON files not in processed set", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue(["result-1.json", "result-2.json", "not-json.txt"] as unknown as ReturnType<typeof readdirSync>);

    const processed = new Set([expect.stringContaining("result-1.json") as unknown as string]);
    const results = findUnprocessedResults(new Set());

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.endsWith(".json"))).toBe(true);
  });

  it("filters out already processed files", () => {
    mockedExistsSync.mockReturnValue(true);
    const resultPath = `${AGENT_RESULTS_DIR}/result-1.json`;
    mockedReaddirSync.mockReturnValue(["result-1.json", "result-2.json"] as unknown as ReturnType<typeof readdirSync>);

    const results = findUnprocessedResults(new Set([resultPath]));

    expect(results).toHaveLength(1);
    expect(results[0]).toContain("result-2.json");
  });
});

// ── readResultFile ──

describe("readResultFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses valid result file", () => {
    const data: AgentResultFile = {
      sessionId: "abc",
      phase: "implement",
      issueRef: "owner/repo#42",
      startedAt: "2026-01-15T10:00:00Z",
      completedAt: "2026-01-15T10:30:00Z",
      exitCode: 0,
      artifacts: [],
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(data));

    const result = readResultFile("/test/result.json");

    expect(result?.sessionId).toBe("abc");
    expect(result?.exitCode).toBe(0);
  });

  it("returns undefined on parse error", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(readResultFile("/nonexistent.json")).toBeUndefined();
  });
});

// ── sessionFromResult ──

describe("sessionFromResult", () => {
  it("converts result file to session record", () => {
    const result: AgentResultFile = {
      sessionId: "abc",
      phase: "implement",
      issueRef: "owner/repo#42",
      startedAt: "2026-01-15T10:00:00Z",
      completedAt: "2026-01-15T10:30:00Z",
      exitCode: 0,
      artifacts: [],
      summary: "Done",
    };

    const session = sessionFromResult(result, "/test/result.json");

    expect(session.repo).toBe("owner/repo");
    expect(session.issueNumber).toBe(42);
    expect(session.phase).toBe("implement");
    expect(session.mode).toBe("background");
    expect(session.claudeSessionId).toBe("abc");
    expect(session.exitedAt).toBe("2026-01-15T10:30:00Z");
    expect(session.exitCode).toBe(0);
    expect(session.resultFile).toBe("/test/result.json");
  });
});
