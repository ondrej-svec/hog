/**
 * Ensure the hogd daemon is running, auto-starting it if needed.
 */

import { isDaemonRunning } from "./hogd.js";

/** Auto-start daemon if not running. Returns true if daemon is available. */
export async function ensureDaemonRunning(): Promise<boolean> {
  if (isDaemonRunning()) return true;

  const { spawn: spawnProcess } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");

  const cliPath = fileURLToPath(import.meta.url)
    .replace(/daemon\/ensure-daemon\.js$/, "cli.js")
    .replace(/daemon\/ensure-daemon\.ts$/, "cli.ts");

  const { openSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { CONFIG_DIR } = await import("../config.js");

  // Log daemon stderr to a file so startup failures are diagnosable
  const logPath = join(CONFIG_DIR, "hogd.log");
  const logFd = openSync(logPath, "a");

  const child = spawnProcess(process.execPath, [cliPath, "daemon", "start", "--foreground"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();

  // Wait for daemon to start (up to 5 seconds)
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (isDaemonRunning()) return true;
  }

  // Daemon didn't start — show the log
  try {
    const { readFileSync } = await import("node:fs");
    const log = readFileSync(logPath, "utf-8").trim().split("\n").slice(-5).join("\n");
    if (log) {
      process.stderr.write(`[hogd] Daemon failed to start. Log:\n${log}\n`);
    }
  } catch {
    // best-effort
  }

  return false;
}
