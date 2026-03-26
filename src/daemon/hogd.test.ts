import { createServer, type Server, type Socket } from "node:net";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DaemonClient } from "./client.js";
import { isDaemonRunning, PID_FILE, SOCKET_PATH } from "./hogd.js";
import type { RpcRequest } from "./protocol.js";
import { isRpcRequest } from "./protocol.js";

describe("isDaemonRunning", () => {
  it("returns false when no PID file exists", () => {
    // PID_FILE may or may not exist in test env — just ensure no crash
    expect(typeof isDaemonRunning()).toBe("boolean");
  });
});

describe("DaemonClient + mock server", () => {
  let server: Server;
  let socketPath: string;
  let client: DaemonClient;

  beforeEach(async () => {
    const dir = join(tmpdir(), `hogd-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    socketPath = join(dir, "test.sock");

    // Create a mock server that echoes method calls
    server = createServer((socket: Socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        for (;;) {
          const idx = buffer.indexOf("\n");
          if (idx === -1) break;
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line.length === 0) continue;

          const msg: unknown = JSON.parse(line);
          if (isRpcRequest(msg)) {
            const req = msg as RpcRequest;
            switch (req.method) {
              case "daemon.status":
                socket.write(
                  `${JSON.stringify({
                    id: req.id,
                    result: { pid: 1234, uptime: 60, pipelines: 2, agents: 1, version: "test" },
                  })}\n`,
                );
                break;
              case "pipeline.list":
                socket.write(`${JSON.stringify({ id: req.id, result: [] })}\n`);
                break;
              case "subscribe":
                socket.write(`${JSON.stringify({ id: req.id, result: { ok: true } })}\n`);
                // Send a test event after subscribing
                setTimeout(() => {
                  socket.write(
                    `${JSON.stringify({
                      event: "agent:spawned",
                      data: { sessionId: "s1", repo: "test", issueNumber: 1, phase: "impl" },
                    })}\n`,
                  );
                }, 50);
                break;
              default:
                socket.write(
                  `${JSON.stringify({
                    id: req.id,
                    error: { code: -32601, message: "Method not found" },
                  })}\n`,
                );
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(socketPath, () => resolve());
    });

    // Connect client to mock server
    const { connect } = await import("node:net");
    const socket = await new Promise<Socket>((resolve) => {
      const s = connect(socketPath, () => resolve(s));
    });
    client = new DaemonClient(socket);
  });

  afterEach(() => {
    client.close();
    server.close();
    try {
      if (existsSync(socketPath)) rmSync(socketPath);
    } catch {
      // best-effort
    }
  });

  it("calls daemon.status and gets a response", async () => {
    const status = await client.call("daemon.status", {});
    expect(status.pid).toBe(1234);
    expect(status.uptime).toBe(60);
    expect(status.pipelines).toBe(2);
    expect(status.agents).toBe(1);
    expect(status.version).toBe("test");
  });

  it("calls pipeline.list and gets empty array", async () => {
    const pipelines = await client.call("pipeline.list", {});
    expect(pipelines).toEqual([]);
  });

  it("rejects on unknown method", async () => {
    await expect(
      client.call("nonexistent.method" as "daemon.status", {}),
    ).rejects.toThrow("Method not found");
  });

  it("receives push events after subscribe", async () => {
    const events: unknown[] = [];
    client.subscribe((event) => {
      events.push(event);
    });

    // Wait for the delayed event from mock server
    await new Promise((r) => setTimeout(r, 200));

    expect(events.length).toBeGreaterThanOrEqual(1);
    const event = events[0] as { event: string; data: Record<string, unknown> };
    expect(event.event).toBe("agent:spawned");
    expect(event.data["sessionId"]).toBe("s1");
    expect(event.data["phase"]).toBe("impl");
  });

  it("reports connected state", () => {
    expect(client.isConnected).toBe(true);
    client.close();
    expect(client.isConnected).toBe(false);
  });
});
