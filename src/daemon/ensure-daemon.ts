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

  const child = spawnProcess(process.execPath, [cliPath, "daemon", "start", "--foreground"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Wait for daemon to start (up to 3 seconds)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (isDaemonRunning()) return true;
  }

  return false;
}
