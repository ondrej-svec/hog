import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../config.js";
import type { AgentSession } from "../enrichment.js";
import type { Result } from "../types.js";
import type { PromptVariables } from "./launch-claude.js";
import { buildPrompt, DEFAULT_PHASE_PROMPTS } from "./launch-claude.js";

// ── Constants ──

export const AGENT_RESULTS_DIR = join(CONFIG_DIR, "agent-results");

// ── Types ──

export interface SpawnAgentOptions {
  readonly localPath: string;
  readonly repoFullName: string;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly issueUrl: string;
  readonly phase: string;
  readonly promptTemplate?: string | undefined;
  readonly promptVariables?: PromptVariables | undefined;
  readonly startCommand?: { command: string; extraArgs: readonly string[] } | undefined;
}

export interface SpawnAgentResult {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly resultFilePath: string;
}

export type SpawnFailureReason = "directory-not-found" | "claude-not-found" | "spawn-failed";

export interface SpawnError {
  readonly kind: SpawnFailureReason;
  readonly message: string;
}

export type SpawnResult = Result<SpawnAgentResult, SpawnError>;

// ── Stream-JSON parsing ──

export interface StreamEvent {
  readonly type: "tool_use" | "result" | "text" | "system" | "error" | "unknown";
  readonly toolName?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly text?: string | undefined;
}

/** Parse a single line of stream-json output from claude CLI. */
export function parseStreamLine(line: string): StreamEvent | undefined {
  if (!line.trim()) return undefined;

  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const type = parsed["type"] as string | undefined;

    if (type === "system") {
      const sessionId = parsed["session_id"] as string | undefined;
      return { type: "system", sessionId };
    }

    if (type === "assistant" && parsed["message"]) {
      const message = parsed["message"] as Record<string, unknown>;
      const content = message["content"] as Record<string, unknown>[] | undefined;
      if (content) {
        for (const block of content) {
          if (block["type"] === "tool_use") {
            return { type: "tool_use", toolName: block["name"] as string };
          }
          if (block["type"] === "text") {
            return { type: "text", text: block["text"] as string };
          }
        }
      }
      return { type: "text" };
    }

    if (type === "result") {
      const sessionId = parsed["session_id"] as string | undefined;
      return { type: "result", sessionId };
    }

    if (type === "error") {
      const errorObj = parsed["error"] as Record<string, unknown> | undefined;
      const message = (errorObj?.["message"] as string) ?? "Unknown error";
      return { type: "error", text: message };
    }

    return { type: "unknown" };
  } catch {
    return undefined;
  }
}

// ── Result file ──

export interface AgentResultFile {
  readonly sessionId: string;
  readonly phase: string;
  readonly issueRef: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly exitCode: number;
  readonly artifacts: string[];
  readonly summary?: string | undefined;
}

export function buildResultFilePath(
  repoFullName: string,
  issueNumber: number,
  phase: string,
): string {
  const slug = repoFullName.replace("/", "-");
  return join(AGENT_RESULTS_DIR, `${slug}-${issueNumber}-${phase}.json`);
}

