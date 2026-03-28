import { describe, expect, it } from "vitest";
import { ClaudeAdapter, wrapAsAgentHandle } from "./claude-adapter.js";

describe("ClaudeAdapter", () => {
  it("has name 'claude'", () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.name).toBe("claude");
  });

  it("isAvailable returns a boolean", () => {
    const adapter = new ClaudeAdapter();
    // May be true or false depending on environment — just check the type
    expect(typeof adapter.isAvailable()).toBe("boolean");
  });
});

describe("wrapAsAgentHandle", () => {
  it("creates a handle with the given sessionId", () => {
    const handle = wrapAsAgentHandle("session-42", 12345);
    expect(handle.sessionId).toBe("session-42");
    expect(handle.pid).toBe(12345);
    expect(handle.isRunning).toBe(true);
  });

  it("supports onProgress callbacks", () => {
    const handle = wrapAsAgentHandle("session-1", undefined);
    const events: Array<{ toolName?: string | undefined }> = [];
    handle.onProgress((p) => events.push(p));

    // Emit via internal bridge
    const bridge = handle as unknown as { _emitProgress: (p: { toolName: string }) => void };
    bridge._emitProgress({ toolName: "Read" });
    bridge._emitProgress({ toolName: "Edit" });

    expect(events).toHaveLength(2);
    expect(events[0]?.toolName).toBe("Read");
    expect(events[1]?.toolName).toBe("Edit");
  });

  it("supports onComplete callbacks and sets isRunning to false", () => {
    const handle = wrapAsAgentHandle("session-2", 999);
    let result: { exitCode: number } | undefined;
    handle.onComplete((r) => {
      result = r;
    });

    expect(handle.isRunning).toBe(true);

    const bridge = handle as unknown as { _emitComplete: (r: { exitCode: number }) => void };
    bridge._emitComplete({ exitCode: 0 });

    expect(handle.isRunning).toBe(false);
    expect(result?.exitCode).toBe(0);
  });

  it("kill sets isRunning to false", () => {
    const handle = wrapAsAgentHandle("session-3", undefined);
    expect(handle.isRunning).toBe(true);
    handle.kill();
    expect(handle.isRunning).toBe(false);
  });
});
