import { useRef } from "react";

/** Scroll margin: keep at least this many rows visible above/below the cursor. */
const SCROLL_MARGIN = 2;

export interface ViewportScrollResult {
  /** Index of the first visible row in the full list. */
  scrollOffset: number;
  /** Number of data rows visible (after subtracting indicator rows). */
  visibleCount: number;
  /** Whether there are items above the viewport. */
  hasMoreAbove: boolean;
  /** Whether there are items below the viewport. */
  hasMoreBelow: boolean;
  /** Number of items above the viewport. */
  aboveCount: number;
  /** Number of items below the viewport. */
  belowCount: number;
}

/**
 * Compute viewport scroll state for a list.
 *
 * This is a pure calculation (not a hook) that computes what's visible given:
 * - totalItems: the total number of rows in the list
 * - contentRowCount: max rows that fit in the panel (panel height - chrome)
 * - cursorIndex: the index of the selected item in the full list
 * - currentOffset: the current scroll offset (managed externally via ref)
 *
 * Returns the new scroll offset and visibility info. The caller is responsible
 * for storing the new scrollOffset back into its ref.
 */
export function computeViewportScroll(
  totalItems: number,
  contentRowCount: number,
  cursorIndex: number,
  currentOffset: number,
): ViewportScrollResult {
  if (totalItems === 0 || contentRowCount <= 0) {
    return {
      scrollOffset: 0,
      visibleCount: 0,
      hasMoreAbove: false,
      hasMoreBelow: false,
      aboveCount: 0,
      belowCount: 0,
    };
  }

  // Phase 1: Determine scroll offset with scroll margin
  let offset = currentOffset;
  const effectiveMargin = Math.min(SCROLL_MARGIN, Math.floor(contentRowCount / 4));

  if (cursorIndex >= 0) {
    // Scroll up if cursor is above the viewport + margin
    if (cursorIndex < offset + effectiveMargin) {
      offset = Math.max(0, cursorIndex - effectiveMargin);
    }
    // Scroll down if cursor is below the viewport - margin
    if (cursorIndex >= offset + contentRowCount - effectiveMargin) {
      offset = cursorIndex - contentRowCount + effectiveMargin + 1;
    }
  }

  // Phase 2: Determine if indicators are needed (they steal content rows)
  const needsAboveIndicator = offset > 0;
  // Tentative check for below indicator before accounting for indicator rows
  const tentativeVisibleCount = contentRowCount - (needsAboveIndicator ? 1 : 0);
  const needsBelowIndicator = offset + tentativeVisibleCount < totalItems;

  // Final visible count accounting for both indicators
  const indicatorRows = (needsAboveIndicator ? 1 : 0) + (needsBelowIndicator ? 1 : 0);
  const visibleCount = Math.max(1, contentRowCount - indicatorRows);

  // Phase 3: Re-check if cursor is still visible after indicator adjustment
  // and adjust offset if needed
  if (cursorIndex >= 0) {
    if (cursorIndex < offset) {
      offset = cursorIndex;
    } else if (cursorIndex >= offset + visibleCount) {
      offset = cursorIndex - visibleCount + 1;
    }
  }

  // Clamp offset
  const maxOffset = Math.max(0, totalItems - visibleCount);
  offset = Math.max(0, Math.min(offset, maxOffset));

  // Final indicator state (may have changed after re-clamping)
  const hasMoreAbove = offset > 0;
  const hasMoreBelow = offset + visibleCount < totalItems;

  return {
    scrollOffset: offset,
    visibleCount,
    hasMoreAbove,
    hasMoreBelow,
    aboveCount: offset,
    belowCount: Math.max(0, totalItems - offset - visibleCount),
  };
}

/**
 * Hook that manages scrollable viewport state for a panel.
 *
 * Tracks scroll offset in a ref and recomputes on cursor/size changes.
 * Automatically resets scroll when resetKey changes (e.g., switching repos).
 */
export function useViewportScroll(
  totalItems: number,
  contentRowCount: number,
  cursorIndex: number,
  resetKey: string,
): ViewportScrollResult {
  const scrollRef = useRef(0);
  const prevResetKeyRef = useRef(resetKey);

  // Reset scroll when context changes
  if (resetKey !== prevResetKeyRef.current) {
    prevResetKeyRef.current = resetKey;
    scrollRef.current = 0;
  }

  const result = computeViewportScroll(totalItems, contentRowCount, cursorIndex, scrollRef.current);

  // Store the computed offset for next render
  scrollRef.current = result.scrollOffset;

  return result;
}

/**
 * Compute the target cursor index for a page-down operation.
 */
export function pageDownIndex(currentIndex: number, totalItems: number, pageSize: number): number {
  return Math.min(totalItems - 1, currentIndex + pageSize);
}

/**
 * Compute the target cursor index for a page-up operation.
 */
export function pageUpIndex(currentIndex: number, pageSize: number): number {
  return Math.max(0, currentIndex - pageSize);
}
