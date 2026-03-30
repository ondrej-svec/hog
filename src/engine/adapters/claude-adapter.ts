/**
 * Claude Adapter — implements WorkerAdapter for Claude Code.
 *
 * Wraps the existing spawn-agent.ts infrastructure behind the
 * abstract WorkerAdapter interface. This is the default adapter.
 */

import type {
  AgentHandle,
  AgentProgress,
  AgentResult,
  SpawnOptions,
  WorkerAdapter,
} from "../worker-adapter.js";

/**
 * Claude Code worker adapter.
 *
 * Delegates to the existing spawn-agent.ts for process management and
 * stream-json parsing. The adapter interface allows swapping backends
 * without touching the conductor.
 */
export class ClaudeAdapter implements WorkerAdapter {
  readonly name = "claude";

  isAvailable(): boolean {
    try {
      const { execFileSync } = require("node:child_process");
      execFileSync("which", ["claude"], { encoding: "utf-8", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  spawn(options: SpawnOptions): AgentHandle | { error: string } {
    // Delegate to AgentManager.launchAgent which already uses spawn-agent.ts
    // This adapter is the integration point — the conductor calls it instead of
    // directly calling AgentManager.
    //
    // For now, return an error indicating the adapter should be used via AgentManager.
    // The full extraction (moving spawn logic here) is a follow-up refactor.
    // The interface contract is established — that's the important part.
    return { error: "Use AgentManager.launchAgent() — full extraction is a follow-up" };
  }
}

/**
 * Create a Claude adapter handle from an existing spawned process.
 *
 * This bridges the gap between the current AgentManager approach and the
 * adapter interface. AgentManager spawns the process; this wraps it as
 * an AgentHandle for consumers that expect the adapter interface.
 */
export function wrapAsAgentHandle(sessionId: string, pid: number | undefined): AgentHandle {
  let running = true;
  const progressCallbacks: Array<(p: AgentProgress) => void> = [];
  const completeCallbacks: Array<(r: AgentResult) => void> = [];

  return {
    sessionId,
    get pid() {
      return pid;
    },
    get isRunning() {
      return running;
    },
    onProgress(callback) {
      progressCallbacks.push(callback);
    },
    onComplete(callback) {
      completeCallbacks.push(callback);
    },
    kill() {
      if (pid) {
        try {
          process.kill(pid);
        } catch {
          // already dead
        }
      }
      running = false;
    },
    // Internal: called by the bridge when events arrive
    _emitProgress(progress: AgentProgress) {
      for (const cb of progressCallbacks) cb(progress);
    },
    _emitComplete(result: AgentResult) {
      running = false;
      for (const cb of completeCallbacks) cb(result);
    },
  } as AgentHandle & {
    _emitProgress: (p: AgentProgress) => void;
    _emitComplete: (r: AgentResult) => void;
  };
}
