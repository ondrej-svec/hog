import { spawn } from "node:child_process";
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
    // Use multi-statement osascript with JSON.stringify for safe variable binding,
    // preventing AppleScript injection via crafted titles/bodies.
    const child = spawn(
      "osascript",
      [
        "-e",
        `set theBody to ${JSON.stringify(body)}`,
        "-e",
        `set theTitle to ${JSON.stringify(title)}`,
        "-e",
        "display notification theBody with title theTitle",
      ],
      { stdio: "ignore", detached: true },
    );
    child.unref();
  } else {
    // Pass title and body as separate argv arguments — no shell interpolation.
    const child = spawn("notify-send", [title, body], { stdio: "ignore", detached: true });
    child.unref();
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
export function notify(config: NotificationsConfig | undefined, opts: NotificationOptions): void {
  if (!config) return;
  if (config.os) {
    sendOsNotification(opts);
  }
  if (config.sound) {
    sendSoundNotification();
  }
}
