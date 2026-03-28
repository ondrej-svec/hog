/**
 * Worker Adapter — abstract interface for agent spawning.
 *
 * The conductor doesn't know whether it's spawning Claude, Codex, or a custom agent.
 * The adapter handles the specifics: process spawning, output parsing, model selection.
 *
 * Claude adapter is the default. Others can be added without touching the conductor.
 */

// ── Agent Handle ──

export interface AgentProgress {
  readonly toolName?: string | undefined;
  readonly toolDetail?: string | undefined;
  readonly text?: string | undefined;
}

export interface AgentResult {
  readonly exitCode: number;
  readonly summary?: string | undefined;
  readonly costUsd?: number | undefined;
}

/** Handle to a running agent process. */
export interface AgentHandle {
  /** Unique session ID for tracking. */
  readonly sessionId: string;
  /** Process ID (if available). */
  readonly pid: number | undefined;
  /** Whether the agent is still running. */
  readonly isRunning: boolean;
  /** Register a callback for progress updates. */
  onProgress(callback: (progress: AgentProgress) => void): void;
  /** Register a callback for completion. */
  onComplete(callback: (result: AgentResult) => void): void;
  /** Kill the agent process. */
  kill(): void;
}

// ── Worker Adapter Interface ──

export interface SpawnOptions {
  /** Working directory for the agent. */
  readonly cwd: string;
  /** The prompt/instruction for the agent. */
  readonly prompt: string;
  /** Model to use (adapter-specific naming). */
  readonly model?: string | undefined;
  /** Permission mode. */
  readonly permissionMode?: string | undefined;
  /** Phase name (for logging/display). */
  readonly phase?: string | undefined;
  /** Additional environment variables. */
  readonly env?: Record<string, string> | undefined;
}

/** Abstract worker adapter — one implementation per agent backend. */
export interface WorkerAdapter {
  /** Human-readable name of this adapter. */
  readonly name: string;
  /** Check if the adapter's backend is available. */
  isAvailable(): boolean;
  /** Spawn an agent. Returns a handle for monitoring/control. */
  spawn(options: SpawnOptions): AgentHandle | { error: string };
}

// ── Adapter Registry ──

const adapters = new Map<string, WorkerAdapter>();

/** Register a worker adapter. */
export function registerAdapter(name: string, adapter: WorkerAdapter): void {
  adapters.set(name, adapter);
}

/** Get a registered adapter by name. */
export function getAdapter(name: string): WorkerAdapter | undefined {
  return adapters.get(name);
}

/** List all registered adapter names. */
export function listAdapters(): string[] {
  return [...adapters.keys()];
}
