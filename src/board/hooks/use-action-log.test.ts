import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLogEntry, UseActionLogResult } from "./use-action-log.js";
import { nextEntryId, resetEntryIdCounter, useActionLog } from "./use-action-log.js";
import type { ToastAPI } from "./use-toast.js";

// ── Test helpers ──

function makeMockToast() {
  return {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => ({ resolve: vi.fn(), reject: vi.fn() })),
  } satisfies ToastAPI;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeEntry(id: string, overrides: Partial<ActionLogEntry> = {}): ActionLogEntry {
  return {
    id,
    description: `action ${id}`,
    status: "success",
    ago: Date.now(),
    ...overrides,
  };
}

// ── Test component that renders useActionLog and exposes its API ──

// biome-ignore lint/style/useNamingConvention: React component used in tests via React.createElement
function ActionLogTester({ toast, refresh }: { toast: ToastAPI; refresh: () => void }) {
  const result = useActionLog(toast, refresh);
  (globalThis as Record<string, unknown>)["__actionLog"] = result;

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, null, `count:${result.entries.length}`),
    React.createElement(Text, null, `hasUndoable:${result.hasUndoable ? "yes" : "no"}`),
    result.entries.map((e) =>
      React.createElement(Text, { key: e.id }, `entry:${e.id}:${e.description}`),
    ),
  );
}

function getActionLog(): UseActionLogResult {
  return (globalThis as Record<string, unknown>)["__actionLog"] as UseActionLogResult;
}

// ── nextEntryId ──

describe("nextEntryId", () => {
  beforeEach(() => {
    resetEntryIdCounter();
  });

  it("returns incrementing string IDs starting at 1", () => {
    expect(nextEntryId()).toBe("1");
    expect(nextEntryId()).toBe("2");
    expect(nextEntryId()).toBe("3");
  });

  it("resets correctly after resetEntryIdCounter", () => {
    nextEntryId();
    nextEntryId();
    resetEntryIdCounter();
    expect(nextEntryId()).toBe("1");
  });
});

// ── useActionLog ──

