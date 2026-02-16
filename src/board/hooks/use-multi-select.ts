import { useCallback, useRef, useState } from "react";

export interface UseMultiSelectResult {
  /** Currently selected item IDs */
  selected: ReadonlySet<string>;
  /** How many items are selected */
  count: number;
  /** Whether a specific item is selected */
  isSelected: (id: string) => boolean;
  /** Toggle selection for one item. Returns the new set. */
  toggle: (id: string) => void;
  /** Clear all selections */
  clear: () => void;
  /** Remove selected IDs that are no longer in the valid set */
  prune: (validIds: ReadonlySet<string>) => void;
  /** The repo constraint — only items from this repo can be selected */
  constrainedRepo: string | null;
}

/**
 * Tracks multi-select state for the board.
 *
 * Constraint: all selected items must belong to the same repo section.
 * If the user toggles an item from a different repo, the selection resets
 * to just that item.
 */
export function useMultiSelect(getRepoForId: (id: string) => string | null): UseMultiSelectResult {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const repoRef = useRef<string | null>(null);
  const getRepoRef = useRef(getRepoForId);
  getRepoRef.current = getRepoForId;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const repo = getRepoRef.current(id);
      // Headers and non-repo items can't be selected
      if (!repo) return prev;

      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
        if (next.size === 0) repoRef.current = null;
      } else {
        // Different repo? Reset to just this item
        if (repoRef.current && repoRef.current !== repo) {
          next.clear();
        }
        repoRef.current = repo;
        next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    repoRef.current = null;
  }, []);

  const prune = useCallback((validIds: ReadonlySet<string>) => {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      if (next.size === prev.size) return prev; // no change
      if (next.size === 0) repoRef.current = null;
      return next;
    });
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return {
    selected,
    count: selected.size,
    isSelected,
    toggle,
    clear,
    prune,
    constrainedRepo: repoRef.current,
  };
}
