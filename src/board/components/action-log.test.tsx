import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLogEntry } from "../hooks/use-action-log.js";
import type { ActionLogProps } from "./action-log.js";
import { ActionLog } from "./action-log.js";

function makeEntry(id: string, overrides: Partial<ActionLogEntry> = {}): ActionLogEntry {
  return {
    id,
    description: `action ${id}`,
    status: "success",
    ago: Date.now(),
    ...overrides,
  };
}

function renderActionLog(props: ActionLogProps) {
  return render(React.createElement(ActionLog, props));
}

describe("ActionLog", () => {
  it("shows 'No actions yet.' when entries is empty", () => {
    const { lastFrame } = renderActionLog({ entries: [] });
    expect(lastFrame() ?? "").toContain("No actions yet.");
  });

  it("shows the Action Log heading", () => {
    const { lastFrame } = renderActionLog({ entries: [] });
    expect(lastFrame() ?? "").toContain("Action Log");
  });

  it("shows success entry with check mark and description", () => {
    const entry = makeEntry("1", { status: "success", description: "Closed issue #42" });
    const { lastFrame } = renderActionLog({ entries: [entry] });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✓");
    expect(frame).toContain("Closed issue #42");
  });

  it("shows error entry with cross mark", () => {
    const entry = makeEntry("1", { status: "error", description: "Failed to close" });
    const { lastFrame } = renderActionLog({ entries: [entry] });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✗");
    expect(frame).toContain("Failed to close");
  });

  it("shows pending entry with ellipsis", () => {
    const entry = makeEntry("1", { status: "pending", description: "Saving..." });
    const { lastFrame } = renderActionLog({ entries: [entry] });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("⋯");
    expect(frame).toContain("Saving...");
  });

  it("shows only last 5 entries when more than 5 are provided", () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      makeEntry(String(i + 1), { description: `action ${i + 1}` }),
    );
    const { lastFrame } = renderActionLog({ entries });
    const frame = lastFrame() ?? "";
    // First two entries (action 1 and action 2) should NOT appear
    expect(frame).not.toContain("action 1");
    expect(frame).not.toContain("action 2");
    // Last 5 entries should appear
    expect(frame).toContain("action 3");
    expect(frame).toContain("action 7");
  });

  it("shows [u: undo] on the last undoable entry", () => {
    const undoFn = vi.fn().mockResolvedValue(undefined);
    const entries = [
      makeEntry("1", { description: "first", undo: undoFn }),
      makeEntry("2", { description: "second" }),
    ];
    const { lastFrame } = renderActionLog({ entries });
    const frame = lastFrame() ?? "";
    // The last undoable is entry "1" (reversed: entry 2 has no undo, entry 1 has undo)
    expect(frame).toContain("[u: undo]");
  });

  it("shows [retry] on error entries that have a retry fn", () => {
    const retryFn = vi.fn();
    const entry = makeEntry("1", { status: "error", retry: retryFn });
    const { lastFrame } = renderActionLog({ entries: [entry] });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[retry]");
  });

  it("does not show [retry] on success entries with retry fn", () => {
    const retryFn = vi.fn();
    const entry = makeEntry("1", { status: "success", retry: retryFn });
    const { lastFrame } = renderActionLog({ entries: [entry] });
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("[retry]");
  });

  describe("relativeTime display", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows '0s ago' for a just-added entry", () => {
      vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
      const entry = makeEntry("1", { ago: Date.now() });
      const { lastFrame } = renderActionLog({ entries: [entry] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("0s ago");
    });

    it("shows minutes ago for entries older than 60 seconds", () => {
      vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      const entry = makeEntry("1", { ago: twoMinutesAgo });
      const { lastFrame } = renderActionLog({ entries: [entry] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("2m ago");
    });

    it("shows hours ago for entries older than 60 minutes", () => {
      vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const entry = makeEntry("1", { ago: twoHoursAgo });
      const { lastFrame } = renderActionLog({ entries: [entry] });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("2h ago");
    });
  });
});
