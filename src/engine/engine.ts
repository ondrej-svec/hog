import type { FetchOptions } from "../board/fetch.js";
import type { HogConfig } from "../config.js";
import { ActionExecutor } from "./actions.js";
import { AgentManager } from "./agent-manager.js";
import { EventBus } from "./event-bus.js";
import { FetchLoop } from "./fetch-loop.js";
import { Orchestrator } from "./orchestrator.js";
import { WorkflowEngine } from "./workflow.js";

// ── Engine ──

/**
 * The hog engine — wires all components together and provides a unified lifecycle.
 *
 * Consumers (TUI, headless, future daemon) create one Engine instance and use it
 * to access all orchestration capabilities.
 */
export class Engine {
  readonly eventBus: EventBus;
  readonly workflow: WorkflowEngine;
  readonly agents: AgentManager;
  readonly actions: ActionExecutor;
  readonly orchestrator: Orchestrator;
  readonly fetchLoop: FetchLoop;

  private started = false;

  constructor(config: HogConfig, fetchOptions: FetchOptions = {}) {
    this.eventBus = new EventBus();
    this.workflow = new WorkflowEngine(config, this.eventBus);
    this.agents = new AgentManager(config, this.eventBus, this.workflow);
    this.actions = new ActionExecutor(config, this.eventBus);
    this.orchestrator = new Orchestrator(config, this.eventBus, this.agents, this.workflow);
    this.fetchLoop = new FetchLoop(config, this.eventBus, fetchOptions);
  }

  /** Start all engine subsystems (agent polling, fetch loop). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.agents.start();
    await this.fetchLoop.start();
  }

  /** Stop all engine subsystems gracefully. */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.agents.stop();
    this.fetchLoop.stop();
    this.eventBus.removeAllListeners();
  }

  /** Whether the engine is currently running. */
  get isRunning(): boolean {
    return this.started;
  }
}
