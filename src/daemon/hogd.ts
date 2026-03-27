/**
 * hogd — the hog daemon.
 *
 * A single long-lived process that owns all Conductor, AgentManager, and Beads
 * lifecycle. CLI and cockpit become thin clients over a Unix domain socket.
 *
 * Socket: ~/.config/hog/hogd.sock
 * PID file: ~/.config/hog/hogd.pid
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import type { HogConfig, RepoConfig } from "../config.js";
import { CONFIG_DIR, loadFullConfig, resolveProfile } from "../config.js";
import { Conductor } from "../engine/conductor.js";
import { Engine } from "../engine/engine.js";
import type { EngineEvents } from "../engine/event-bus.js";
import {
  isRpcRequest,
  RPC_ERRORS,
  type RpcEvent,
  type RpcMethods,
  type RpcRequest,
} from "./protocol.js";

// ── Paths ──

export const SOCKET_PATH = join(CONFIG_DIR, "hogd.sock");
export const PID_FILE = join(CONFIG_DIR, "hogd.pid");

// ── Daemon ──

export class HogDaemon {
  private readonly config: HogConfig;
  private readonly engine: Engine;
  private readonly conductor: Conductor;
  private server: Server | null = null;
  private readonly subscribers = new Set<Socket>();
  private readonly startedAt = Date.now();
  /** Per-client throttle timers for agent:progress events. */
  private readonly progressThrottles = new WeakMap<Socket, number>();

  constructor(config: HogConfig) {
    this.config = config;
    this.engine = new Engine(config);
    this.conductor = new Conductor(
      config,
      this.engine.eventBus,
      this.engine.agents,
      this.engine.beads,
    );
  }

  /** Start the daemon: Unix socket server + conductor polling. */
  async start(): Promise<void> {
    mkdirSync(CONFIG_DIR, { recursive: true });

    // Clean up stale socket
    if (existsSync(SOCKET_PATH)) {
      try {
        rmSync(SOCKET_PATH);
      } catch {
        // May fail if another daemon owns it — we'll error on listen
      }
    }

    // Write PID file
    writeFileSync(PID_FILE, `${process.pid}\n`, { mode: 0o600 });

    // Start engine + conductor
    await this.engine.start();
    this.conductor.start();

    // Ensure Dolt is running for all active pipelines (prevents port mismatch on restart)
    for (const pipeline of this.conductor.getPipelines()) {
      if (pipeline.status === "running" || pipeline.status === "paused") {
        try {
          await this.engine.beads.ensureDoltRunning(pipeline.localPath);
        } catch {
          console.log(`[hogd] Warning: could not start Dolt for ${pipeline.localPath}`);
        }
      }
    }

    // Bridge EventBus → subscribers
    this.bridgeEvents();

    // Start append-only event log
    const { startEventLog } = await import("./event-log.js");
    startEventLog(this.engine.eventBus);

    // Start Unix socket server
    this.server = createServer((socket) => this.handleConnection(socket));
    this.server.listen(SOCKET_PATH, () => {
      // Set socket permissions to owner-only
      try {
        chmodSync(SOCKET_PATH, 0o600);
      } catch {
        // best-effort
      }
    });

    this.server.on("error", (err) => {
      console.error(`[hogd] Server error: ${err.message}`);
      this.stop();
      process.exit(1);
    });

    // Graceful shutdown
    process.on("SIGINT", () => this.shutdown("SIGINT"));
    process.on("SIGTERM", () => this.shutdown("SIGTERM"));

    console.log(`[hogd] Daemon started (pid: ${process.pid})`);
    console.log(`[hogd] Socket: ${SOCKET_PATH}`);
  }

  /** Stop the daemon gracefully. */
  stop(): void {
    this.conductor.stop();
    this.engine.stop();

    for (const socket of this.subscribers) {
      socket.destroy();
    }
    this.subscribers.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clean up files
    try {
      if (existsSync(SOCKET_PATH)) rmSync(SOCKET_PATH);
    } catch {
      // best-effort
    }
    try {
      if (existsSync(PID_FILE)) rmSync(PID_FILE);
    } catch {
      // best-effort
    }
  }

  private shutdown(signal: string): void {
    console.log(`[hogd] Received ${signal}, shutting down...`);
    this.stop();
    process.exit(0);
  }

  // ── Connection Handling ──

  private handleConnection(socket: Socket): void {
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      // Process complete lines (NDJSON)
      for (;;) {
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx === -1) break;
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          this.handleMessage(socket, line);
        }
      }
    });

    socket.on("close", () => {
      this.subscribers.delete(socket);
    });

    socket.on("error", () => {
      this.subscribers.delete(socket);
    });
  }

  private handleMessage(socket: Socket, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendError(socket, 0, RPC_ERRORS.INTERNAL_ERROR.code, "Invalid JSON");
      return;
    }

    if (!isRpcRequest(msg)) {
      this.sendError(socket, 0, RPC_ERRORS.INTERNAL_ERROR.code, "Invalid request");
      return;
    }

    this.dispatch(socket, msg as RpcRequest);
  }

  // ── RPC Dispatch ──

  private dispatch(socket: Socket, req: RpcRequest): void {
    switch (req.method) {
      case "pipeline.list":
        this.send(socket, req.id, this.conductor.getPipelines());
        break;

      case "pipeline.create":
        this.handlePipelineCreate(socket, req as RpcRequest<"pipeline.create">);
        break;

      case "pipeline.pause": {
        const params = req.params as RpcMethods["pipeline.pause"]["params"];
        this.send(socket, req.id, { ok: this.conductor.pausePipeline(params.featureId) });
        break;
      }

      case "pipeline.resume": {
        const params = req.params as RpcMethods["pipeline.resume"]["params"];
        this.send(socket, req.id, { ok: this.conductor.resumePipeline(params.featureId) });
        break;
      }

      case "pipeline.cancel": {
        const params = req.params as RpcMethods["pipeline.cancel"]["params"];
        this.send(socket, req.id, { ok: this.conductor.cancelPipeline(params.featureId) });
        break;
      }

      case "pipeline.status": {
        const params = req.params as RpcMethods["pipeline.status"]["params"];
        const pipeline = this.conductor
          .getPipelines()
          .find((p) => p.featureId === params.featureId);
        this.send(socket, req.id, pipeline ?? { error: "Pipeline not found" });
        break;
      }

      case "pipeline.done":
        this.handlePipelineDone(socket, req as RpcRequest<"pipeline.done">);
        break;

      case "pipeline.review": {
        const params = req.params as RpcMethods["pipeline.review"]["params"];
        const p = this.conductor.getPipelines().find((pl) => pl.featureId === params.featureId);
        if (!p) {
          this.send(socket, req.id, null);
          break;
        }
        const elapsed = p.completedAt
          ? Math.round(
              (new Date(p.completedAt).getTime() - new Date(p.startedAt).getTime()) / 60_000,
            )
          : Math.round((Date.now() - new Date(p.startedAt).getTime()) / 60_000);
        const log = this.conductor.getDecisionLog().filter((e) => e.featureId === params.featureId);
        this.send(socket, req.id, {
          featureId: p.featureId,
          title: p.title,
          status: p.status,
          completedBeads: p.completedBeads,
          elapsedMinutes: elapsed,
          decisionLog: log,
        });
        break;
      }

      case "decision.list":
        this.send(socket, req.id, this.conductor.getQuestionQueue().questions);
        break;

      case "decision.resolve": {
        const params = req.params as RpcMethods["decision.resolve"]["params"];
        this.conductor.resolveQuestion(params.questionId, params.answer);
        this.send(socket, req.id, { ok: true });
        break;
      }

      case "agent.list": {
        const agents = this.engine.agents.getAgents().map((a) => ({
          sessionId: a.sessionId,
          repo: a.repo,
          phase: a.phase,
          pid: a.pid,
          startedAt: a.startedAt,
          lastToolUse: a.monitor.lastToolUse,
        }));
        this.send(socket, req.id, agents);
        break;
      }

      case "daemon.status":
        this.send(socket, req.id, {
          pid: process.pid,
          uptime: Math.round((Date.now() - this.startedAt) / 1000),
          pipelines: this.conductor.getPipelines().length,
          agents: this.engine.agents.runningCount,
          version: "2.0.0",
        });
        break;

      case "subscribe":
        this.subscribers.add(socket);
        this.send(socket, req.id, { ok: true });
        break;

      default:
        this.sendError(
          socket,
          req.id,
          RPC_ERRORS.METHOD_NOT_FOUND.code,
          RPC_ERRORS.METHOD_NOT_FOUND.message,
        );
    }
  }

  // ── Complex Handlers ──

  private async handlePipelineCreate(
    socket: Socket,
    req: RpcRequest<"pipeline.create">,
  ): Promise<void> {
    const { repo, title, description, brainstormDone, localPath, storiesPath } = req.params;

    // Resolve repo config — fall back to ad-hoc repo from localPath
    const targetRepo = this.resolveRepo(repo, localPath);
    if (!targetRepo) {
      this.send(socket, req.id, { error: `Repo not found: ${repo}` });
      return;
    }

    const result = await this.conductor.startPipeline(
      targetRepo.name,
      targetRepo,
      title,
      description ?? title,
      storiesPath,
    );

    if ("error" in result) {
      this.send(socket, req.id, result);
      return;
    }

    // Close brainstorm bead if requested
    if (brainstormDone) {
      try {
        await this.engine.beads.close(
          targetRepo.localPath ?? "",
          result.beadIds.brainstorm,
          "Brainstorm completed in session",
        );
      } catch {
        // best-effort
      }
    }

    this.send(socket, req.id, result);
  }

  private async handlePipelineDone(
    socket: Socket,
    req: RpcRequest<"pipeline.done">,
  ): Promise<void> {
    const { featureId } = req.params;
    const pipeline = this.conductor.getPipelines().find((p) => p.featureId === featureId);

    if (!pipeline) {
      this.send(socket, req.id, { ok: false, error: "Pipeline not found" });
      return;
    }

    let phase = pipeline.activePhase;

    // If no active phase set, find the first open bead
    if (!phase) {
      const beadIdToPhase: Record<string, string> = {
        [pipeline.beadIds.brainstorm]: "brainstorm",
        [pipeline.beadIds.stories]: "stories",
        [pipeline.beadIds.tests]: "test",
        [pipeline.beadIds.impl]: "impl",
        [pipeline.beadIds.redteam]: "redteam",
        [pipeline.beadIds.merge]: "merge",
      };
      try {
        for (const [beadId, phaseName] of Object.entries(beadIdToPhase)) {
          const bead = await this.engine.beads.show(pipeline.localPath, beadId);
          if (bead.status === "open" || bead.status === "in_progress") {
            phase = phaseName;
            break;
          }
        }
      } catch {
        // best-effort
      }
      if (!phase) {
        this.send(socket, req.id, { ok: false, error: "No active phase" });
        return;
      }
    }

    const beadIdMap: Record<string, string> = {
      brainstorm: pipeline.beadIds.brainstorm,
      stories: pipeline.beadIds.stories,
      test: pipeline.beadIds.tests,
      impl: pipeline.beadIds.impl,
      redteam: pipeline.beadIds.redteam,
      merge: pipeline.beadIds.merge,
    };

    const beadId = beadIdMap[phase];
    if (!beadId) {
      this.send(socket, req.id, { ok: false, error: `Unknown phase: ${phase}` });
      return;
    }

    try {
      await this.engine.beads.close(pipeline.localPath, beadId, `${phase} completed by user`);
      this.send(socket, req.id, { ok: true });
    } catch (err) {
      this.send(socket, req.id, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── EventBus Bridge ──

  private bridgeEvents(): void {
    const bridgeEvent = <K extends keyof EngineEvents>(eventName: K): void => {
      this.engine.eventBus.on(eventName, (payload) => {
        if (this.subscribers.size === 0) return;

        // Throttle agent:progress to max 2 events/second per client
        if (eventName === "agent:progress") {
          this.broadcastThrottled(eventName, payload);
        } else {
          this.broadcast(eventName, payload);
        }
      });
    };

    bridgeEvent("agent:spawned");
    bridgeEvent("agent:progress");
    bridgeEvent("agent:completed");
    bridgeEvent("agent:failed");
    bridgeEvent("workflow:phase-changed");
  }

  private broadcast<K extends keyof EngineEvents>(event: K, data: EngineEvents[K]): void {
    const msg: RpcEvent<K> = { event, data };
    const line = `${JSON.stringify(msg)}\n`;
    for (const socket of this.subscribers) {
      if (!socket.destroyed) {
        socket.write(line);
      }
    }
  }

  private broadcastThrottled<K extends keyof EngineEvents>(event: K, data: EngineEvents[K]): void {
    const now = Date.now();
    const msg: RpcEvent<K> = { event, data };
    const line = `${JSON.stringify(msg)}\n`;

    for (const socket of this.subscribers) {
      if (socket.destroyed) continue;
      const lastSent = this.progressThrottles.get(socket) ?? 0;
      if (now - lastSent >= 500) {
        // 2 events/second max
        socket.write(line);
        this.progressThrottles.set(socket, now);
      }
    }
  }

  // ── Helpers ──

  private resolveRepo(nameOrShort: string, localPath?: string): RepoConfig | undefined {
    const { resolved } = resolveProfile(this.config);
    // Match by short name or full name
    const found = resolved.repos.find(
      (r) => r.shortName === nameOrShort || r.name === nameOrShort,
    );
    if (found) return found;

    // Ad-hoc repo from name — no GitHub config needed, just needs localPath
    if (localPath) {
      return {
        name: nameOrShort,
        shortName: nameOrShort,
        projectNumber: 0,
        statusFieldId: "",
        localPath,
        completionAction: { type: "closeIssue" },
      } as RepoConfig;
    }

    return undefined;
  }

  private send(socket: Socket, id: number, result: unknown): void {
    if (!socket.destroyed) {
      socket.write(`${JSON.stringify({ id, result })}\n`);
    }
  }

  private sendError(socket: Socket, id: number, code: number, message: string): void {
    if (!socket.destroyed) {
      socket.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
    }
  }
}

// ── Daemon Lifecycle Helpers ──

/** Check if a daemon is already running. */
export function isDaemonRunning(): boolean {
  if (!existsSync(PID_FILE)) return false;
  try {
    const pid = Number.parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    process.kill(pid, 0); // Signal 0 = check liveness
    return true;
  } catch {
    // PID file exists but process is dead — clean up
    try {
      rmSync(PID_FILE);
    } catch {
      // best-effort
    }
    try {
      if (existsSync(SOCKET_PATH)) rmSync(SOCKET_PATH);
    } catch {
      // best-effort
    }
    return false;
  }
}

/** Read the daemon PID from the PID file. */
export function readDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    return Number.parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  } catch {
    return null;
  }
}

/** Start the daemon in the current process (foreground). */
export async function startForeground(): Promise<void> {
  if (isDaemonRunning()) {
    console.error("[hogd] Daemon is already running.");
    process.exit(1);
  }

  const rawCfg = loadFullConfig();
  const { resolved: config } = resolveProfile(rawCfg);
  const daemon = new HogDaemon(config);
  await daemon.start();
}
