/**
 * Tests for waitForAuthCode in isolation.
 * Uses a mocked node:http createServer so no real port 8080 is needed.
 */
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

// ── Fake server infrastructure ──

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

class FakeRes extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";

  writeHead(code: number, headers?: Record<string, string>) {
    this.statusCode = code;
    if (headers) this.headers = { ...this.headers, ...headers };
  }
  end(data?: string) {
    this.body = data ?? "";
  }
}

class FakeReq extends EventEmitter {
  constructor(public url: string) {
    super();
  }
}

class FakeServer extends EventEmitter {
  private handler: RequestHandler;
  closed = false;

  constructor(handler: RequestHandler) {
    super();
    this.handler = handler;
  }

  listen(_port: number, cb?: () => void) {
    // Call the listen callback asynchronously to match Node.js behaviour
    setImmediate(() => cb?.());
    return this;
  }

  close(cb?: () => void) {
    this.closed = true;
    setImmediate(() => cb?.());
    return this;
  }

  /** Simulate an incoming HTTP request with the given URL path+query. */
  simulateRequest(url: string): FakeRes {
    const req = new FakeReq(url) as unknown as IncomingMessage;
    const res = new FakeRes() as unknown as ServerResponse;
    this.handler(req, res);
    return res as unknown as FakeRes;
  }

  /** Emit an error (e.g. EADDRINUSE) asynchronously. */
  triggerError(err: Error) {
    setImmediate(() => this.emit("error", err));
  }
}

let currentFakeServer: FakeServer | null = null;

// vi.mock is hoisted to the top of the file — it replaces node:http for this
// module only. The factory captures FakeServer so we can control the instance.
vi.mock("node:http", () => {
  return {
    createServer: (handler: RequestHandler) => {
      const server = new FakeServer(handler);
      currentFakeServer = server;
      return server;
    },
  };
});

afterEach(() => {
  currentFakeServer = null;
  vi.clearAllMocks();
});

describe("waitForAuthCode", () => {
  it("resolves with the auth code when request has ?code= query param and matching state", async () => {
    const { waitForAuthCode } = await import("./auth.js");

    const expectedState = "test-state-abc123";
    const codePromise = waitForAuthCode(expectedState);

    // Let the server 'listen' callback fire (setImmediate in FakeServer.listen)
    await new Promise<void>((r) => setImmediate(r));

    const server = currentFakeServer!;
    const fakeRes = server.simulateRequest(
      `/?code=hello-auth-code&state=${expectedState}`,
    ) as unknown as FakeRes;

    // The handler resolves codePromise synchronously, so we can await it now
    const code = await codePromise;

    expect(code).toBe("hello-auth-code");
    expect(fakeRes.statusCode).toBe(200);
    expect(fakeRes.body).toContain("Heart of Gold authenticated");
    expect(server.closed).toBe(true);
  });

  it("rejects with 'No authorization code received' when request has no code", async () => {
    const { waitForAuthCode } = await import("./auth.js");

    const expectedState = "test-state-abc123";
    const codePromise = waitForAuthCode(expectedState);

    // Attach rejection handler immediately so it's never unhandled
    const rejection = expect(codePromise).rejects.toThrow("No authorization code received");

    // Let the server 'listen' callback fire
    await new Promise<void>((r) => setImmediate(r));

    const server = currentFakeServer!;
    const fakeRes = server.simulateRequest(`/?state=${expectedState}`) as unknown as FakeRes;

    await rejection;

    expect(fakeRes.statusCode).toBe(400);
    expect(fakeRes.body).toBe("Missing authorization code");
    expect(server.closed).toBe(true);
  });

  it("rejects with 'OAuth state mismatch' when the returned state does not match", async () => {
    const { waitForAuthCode } = await import("./auth.js");

    const codePromise = waitForAuthCode("expected-state");

    // Attach rejection handler immediately so it's never unhandled
    const rejection = expect(codePromise).rejects.toThrow("OAuth state mismatch");

    // Let the server 'listen' callback fire
    await new Promise<void>((r) => setImmediate(r));

    const server = currentFakeServer!;
    const fakeRes = server.simulateRequest(
      "/?code=some-code&state=wrong-state",
    ) as unknown as FakeRes;

    await rejection;

    expect(fakeRes.statusCode).toBe(400);
    expect(fakeRes.body).toBe("Invalid OAuth state");
    expect(server.closed).toBe(true);
  });

  it("rejects with the server error when listen fails (e.g. EADDRINUSE)", async () => {
    const { waitForAuthCode } = await import("./auth.js");

    // Patch the next FakeServer's listen to emit an error instead of calling cb
    const origListen = FakeServer.prototype.listen;
    FakeServer.prototype.listen = function (_port: number, _cb?: () => void) {
      // Do not call cb; emit error instead
      setImmediate(() => {
        const err = Object.assign(new Error("listen EADDRINUSE: :::8080"), { code: "EADDRINUSE" });
        this.emit("error", err);
      });
      return this;
    };

    const codePromise = waitForAuthCode("any-state");

    // Restore the prototype before awaiting so later tests are unaffected
    FakeServer.prototype.listen = origListen;

    // Attach the rejection expectation right away to avoid unhandled rejection
    const rejection = expect(codePromise).rejects.toThrow("EADDRINUSE");

    // Let the setImmediate in the patched listen fire
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));

    await rejection;
  });
});
