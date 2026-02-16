import { parentPort, workerData } from "node:worker_threads";
import type { HogConfig } from "../config.js";
import type { FetchOptions } from "./fetch.js";

const { config, options } = workerData as { config: HogConfig; options: FetchOptions };

const { fetchDashboard } = await import("./fetch.js");

try {
  const data = await fetchDashboard(config, options);
  parentPort!.postMessage({ type: "success", data });
} catch (err) {
  parentPort!.postMessage({
    type: "error",
    error: err instanceof Error ? err.message : String(err),
  });
}
