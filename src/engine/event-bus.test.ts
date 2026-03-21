import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";

describe("EventBus", () => {
  it("emits and receives typed events", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("agent:spawned", handler);
    bus.emit("agent:spawned", {
      sessionId: "s1",
      repo: "owner/repo",
      issueNumber: 42,
      phase: "impl",
    });

    expect(handler).toHaveBeenCalledWith({
      sessionId: "s1",
      repo: "owner/repo",
      issueNumber: 42,
      phase: "impl",
    });
  });

  it("supports once listeners", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once("mutation:completed", handler);
    bus.emit("mutation:completed", { description: "first" });
    bus.emit("mutation:completed", { description: "second" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ description: "first" });
  });

  it("removes listeners with off", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("data:refreshed", handler);
    bus.off("data:refreshed", handler);
    bus.emit("data:refreshed", { data: {} as never });

    expect(handler).not.toHaveBeenCalled();
  });

  it("removeAllListeners clears all handlers for an event", () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on("agent:failed", h1);
    bus.on("agent:failed", h2);
    bus.removeAllListeners("agent:failed");
    bus.emit("agent:failed", {
      sessionId: "s1",
      repo: "r",
      issueNumber: 1,
      phase: "test",
      exitCode: 1,
    });

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });
});
