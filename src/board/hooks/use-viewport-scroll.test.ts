import { describe, expect, it } from "vitest";
import { computeViewportScroll, pageDownIndex, pageUpIndex } from "./use-viewport-scroll.js";

describe("computeViewportScroll", () => {
  it("returns empty state for zero items", () => {
    const result = computeViewportScroll(0, 10, -1, 0);
    expect(result.scrollOffset).toBe(0);
    expect(result.visibleCount).toBe(0);
    expect(result.hasMoreAbove).toBe(false);
    expect(result.hasMoreBelow).toBe(false);
  });

  it("shows all items when they fit in the viewport", () => {
    const result = computeViewportScroll(5, 10, 2, 0);
    expect(result.scrollOffset).toBe(0);
    // visibleCount is the viewport capacity (no indicators needed)
    expect(result.visibleCount).toBe(10);
    expect(result.hasMoreAbove).toBe(false);
    expect(result.hasMoreBelow).toBe(false);
  });

  it("shows below indicator when items exceed viewport", () => {
    const result = computeViewportScroll(20, 10, 0, 0);
    expect(result.scrollOffset).toBe(0);
    expect(result.hasMoreAbove).toBe(false);
    expect(result.hasMoreBelow).toBe(true);
    // One row reserved for below indicator
    expect(result.visibleCount).toBe(9);
    expect(result.belowCount).toBe(11);
  });

  it("shows both indicators when scrolled to the middle", () => {
    const result = computeViewportScroll(30, 10, 15, 12);
    expect(result.hasMoreAbove).toBe(true);
    expect(result.hasMoreBelow).toBe(true);
    // Two rows reserved for indicators
    expect(result.visibleCount).toBe(8);
  });

  it("follows cursor down with scroll margin", () => {
    // Cursor at index 15, viewport was showing 0-9
    const result = computeViewportScroll(30, 10, 15, 0);
    expect(result.scrollOffset).toBeGreaterThan(0);
    // Cursor should be visible
    expect(result.scrollOffset).toBeLessThanOrEqual(15);
    expect(result.scrollOffset + result.visibleCount).toBeGreaterThan(15);
  });

  it("follows cursor up", () => {
    // Cursor at index 2, viewport was showing 10-19
    const result = computeViewportScroll(30, 10, 2, 10);
    expect(result.scrollOffset).toBeLessThanOrEqual(2);
    expect(result.scrollOffset + result.visibleCount).toBeGreaterThan(2);
  });

  it("clamps offset to valid range", () => {
    // Offset way beyond max
    const result = computeViewportScroll(5, 10, 3, 100);
    expect(result.scrollOffset).toBe(0);
  });

  it("handles single item", () => {
    const result = computeViewportScroll(1, 10, 0, 0);
    expect(result.scrollOffset).toBe(0);
    // visibleCount is the viewport capacity; slice(0, 10) on a 1-item array safely returns [item]
    expect(result.visibleCount).toBe(10);
    expect(result.hasMoreAbove).toBe(false);
    expect(result.hasMoreBelow).toBe(false);
  });

  it("handles viewport of 1 row", () => {
    const result = computeViewportScroll(10, 1, 5, 0);
    expect(result.visibleCount).toBe(1);
    expect(result.scrollOffset).toBe(5);
  });

  it("keeps cursor visible at the bottom of the list", () => {
    const result = computeViewportScroll(20, 10, 19, 0);
    // Cursor should be in view
    expect(result.scrollOffset + result.visibleCount).toBeGreaterThan(19);
    expect(result.hasMoreAbove).toBe(true);
    expect(result.hasMoreBelow).toBe(false);
  });
});

describe("pageDownIndex", () => {
  it("moves down by page size", () => {
    expect(pageDownIndex(5, 20, 10)).toBe(15);
  });

  it("clamps to last item", () => {
    expect(pageDownIndex(15, 20, 10)).toBe(19);
  });
});

describe("pageUpIndex", () => {
  it("moves up by page size", () => {
    expect(pageUpIndex(15, 10)).toBe(5);
  });

  it("clamps to first item", () => {
    expect(pageUpIndex(3, 10)).toBe(0);
  });
});
