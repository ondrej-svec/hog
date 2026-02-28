/**
 * Shared board constants and utilities.
 * Extracted to prevent duplication across components and hooks.
 */

/** Statuses that trigger completion actions (TickTick close, project complete). */
export const TERMINAL_STATUS_RE = /^(done|shipped|won't|wont|closed|complete|completed)$/i;

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUS_RE.test(status);
}

/** Returns true if a nav ID is a header row (not a navigable issue/task). */
export function isHeaderId(id: string | null): boolean {
  return id != null && (id.startsWith("header:") || id.startsWith("sub:"));
}

/** Formats a date as a relative "Xm ago" string. */
export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

/** 0=Detail, 1=Repos, 2=Statuses, 3=Issues, 4=Activity */
export type PanelId = 0 | 1 | 2 | 3 | 4;
