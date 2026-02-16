import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HogConfig } from "../../config.js";
import type { DashboardData, FetchOptions } from "../fetch.js";
import { refreshAgeColor } from "./use-data.js";

// Mock Worker: simulates the fetch-worker.ts behavior using mockFetchDashboard
const mockFetchDashboard = vi.fn();

vi.mock("node:worker_threads", () => ({
  Worker: class MockWorker {
    private handlers = new Map<string, (...args: unknown[]) => void>();

    constructor(_url: URL | string, opts: { workerData: { config: unknown; options: unknown } }) {
      setTimeout(async () => {
        try {
          const data = await mockFetchDashboard(opts.workerData.config, opts.workerData.options);
          this.handlers.get("message")?.({ type: "success", data });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.handlers.get("message")?.({ type: "error", error: message });
        }
      }, 0);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    terminate() {}
  },
}));

import { useData } from "./use-data.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeConfig(): HogConfig {
  return {
    version: 3,
    repos: [],
    board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej", focusDuration: 1500 },
    ticktick: { enabled: true },
    profiles: {},
  };
}

function makeOptions(): FetchOptions {
  return {};
}

function makeDashboardData(): DashboardData {
  return {
    repos: [],
    ticktick: [],
    ticktickError: null,
    activity: [],
    fetchedAt: new Date("2026-02-15T12:00:00Z"),
  };
}

// Test component that renders useData hook state
function DataHookTester({
  config,
  options,
  refreshIntervalMs,
}: {
  config: HogConfig;
  options: FetchOptions;
  refreshIntervalMs: number;
}) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const result = useData(config, options, refreshIntervalMs);
  const { status, data, error, isRefreshing, consecutiveFailures, autoRefreshPaused } = result;

  // Expose for direct access in tests
  (globalThis as Record<string, unknown>)["__dataHook"] = result;

  return (
    <Box flexDirection="column">
      <Text>status:{status}</Text>
      <Text>renders:{renderCountRef.current}</Text>
      <Text>repos:{data?.repos.length ?? "null"}</Text>
      <Text>error:{error ?? "none"}</Text>
      <Text>refreshing:{isRefreshing ? "yes" : "no"}</Text>
      <Text>failures:{consecutiveFailures}</Text>
      <Text>paused:{autoRefreshPaused ? "yes" : "no"}</Text>
    </Box>
  );
}

describe("useData hook", () => {
  afterEach(() => {
    mockFetchDashboard.mockReset();
  });

  it("should render without infinite loop when data is null (loading state)", async () => {
    // Never resolve — stay in loading state
    mockFetchDashboard.mockReturnValue(new Promise(() => {}));

    const instance = render(
      React.createElement(DataHookTester, {
        config: makeConfig(),
        options: makeOptions(),
        refreshIntervalMs: 0,
      }),
    );

    await delay(100);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("status:loading");

    // Should NOT have rendered excessively
    const renderMatch = frame.match(/renders:(\d+)/);
    expect(renderMatch).toBeTruthy();
    const renderCount = parseInt(renderMatch![1]!, 10);
    expect(renderCount).toBeLessThan(10);

    instance.unmount();
  });

  it("should transition to success after fetch resolves", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData());

    const instance = render(
      React.createElement(DataHookTester, {
        config: makeConfig(),
        options: makeOptions(),
        refreshIntervalMs: 0,
      }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("status:success");
    expect(frame).toContain("repos:0");
    expect(frame).toContain("error:none");

    // fetchDashboard should have been called exactly once
    expect(mockFetchDashboard).toHaveBeenCalledTimes(1);

    instance.unmount();
  });

  it("should handle fetch errors gracefully", async () => {
    mockFetchDashboard.mockRejectedValue(new Error("Network failure"));

    const instance = render(
      React.createElement(DataHookTester, {
        config: makeConfig(),
        options: makeOptions(),
        refreshIntervalMs: 0,
      }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("status:error");
    expect(frame).toContain("error:Network failure");

    instance.unmount();
  });

  it("should use latest config/options values via refs", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData());

    const config = makeConfig();
    const options = makeOptions();

    const instance = render(
      React.createElement(DataHookTester, {
        config,
        options,
        refreshIntervalMs: 0,
      }),
    );

    await delay(200);

    // Verify fetchDashboard was called with the config and options
    expect(mockFetchDashboard).toHaveBeenCalledWith(config, options);

    instance.unmount();
  });

  it("should have bounded render count after successful fetch", async () => {
    mockFetchDashboard.mockResolvedValue(makeDashboardData());

    const instance = render(
      React.createElement(DataHookTester, {
        config: makeConfig(),
        options: makeOptions(),
        refreshIntervalMs: 0,
      }),
    );

    await delay(300);

    const frame = instance.lastFrame()!;
    const renderMatch = frame.match(/renders:(\d+)/);
    const renderCount = parseInt(renderMatch![1]!, 10);

    // After a single fetch cycle: initial render + isRefreshing + success setState
    // Should be well under 10 renders total
    expect(renderCount).toBeLessThan(10);

    instance.unmount();
  });

  it("should track consecutive failures on error", async () => {
    mockFetchDashboard.mockRejectedValue(new Error("Network error"));

    const instance = render(
      React.createElement(DataHookTester, {
        config: makeConfig(),
        options: makeOptions(),
        refreshIntervalMs: 0,
      }),
    );

    await delay(200);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("failures:1");
    expect(frame).toContain("paused:no");

    instance.unmount();
  });

  it("should reset failure counter on success", async () => {
    // First call fails, second succeeds
    mockFetchDashboard
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(makeDashboardData());

    const instance = render(
      React.createElement(DataHookTester, {
        config: makeConfig(),
        options: makeOptions(),
        refreshIntervalMs: 0,
      }),
    );

    await delay(200);

    // First fetch failed
    expect(instance.lastFrame()!).toContain("failures:1");

    // Trigger manual refresh
    const hook = (globalThis as Record<string, unknown>)["__dataHook"] as { refresh: () => void };
    hook.refresh();
    await delay(200);

    expect(instance.lastFrame()!).toContain("failures:0");
    expect(instance.lastFrame()!).toContain("paused:no");

    instance.unmount();
  });
});

describe("refreshAgeColor", () => {
  it("should return gray when no lastRefresh", () => {
    expect(refreshAgeColor(null)).toBe("gray");
  });

  it("should return green when fresh (< 60s)", () => {
    expect(refreshAgeColor(new Date(Date.now() - 30_000))).toBe("green");
  });

  it("should return yellow when aging (60s-5m)", () => {
    expect(refreshAgeColor(new Date(Date.now() - 120_000))).toBe("yellow");
  });

  it("should return red when stale (> 5m)", () => {
    expect(refreshAgeColor(new Date(Date.now() - 600_000))).toBe("red");
  });
});
