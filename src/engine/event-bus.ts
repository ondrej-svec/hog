import { EventEmitter } from "node:events";
import type { AgentSession } from "../enrichment.js";

// ── Event Types ──

export interface EngineEvents {
  "agent:spawned": { sessionId: string; repo: string; issueNumber: number; phase: string };
  "agent:progress": { sessionId: string; toolName?: string; text?: string };
  "agent:completed": { sessionId: string; repo: string; issueNumber: number; phase: string };
  "agent:failed": {
    sessionId: string;
    repo: string;
    issueNumber: number;
    phase: string;
    exitCode: number;
    errorMessage?: string;
  };
  "data:refreshed": { data: unknown };
  "mutation:started": { description: string };
  "mutation:completed": { description: string };
  "mutation:failed": { description: string; error: string };
  "workflow:phase-changed": {
    repo: string;
    issueNumber: number;
    phase: string;
    state: "pending" | "active" | "completed";
    session?: AgentSession;
  };
}

type EventName = keyof EngineEvents;

// ── Typed EventBus ──

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Allow many listeners (engine + TUI + headless consumers)
    this.emitter.setMaxListeners(50);
  }

  on<K extends EventName>(event: K, listener: (payload: EngineEvents[K]) => void): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends EventName>(event: K, listener: (payload: EngineEvents[K]) => void): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends EventName>(event: K, payload: EngineEvents[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  once<K extends EventName>(event: K, listener: (payload: EngineEvents[K]) => void): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  removeAllListeners(event?: EventName): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}