describe("useActionLog", () => {
  beforeEach(() => {
    resetEntryIdCounter();
    vi.clearAllMocks();
  });

  it("starts with empty entries and hasUndoable=false", async () => {
    const mockToast = makeMockToast();
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("count:0");
    expect(frame).toContain("hasUndoable:no");

    instance.unmount();
  });

  it("pushEntry adds an entry", async () => {
    const mockToast = makeMockToast();
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    getActionLog().pushEntry(makeEntry("1"));
    await delay(50);

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("count:1");
    expect(frame).toContain("entry:1:action 1");

    instance.unmount();
  });

  it("pushEntry keeps last 10 entries when more than 10 are pushed", async () => {
    const mockToast = makeMockToast();
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    for (let i = 1; i <= 12; i++) {
      getActionLog().pushEntry(makeEntry(String(i)));
      await delay(10);
    }

    await delay(50);
    const frame = instance.lastFrame() ?? "";
    // Only 10 entries kept
    expect(frame).toContain("count:10");
    // First entry should be entry 3 (1 and 2 evicted)
    expect(frame).not.toContain("entry:1:action 1");
    expect(frame).not.toContain("entry:2:action 2");
    expect(frame).toContain("entry:3:action 3");

    instance.unmount();
  });

  it("hasUndoable is false when no entries have an undo fn", async () => {
    const mockToast = makeMockToast();
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    getActionLog().pushEntry(makeEntry("1", { status: "success" }));
    getActionLog().pushEntry(makeEntry("2", { status: "error" }));
    await delay(50);

    expect(instance.lastFrame() ?? "").toContain("hasUndoable:no");

    instance.unmount();
  });

  it("hasUndoable is true when an entry has an undo fn", async () => {
    const mockToast = makeMockToast();
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    getActionLog().pushEntry(makeEntry("1", { undo: async () => {} }));
    await delay(50);

    expect(instance.lastFrame() ?? "").toContain("hasUndoable:yes");

    instance.unmount();
  });

  it("undoLast calls toast.info when no undoable entries exist", async () => {
    const mockToast = makeMockToast();
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    getActionLog().pushEntry(makeEntry("1", { status: "success" }));
    await delay(50);

    await getActionLog().undoLast();

    expect(mockToast.info).toHaveBeenCalledWith("Nothing to undo");

    instance.unmount();
  });

  it("undoLast with no entries at all calls toast.info", async () => {
    const mockToast = makeMockToast();
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    await getActionLog().undoLast();

    expect(mockToast.info).toHaveBeenCalledWith("Nothing to undo");

    instance.unmount();
  });

  it("undoLast calls the undo fn and resolves toast on success", async () => {
    const resolveToast = vi.fn();
    const rejectToast = vi.fn();
    const mockToast = makeMockToast();
    mockToast.loading.mockReturnValue({ resolve: resolveToast, reject: rejectToast });

    const undoFn = vi.fn().mockResolvedValue(undefined);
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    getActionLog().pushEntry(makeEntry("1", { description: "test action", undo: undoFn }));
    await delay(50);

    await getActionLog().undoLast();

    expect(undoFn).toHaveBeenCalledOnce();
    expect(mockToast.loading).toHaveBeenCalledWith("Undoing: test action");
    expect(resolveToast).toHaveBeenCalledWith("Undone: test action");

    instance.unmount();
  });

  it("undoLast clears the undo fn after execution (hasUndoable becomes false)", async () => {
    const mockToast = makeMockToast();
    mockToast.loading.mockReturnValue({ resolve: vi.fn(), reject: vi.fn() });

    const undoFn = vi.fn().mockResolvedValue(undefined);
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    getActionLog().pushEntry(makeEntry("1", { undo: undoFn }));
    await delay(50);
    expect(instance.lastFrame() ?? "").toContain("hasUndoable:yes");

    await getActionLog().undoLast();
    await delay(50);

    expect(instance.lastFrame() ?? "").toContain("hasUndoable:no");

    instance.unmount();
  });

  it("undoLast calls toast reject and refresh when undo fn throws", async () => {
    const rejectToast = vi.fn();
    const mockToast = makeMockToast();
    mockToast.loading.mockReturnValue({ resolve: vi.fn(), reject: rejectToast });

    const error = new Error("undo failed");
    const undoFn = vi.fn().mockRejectedValue(error);
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    getActionLog().pushEntry(makeEntry("1", { description: "failing action", undo: undoFn }));
    await delay(50);

    await getActionLog().undoLast();

    expect(rejectToast).toHaveBeenCalledWith("Undo failed: undo failed");
    expect(mockRefresh).toHaveBeenCalledOnce();

    instance.unmount();
  });

  it("undoLast finds the most recent undoable entry", async () => {
    const resolveToast = vi.fn();
    const mockToast = makeMockToast();
    mockToast.loading.mockReturnValue({ resolve: resolveToast, reject: vi.fn() });

    const undoFn1 = vi.fn().mockResolvedValue(undefined);
    const undoFn2 = vi.fn().mockResolvedValue(undefined);
    const mockRefresh = vi.fn();
    const instance = render(
      React.createElement(ActionLogTester, { toast: mockToast, refresh: mockRefresh }),
    );
    await delay(50);

    getActionLog().pushEntry(makeEntry("1", { description: "first", undo: undoFn1 }));
    await delay(20);
    getActionLog().pushEntry(makeEntry("2", { description: "second", undo: undoFn2 }));
    await delay(50);

    await getActionLog().undoLast();

    // Should undo entry 2 (most recent undoable)
    expect(undoFn2).toHaveBeenCalledOnce();
    expect(undoFn1).not.toHaveBeenCalled();

    instance.unmount();
  });
});
