import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { BulkActionMenu, getMenuItems } from "./bulk-action-menu.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Pure function tests ──

describe("getMenuItems", () => {
  it("should return assign, unassign, and statusChange actions", () => {
    const items = getMenuItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.action.type)).toEqual(["assign", "unassign", "statusChange"]);
  });
});

// ── Component tests ──

describe("BulkActionMenu", () => {
  it("should render count and menu items", async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const instance = render(
      React.createElement(BulkActionMenu, {
        count: 3,
        onSelect,
        onCancel,
      }),
    );
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("3 selected");
    expect(frame).toContain("Assign all to me");
    expect(frame).toContain("Unassign all from me");
    expect(frame).toContain("Move status (all)");

    instance.unmount();
  });

  it("should call onSelect when Enter is pressed", async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const instance = render(
      React.createElement(BulkActionMenu, {
        count: 2,
        onSelect,
        onCancel,
      }),
    );
    await delay(50);

    // Default selection is first item (Assign all to me)
    instance.stdin.write("\r");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith({ type: "assign" });

    instance.unmount();
  });

  it("should navigate and select second item", async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const instance = render(
      React.createElement(BulkActionMenu, {
        count: 2,
        onSelect,
        onCancel,
      }),
    );
    await delay(50);

    // Move down to "Unassign all from me"
    instance.stdin.write("j");
    await delay(50);
    instance.stdin.write("\r");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith({ type: "unassign" });

    instance.unmount();
  });

  it("should call onCancel on Escape", async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const instance = render(
      React.createElement(BulkActionMenu, {
        count: 1,
        onSelect,
        onCancel,
      }),
    );
    await delay(50);

    instance.stdin.write("\x1b");
    await delay(50);

    expect(onCancel).toHaveBeenCalled();

    instance.unmount();
  });
});