export function writeResultFile(path: string, result: AgentResultFile): void {
  mkdirSync(AGENT_RESULTS_DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

// ── Spawn ──

function isClaudeInPath(): boolean {
  const result = spawnSync("which", ["claude"], { stdio: "pipe" });
  return result.status === 0;
}

/** Spawn a background Claude agent process. Returns child process handle and PID. */
export function spawnBackgroundAgent(opts: SpawnAgentOptions): SpawnResult {
  if (!existsSync(opts.localPath)) {
    return {
      ok: false,
      error: {
        kind: "directory-not-found",
        message: `Directory not found: ${opts.localPath}. Check localPath config.`,
      },
    };
  }

  if (!isClaudeInPath()) {
    return {
      ok: false,
      error: {
        kind: "claude-not-found",
        message: "claude binary not found in PATH. Install Claude Code first.",
      },
    };
  }

  const issue = { number: opts.issueNumber, title: opts.issueTitle, url: opts.issueUrl };
  const template =
    opts.promptTemplate ??
    DEFAULT_PHASE_PROMPTS[opts.phase] ??
    `Issue #${opts.issueNumber}: ${opts.issueTitle}`;
  const prompt = buildPrompt(issue, template, opts.promptVariables);

  const command = opts.startCommand?.command ?? "claude";
  const extraArgs = opts.startCommand?.extraArgs ?? [];

  const args = [...extraArgs, "-p", prompt, "--output-format", "stream-json"];

  const child = spawn(command, args, {
    cwd: opts.localPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOG_REPO: opts.repoFullName,
      HOG_ISSUE: String(opts.issueNumber),
    },
  });

  if (child.pid === undefined) {
    return {
      ok: false,
      error: {
        kind: "spawn-failed",
        message: `Failed to spawn background agent for #${opts.issueNumber}`,
      },
    };
  }

  const resultFilePath = buildResultFilePath(opts.repoFullName, opts.issueNumber, opts.phase);

  return {
    ok: true,
    value: {
      child,
      pid: child.pid,
      resultFilePath,
    },
  };
}

// ── Stream monitoring ──

export interface AgentMonitor {
  readonly sessionId: string | undefined;
  readonly lastToolUse: string | undefined;
  readonly lastText: string | undefined;
  readonly isRunning: boolean;
}

/**
 * Attach stream monitoring to a spawned agent's child process.
 * Returns a mutable state object that is updated as events stream in.
 * Calls onExit when the process terminates.
 */
export function attachStreamMonitor(
  child: ChildProcess,
  onEvent?: (event: StreamEvent) => void,
  onExit?: (exitCode: number, state: AgentMonitor) => void,
): AgentMonitor {
  const state: AgentMonitor = {
    sessionId: undefined,
    lastToolUse: undefined,
    lastText: undefined,
    isRunning: true,
  };

  // Mutable reference for accumulating partial lines
  let buffer = "";

  const processLine = (line: string): void => {
    const event = parseStreamLine(line);
    if (!event) return;

    if (event.sessionId) {
      (state as { sessionId: string | undefined }).sessionId = event.sessionId;
    }
    if (event.type === "tool_use" && event.toolName) {
      (state as { lastToolUse: string | undefined }).lastToolUse = event.toolName;
    }
    if (event.type === "text" && event.text) {
      (state as { lastText: string | undefined }).lastText = event.text;
    }

    onEvent?.(event);
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    // Keep the last partial line in the buffer
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      processLine(line);
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    // Capture stderr as error text
    const text = chunk.toString().trim();
    if (text) {
      (state as { lastText: string | undefined }).lastText = text;
    }
  });

  child.on("exit", (code) => {
    // Process remaining buffer
    if (buffer.trim()) {
      processLine(buffer);
      buffer = "";
    }

    (state as { isRunning: boolean }).isRunning = false;
    onExit?.(code ?? 1, state);
  });

  return state;
}

/**
 * Check if a process with the given PID is still alive.
 * Uses kill(pid, 0) which checks existence without sending a signal.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find unprocessed result files in agent-results/ directory.
 * Returns paths to result files that exist but haven't been reconciled with enrichment.
 */
export function findUnprocessedResults(processedFiles: Set<string>): string[] {
  if (!existsSync(AGENT_RESULTS_DIR)) return [];

  try {
    const files = readdirSync(AGENT_RESULTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(AGENT_RESULTS_DIR, f));
    return files.filter((f) => !processedFiles.has(f));
  } catch {
    return [];
  }
}

/**
 * Read and parse an agent result file.
 */
export function readResultFile(path: string): AgentResultFile | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as AgentResultFile;
    return raw;
  } catch {
    return undefined;
  }
}

/**
 * Build a session record from an agent result file for enrichment reconciliation.
 */
export function sessionFromResult(
  result: AgentResultFile,
  resultFilePath: string,
): Omit<AgentSession, "id"> {
  // Parse issueRef "owner/repo#42" into parts
  const match = result.issueRef.match(/^(.+)#(\d+)$/);
  const repo = match?.[1] ?? "";
  const issueNumber = Number(match?.[2] ?? 0);

  return {
    repo,
    issueNumber,
    phase: result.phase,
    mode: "background",
    claudeSessionId: result.sessionId,
    startedAt: result.startedAt,
    exitedAt: result.completedAt,
    exitCode: result.exitCode,
    resultFile: resultFilePath,
  };
}
