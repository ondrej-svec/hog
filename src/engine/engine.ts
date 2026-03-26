import type { HogConfig } from "../config.js";
import { ActionExecutor } from "./actions.js";
import { AgentManager } from "./agent-manager.js";
import { BeadsClient } from "./beads.js";
import { EventBus } from "./event-bus.js";
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
  readonly beads: BeadsClient;
  readonly beadsAvailable: boolean;

  private started = false;

  constructor(config: HogConfig) {
    this.eventBus = new EventBus();
    this.workflow = new WorkflowEngine(config, this.eventBus);
    this.agents = new AgentManager(config, this.eventBus, this.workflow);
    this.actions = new ActionExecutor(config, this.eventBus);
    this.orchestrator = new Orchestrator(config, this.eventBus, this.agents, this.workflow);
    this.beads = new BeadsClient(config.board.assignee);
    this.beadsAvailable = this.beads.isInstalled();
  }

  /** Start all engine subsystems (agent polling, fetch loop). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.agents.start();
  }

  /** Stop all engine subsystems gracefully. */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.agents.stop();
    this.eventBus.removeAllListeners();
  }

  /** Whether the engine is currently running. */
  get isRunning(): boolean {
    return this.started;
  }
}
