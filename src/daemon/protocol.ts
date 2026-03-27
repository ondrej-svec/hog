/**
 * IPC Protocol — JSON-RPC over Unix domain socket.
 *
 * Wire format: newline-delimited JSON (NDJSON).
 * Request:  { id, method, params }
 * Response: { id, result } | { id, error }
 * Event:    { event, data } (push-only, no id)
 */

import type { Pipeline, PipelineStatus } from "../engine/conductor.js";
import type { EngineEvents } from "../engine/event-bus.js";
import type { Question } from "../engine/question-queue.js";

// ── RPC Methods ──

export interface RpcMethods {
  "pipeline.list": { params: Record<string, never>; result: Pipeline[] };
  "pipeline.create": {
    params: {
      repo: string;
      title: string;
      description?: string | undefined;
      brainstormDone?: boolean | undefined;
      localPath?: string | undefined;
      storiesPath?: string | undefined;
    };
    result: Pipeline | { error: string };
  };
  "pipeline.pause": { params: { featureId: string }; result: { ok: boolean } };
  "pipeline.resume": { params: { featureId: string }; result: { ok: boolean } };
  "pipeline.cancel": { params: { featureId: string }; result: { ok: boolean } };
  "pipeline.status": { params: { featureId: string }; result: Pipeline | { error: string } };
  "pipeline.done": { params: { featureId: string }; result: { ok: boolean; error?: string } };
  "pipeline.review": {
    params: { featureId: string };
    result: {
      featureId: string;
      title: string;
      status: PipelineStatus;
      completedBeads: number;
      elapsedMinutes: number;
      decisionLog: Array<{
        timestamp: string;
        featureId: string;
        action: string;
        detail: string;
      }>;
    } | null;
  };
  "decision.list": { params: Record<string, never>; result: Question[] };
  "decision.resolve": {
    params: { questionId: string; answer: string };
    result: { ok: boolean };
  };
  "agent.list": {
    params: Record<string, never>;
    result: Array<{
      sessionId: string;
      repo: string;
      phase: string;
      pid: number;
      startedAt: string;
      lastToolUse?: string;
    }>;
  };
  "daemon.status": {
    params: Record<string, never>;
    result: {
      pid: number;
      uptime: number;
      pipelines: number;
      agents: number;
      version: string;
    };
  };
  subscribe: { params: Record<string, never>; result: { ok: boolean } };
}

export type RpcMethod = keyof RpcMethods;

// ── Wire Types ──

export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  readonly id: number;
  readonly method: M;
  readonly params: RpcMethods[M]["params"];
}

export interface RpcResponseOk<M extends RpcMethod = RpcMethod> {
  readonly id: number;
  readonly result: RpcMethods[M]["result"];
}

export interface RpcResponseError {
  readonly id: number;
  readonly error: { code: number; message: string };
}

export type RpcResponse<M extends RpcMethod = RpcMethod> = RpcResponseOk<M> | RpcResponseError;

export interface RpcEvent<K extends keyof EngineEvents = keyof EngineEvents> {
  readonly event: K;
  readonly data: EngineEvents[K];
}

// ── Helpers ──

export function isRpcRequest(msg: unknown): msg is RpcRequest {
  return typeof msg === "object" && msg !== null && "id" in msg && "method" in msg;
}

export function isRpcEvent(msg: unknown): msg is RpcEvent {
  return typeof msg === "object" && msg !== null && "event" in msg && !("id" in msg);
}

/** Standard error codes (JSON-RPC 2.0 inspired). */
export const RPC_ERRORS = {
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
  DAEMON_NOT_RUNNING: { code: -32000, message: "Daemon not running" },
} as const;
