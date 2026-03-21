import type { DashboardData, FetchOptions } from "../board/fetch.js";
import { fetchDashboard } from "../board/fetch.js";
import type { HogConfig } from "../config.js";
import type { EventBus } from "./event-bus.js";

// ── FetchLoop ──

export class FetchLoop {
  private readonly config: HogConfig;
  private readonly eventBus: EventBus;
  private readonly options: FetchOptions;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastData: DashboardData | null = null;
  private fetching = false;

  constructor(config: HogConfig, eventBus: EventBus, options: FetchOptions = {}) {
    this.config = config;
    this.eventBus = eventBus;
    this.options = options;
    this.intervalMs = (config.board.refreshInterval ?? 60) * 1000;
  }

  /** Get the most recently fetched data. */
  getData(): DashboardData | null {
    return this.lastData;
  }

  /** Start polling. Performs an initial fetch immediately. */
  async start(): Promise<void> {
    await this.fetch();
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => {
        this.fetch().catch(() => {
          // error handling is inside fetch()
        });
      }, this.intervalMs);
    }
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Trigger a manual fetch. */
  async fetch(): Promise<DashboardData | null> {
    if (this.fetching) return this.lastData;
    this.fetching = true;

    try {
      const data = await fetchDashboard(this.config, this.options);
      this.lastData = data;
      this.eventBus.emit("data:refreshed", { data });
      return data;
    } catch {
      // Silently continue with last data on failure
      return this.lastData;
    } finally {
      this.fetching = false;
    }
  }
}
