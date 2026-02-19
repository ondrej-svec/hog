import { useCallback, useRef, useState } from "react";
import { appendActionLog } from "../../log-persistence.js";
import type { ToastAPI } from "./use-toast.js";

// ── Types ──

export interface ActionLogEntry {
  readonly id: string;
  readonly description: string;
  readonly status: "success" | "error" | "pending";
  readonly ago: number;
  /** undefined = not undoable */
  readonly undo?: () => Promise<void>;
  /** retry callback for error entries */
  readonly retry?: () => void;
}

export interface UseActionLogResult {
  entries: ActionLogEntry[];
  pushEntry: (entry: ActionLogEntry) => void;
  undoLast: () => Promise<void>;
  hasUndoable: boolean;
}

let entryIdCounter = 0;
export function nextEntryId(): string {
  entryIdCounter += 1;
  return String(entryIdCounter);
}

/** Reset the entry ID counter — call in beforeEach to ensure deterministic IDs in tests. */
export function resetEntryIdCounter(): void {
  entryIdCounter = 0;
}

export function useActionLog(toast: ToastAPI, refresh: () => void): UseActionLogResult {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  // Stable ref so undoLast doesn't depend on entries in its dependency array
  const entriesRef = useRef<ActionLogEntry[]>([]);
  entriesRef.current = entries;

  const pushEntry = useCallback((entry: ActionLogEntry) => {
    setEntries((prev) => [...prev.slice(-9), entry]); // keep last 10 in memory
    // Persist to disk (best-effort)
    try {
      appendActionLog({
        id: entry.id,
        description: entry.description,
        status: entry.status,
        timestamp: entry.ago,
      });
    } catch {
      // ignore persistence errors
    }
  }, []);

  const undoLast = useCallback(async () => {
    const undoable = [...entriesRef.current].reverse().find((e) => e.undo);
    if (!undoable?.undo) {
      toast.info("Nothing to undo");
      return;
    }
    const thunk = undoable.undo;
    // Clear BEFORE execution to prevent double-undo window (omit undo property entirely)
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== undoable.id) return e;
        // Omit the undo property to satisfy exactOptionalPropertyTypes
        const { undo: _removed, ...rest } = e;
        return rest;
      }),
    );
    const t = toast.loading(`Undoing: ${undoable.description}`);
    try {
      await thunk();
      t.resolve(`Undone: ${undoable.description}`);
    } catch (err) {
      t.reject(`Undo failed: ${err instanceof Error ? err.message : String(err)}`);
      refresh(); // revert optimistic state
    }
  }, [toast, refresh]);

  const hasUndoable = entries.some((e) => !!e.undo);

  return { entries, pushEntry, undoLast, hasUndoable };
}
