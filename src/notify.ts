import { spawnSync } from "node:child_process";
import type { BoardConfig } from "./config.js";

// ── Types ──

interface NotificationOptions {
  readonly title: string;
  readonly body: string;
}

type NotificationsConfig = NonNullable<NonNullable<BoardConfig["workflow"]>["notifications"]>;

// ── OS Notification ──

/** Send a native OS notification (macOS: osascript, Linux: notify-send). */
export function sendOsNotification(opts: NotificationOptions): void {
  const { title, body } = opts;

  if (process.platform === "darwin") {
    // Escape double-quotes for osascript
    const safeTitle = title.replace(/"/g, '\\"');
    const safeBody = body.replace(/"/g, '\\"');
    spawnSync("osascript", [
      "-e",
      `display notification "${safeBody}" with title "${safeTitle}"`,
    ]);
  } else {
    spawnSync("notify-send", [title, body]);
  }
}

// ── Sound Notification ──

/** Send a terminal bell character to stdout. */
export function sendSoundNotification(): void {
  process.stdout.write("\x07");
}

// ── Convenience ──

/**
 * Send notifications based on config. Calls OS notification and/or sound
 * depending on the `notifications` config object.
 */
export function notify(
  config: NotificationsConfig | undefined,
  opts: NotificationOptions,
): void {
  if (!config) return;
  if (config.os) {
    sendOsNotification(opts);
  }
  if (config.sound) {
    sendSoundNotification();
  }
}
