/**
 * Performance benchmarks — verify key operations meet latency targets.
 *
 * These are not stress tests — they verify that baseline operations
 * complete within reasonable bounds for developer experience.
 */

import { describe, expect, it } from "vitest";

describe("Performance Benchmarks", () => {
  it("EventBus emit + listener roundtrip is under 1ms", async () => {
    const { EventBus } = await import("../engine/event-bus.js");
    const bus = new EventBus();
    let received = false;
    bus.on("agent:spawned", () => {
      received = true;
    });

    const start = performance.now();
    bus.emit("agent:spawned", {
      sessionId: "perf-test",
      repo: "test/repo",
      issueNumber: 0,
      phase: "impl",
    });
    const elapsed = performance.now() - start;

    expect(received).toBe(true);
    expect(elapsed).toBeLessThan(1);
  });

  it("PipelineStore instantiation is under 50ms", async () => {
    const { PipelineStore } = await import("../engine/pipeline-store.js");
    const start = performance.now();
    const store = new PipelineStore({
      repos: [],
      pipeline: { owner: "perf", maxConcurrentAgents: 3, tddEnforcement: true, worker: "claude" },
    } as any);
    const elapsed = performance.now() - start;

    expect(store).toBeDefined();
    expect(elapsed).toBeLessThan(50);
  });

  it("summary-parser checks are under 0.1ms per check", async () => {
    const { checkSummaryForFailure } = await import("../engine/summary-parser.js");

    const summary =
      "I was unable to complete the implementation due to missing dependencies. The build FAILED with 3 errors. Manual intervention is required.";
    const iterations = 1000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      checkSummaryForFailure(summary, "impl");
    }
    const elapsed = performance.now() - start;
    const perCheck = elapsed / iterations;

    expect(perCheck).toBeLessThan(0.1); // <0.1ms per check
  });

  it("policy loading from empty dir is under 5ms", async () => {
    const { loadPolicies } = await import("../engine/policy.js");

    const start = performance.now();
    const policies = loadPolicies("/nonexistent/path");
    const elapsed = performance.now() - start;

    expect(policies).toEqual([]);
    expect(elapsed).toBeLessThan(5);
  });

  it("humanizeTool processes 100 tool strings in under 5ms", async () => {
    const { humanizeTool } = await import("../board/humanize.js");

    const tools = [
      "Read (src/engine/scout.ts:142)",
      "Edit (src/pipeline/scout.ts)",
      "Bash (npm test)",
      "Grep (fetchRSS)",
      "Write (config.py)",
      "Glob (*.test.ts)",
      "Bash (git commit -m 'fix')",
      "TodoWrite",
      "Agent",
      "WebSearch (claude code)",
    ];

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      humanizeTool(tools[i % tools.length]);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });
});
