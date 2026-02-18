import { Worker } from "node:worker_threads";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HogConfig } from "../../config.js";
import type { DashboardData, FetchOptions } from "../fetch.js";

export type DataStatus = "loading" | "success" | "error";

export interface DataState {
  status: DataStatus;
  data: DashboardData | null;
  error: string | null;
  lastRefresh: Date | null;
  isRefreshing: boolean;
  consecutiveFailures: number;
  autoRefreshPaused: boolean;
}

const INITIAL_STATE: DataState = {
  status: "loading",
  data: null,
  error: null,
  lastRefresh: null,
  isRefreshing: false,
  consecutiveFailures: 0,
  autoRefreshPaused: false,
};

/** Stale thresholds for refresh age color */
export const STALE_THRESHOLDS = {
  FRESH: 60_000, // 0-60s → green
  AGING: 300_000, // 60s-5m → yellow
  // 5m+ → red
} as const;

/** Maximum consecutive failures before pausing auto-refresh */
export const MAX_REFRESH_FAILURES = 3;

/** Compute age color based on time since last refresh */
export function refreshAgeColor(lastRefresh: Date | null): "green" | "yellow" | "red" | "gray" {
  if (!lastRefresh) return "gray";
  const age = Date.now() - lastRefresh.getTime();
  if (age < STALE_THRESHOLDS.FRESH) return "green";
  if (age < STALE_THRESHOLDS.AGING) return "yellow";
  return "red";
}

export function useData(
  config: HogConfig,
  options: FetchOptions,
  refreshIntervalMs: number,
): DataState & {
  refresh: () => void;
  mutateData: (fn: (data: DashboardData) => DashboardData) => void;
  pauseAutoRefresh: () => void;
  resumeAutoRefresh: () => void;
} {
  const [state, setState] = useState<DataState>(INITIAL_STATE);
  const activeRequestRef = useRef<{ canceled: boolean } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Store config/options in refs so refresh callback is stable
  const configRef = useRef(config);
  const optionsRef = useRef(options);
  configRef.current = config;
  optionsRef.current = options;

  const refresh = useCallback(() => {
    // Cancel any in-flight request
    if (activeRequestRef.current) {
      activeRequestRef.current.canceled = true;
    }
    workerRef.current?.terminate();

    const token = { canceled: false };
    activeRequestRef.current = token;

    setState((prev) => ({ ...prev, isRefreshing: true }));

    const worker = new Worker(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "../fetch-worker.ts" // dev: tsx running source
          : "./fetch-worker.js", // prod: tsup bundle in dist/
        import.meta.url,
      ),
      { workerData: { config: configRef.current, options: optionsRef.current } },
    );
    workerRef.current = worker;

    worker.on("message", (msg: { type: string; data?: DashboardData; error?: string }) => {
      if (token.canceled) {
        worker.terminate();
        return;
      }

      if (msg.type === "success" && msg.data) {
        // Revive Date objects (structured clone preserves them, but defensive)
        const data = msg.data;
        data.fetchedAt = new Date(data.fetchedAt);
        for (const ev of data.activity) {
          ev.timestamp = new Date(ev.timestamp);
        }

        setState({
          status: "success",
          data,
          error: null,
          lastRefresh: new Date(),
          isRefreshing: false,
          consecutiveFailures: 0,
          autoRefreshPaused: false,
        });
      } else {
        setState((prev) => {
          const failures = prev.consecutiveFailures + 1;
          return {
            ...prev,
            status: prev.data ? "success" : "error",
            error: msg.error ?? "Unknown error",
            isRefreshing: false,
            consecutiveFailures: failures,
            autoRefreshPaused: failures >= MAX_REFRESH_FAILURES,
          };
        });
      }
      worker.terminate();
    });

    worker.on("error", (err) => {
      if (token.canceled) return;
      setState((prev) => {
        const failures = prev.consecutiveFailures + 1;
        return {
          ...prev,
          status: prev.data ? "success" : "error",
          error: err.message,
          isRefreshing: false,
          consecutiveFailures: failures,
          autoRefreshPaused: failures >= MAX_REFRESH_FAILURES,
        };
      });
    });
  }, []);

  // Initial fetch — runs once on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh interval — skips when paused
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (refreshIntervalMs <= 0) return;

    intervalRef.current = setInterval(() => {
      if (!stateRef.current.autoRefreshPaused) {
        refresh();
      }
    }, refreshIntervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refresh, refreshIntervalMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeRequestRef.current) {
        activeRequestRef.current.canceled = true;
      }
      workerRef.current?.terminate();
    };
  }, []);

  /** Locally mutate data without fetching (for optimistic updates). */
  const mutateData = useCallback((fn: (data: DashboardData) => DashboardData) => {
    setState((prev) => {
      if (!prev.data) return prev;
      return { ...prev, data: fn(prev.data) };
    });
  }, []);

  const pauseAutoRefresh = useCallback(() => {
    setState((prev) => ({ ...prev, autoRefreshPaused: true }));
  }, []);

  const resumeAutoRefresh = useCallback(() => {
    setState((prev) => ({ ...prev, autoRefreshPaused: false }));
  }, []);

  return { ...state, refresh, mutateData, pauseAutoRefresh, resumeAutoRefresh };
}
