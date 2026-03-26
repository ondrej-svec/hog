/**
 * IPC Client — typed client for communicating with hogd over Unix socket.
 *
 * Usage:
 *   const client = await connectDaemon();
 *   const pipelines = await client.call("pipeline.list", {});
 *   client.subscribe((event) => console.log(event));
 *   client.close();
 */

import { connect, type Socket } from "node:net";
import { isDaemonRunning, SOCKET_PATH } from "./hogd.js";
import type { RpcEvent, RpcMethod, RpcMethods, RpcResponse, RpcResponseError } from "./protocol.js";
import { isRpcEvent } from "./protocol.js";

export type EventCallback = (event: RpcEvent) => void;

export class DaemonClient {
  private socket: Socket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private readonly eventListeners = new Set<EventCallback>();
  private buffer = "";
  private connected = false;

  constructor(socket: Socket) {
    this.socket = socket;
    this.connected = true;

    this.socket.on("data", (chunk) => {
      this.buffer += chunk.toString();
      for (;;) {
        const newlineIdx = this.buffer.indexOf("\n");
        if (newlineIdx === -1) break;
        const line = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          this.handleMessage(line);
        }
      }
    });

    this.socket.on("close", () => {
      this.connected = false;
      // Reject all pending calls
      for (const [, { reject }] of this.pending) {
        reject(new Error("Connection closed"));
      }
      this.pending.clear();
    });

    this.socket.on("error", () => {
      this.connected = false;
    });
  }

  /** Send an RPC call and wait for the response. */
  async call<M extends RpcMethod>(
    method: M,
    params: RpcMethods[M]["params"],
  ): Promise<RpcMethods[M]["result"]> {
    if (!this.connected) {
      throw new Error("Not connected to daemon");
    }

    const id = this.nextId++;
    const msg = JSON.stringify({ id, method, params });

    return new Promise<RpcMethods[M]["result"]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC call ${method} timed out after 30s`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as RpcMethods[M]["result"]);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.socket.write(`${msg}\n`);
    });
  }

  /** Subscribe to daemon push events. */
  subscribe(callback: EventCallback): () => void {
    this.eventListeners.add(callback);
    // Send subscribe RPC so daemon starts pushing events
    this.call("subscribe", {}).catch(() => {
      // best-effort — subscription may have been sent already
    });
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  /** Close the connection. */
  close(): void {
    this.connected = false;
    this.socket.destroy();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof msg !== "object" || msg === null) return;

    // Push event (no id)
    if (isRpcEvent(msg)) {
      for (const listener of this.eventListeners) {
        listener(msg);
      }
      return;
    }

    // RPC response (has id)
    const response = msg as RpcResponse;
    if ("id" in response && typeof response.id === "number") {
      const handler = this.pending.get(response.id);
      if (handler) {
        this.pending.delete(response.id);
        if ("error" in response) {
          handler.reject(new Error((response as RpcResponseError).error.message));
        } else {
          handler.resolve(response.result);
        }
      }
    }
  }
}

// ── Connection Helpers ──

/** Connect to the running daemon. Throws if daemon isn't running. */
export function connectDaemon(timeoutMs = 5_000): Promise<DaemonClient> {
  return new Promise((resolve, reject) => {
    if (!isDaemonRunning()) {
      reject(new Error("Daemon is not running. Start it with: hog daemon start"));
      return;
    }

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Connection to daemon timed out"));
    }, timeoutMs);

    const socket = connect(SOCKET_PATH, () => {
      clearTimeout(timer);
      resolve(new DaemonClient(socket));
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to connect to daemon: ${err.message}`));
    });
  });
}

/** Try to connect, returning null if daemon isn't running. */
export async function tryConnectDaemon(): Promise<DaemonClient | null> {
  try {
    return await connectDaemon();
  } catch {
    return null;
  }
}
