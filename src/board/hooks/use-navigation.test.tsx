import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React, { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import type { NavItem } from "./use-navigation.js";
import { findFallback, useNavigation } from "./use-navigation.js";

function makeNavItems(): NavItem[] {
  return [
    { id: "header:repo", section: "repo", type: "header" },
    { id: "gh:owner/repo:1", section: "repo", type: "item" },
    { id: "gh:owner/repo:2", section: "repo", type: "item" },
    { id: "header:ticktick", section: "ticktick", type: "header" },
    { id: "tt:task-1", section: "ticktick", type: "item" },
  ];
}

// Test component that renders navigation state
function NavHookTester({ items }: { items: NavItem[] }) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const nav = useNavigation(items);

  return (
    <Box flexDirection="column">
      <Text>selected:{nav.selectedId ?? "none"}</Text>
      <Text>index:{nav.selectedIndex}</Text>
      <Text>renders:{renderCountRef.current}</Text>
    </Box>
  );
}

// Test component that changes items dynamically
function DynamicNavTester() {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const [items, setItems] = useState<NavItem[]>(makeNavItems());
  const nav = useNavigation(items);

  // Expose for testing
  (globalThis as Record<string, unknown>)["__testSetItems"] = setItems;
  (globalThis as Record<string, unknown>)["__testNav"] = nav;

  return (
    <Box flexDirection="column">
      <Text>selected:{nav.selectedId ?? "none"}</Text>
      <Text>itemCount:{items.length}</Text>
      <Text>renders:{renderCountRef.current}</Text>
    </Box>
  );
}

describe("useNavigation hook", () => {
  it("should render without infinite loop with stable items", async () => {
    const items = makeNavItems();

    const instance = render(React.createElement(NavHookTester, { items }));

    // Give React time to settle
    await new Promise((r) => setTimeout(r, 50));

    const frame = instance.lastFrame()!;
    expect(frame).toContain("selected:");

    // Should not have rendered excessively
    const renderMatch = frame.match(/renders:(\d+)/);
    expect(renderMatch).toBeTruthy();
    const renderCount = parseInt(renderMatch![1]!, 10);
    // Dispatch-during-render causes at most 1 extra render
    expect(renderCount).toBeLessThanOrEqual(5);

    instance.unmount();
  });

  it("should select the first item by default", async () => {
    const items = makeNavItems();

    const instance = render(React.createElement(NavHookTester, { items }));

    await new Promise((r) => setTimeout(r, 50));

    const frame = instance.lastFrame()!;
    // First item should be selected
    expect(frame).toContain("selected:header:repo");
    expect(frame).toContain("index:0");

    instance.unmount();
  });

  it("should not infinite-loop when items change reference", async () => {
    const instance = render(React.createElement(DynamicNavTester));

    await new Promise((r) => setTimeout(r, 50));

    let frame = instance.lastFrame()!;
    expect(frame).toContain("itemCount:5");

    // Simulate items changing (new reference, same content — like what happens
    // when parent re-renders and creates new array)
    const rendersBefore = parseInt(frame.match(/renders:(\d+)/)![1]!, 10);

    // Re-render with new items reference
    instance.rerender(React.createElement(DynamicNavTester));

    await new Promise((r) => setTimeout(r, 50));

    frame = instance.lastFrame()!;
    const rendersAfter = parseInt(frame.match(/renders:(\d+)/)![1]!, 10);

    // Should not have exploded in renders
    // Re-render adds maybe 2-3 renders (rerender + dispatch + settle)
    expect(rendersAfter - rendersBefore).toBeLessThan(5);

    instance.unmount();
  });

  it("should handle empty items array without crashing", async () => {
    const items: NavItem[] = [];

    const instance = render(React.createElement(NavHookTester, { items }));

    await new Promise((r) => setTimeout(r, 50));

    const frame = instance.lastFrame()!;
    expect(frame).toContain("selected:none");
    expect(frame).toContain("index:0");

    instance.unmount();
  });

  it("should include subHeader items in visible list when section is expanded", async () => {
    const items: NavItem[] = [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "sub:repo:In Progress", section: "repo", type: "subHeader" },
      { id: "gh:owner/repo:1", section: "repo", type: "item", subSection: "sub:repo:In Progress" },
      { id: "sub:repo:Backlog", section: "repo", type: "subHeader" },
      { id: "gh:owner/repo:2", section: "repo", type: "item", subSection: "sub:repo:Backlog" },
    ];

    const instance = render(React.createElement(NavHookTester, { items }));
    await new Promise((r) => setTimeout(r, 50));

    const frame = instance.lastFrame()!;
    // First header selected by default
    expect(frame).toContain("selected:header:repo");

    instance.unmount();
  });

  it("should fall back to same-section item when selected item disappears", async () => {
    const instance = render(React.createElement(DynamicNavTester));
    await new Promise((r) => setTimeout(r, 50));

    // Select an item in repo section
    const nav = (globalThis as Record<string, unknown>)["__testNav"] as {
      select: (id: string) => void;
    };
    nav.select("gh:owner/repo:1");
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:gh:owner/repo:1");

    // Remove item 1, keep item 2 in same section
    const setItems = (globalThis as Record<string, unknown>)["__testSetItems"] as (
      fn: (prev: NavItem[]) => NavItem[],
    ) => void;
    setItems(() => [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "gh:owner/repo:2", section: "repo", type: "item" },
      { id: "header:ticktick", section: "ticktick", type: "header" },
      { id: "tt:task-1", section: "ticktick", type: "item" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // Should fall back to item 2 (same section), not ticktick header
    expect(instance.lastFrame()!).toContain("selected:gh:owner/repo:2");

    instance.unmount();
  });

  it("should fall back to section header when all section items disappear", async () => {
    const instance = render(React.createElement(DynamicNavTester));
    await new Promise((r) => setTimeout(r, 50));

    // Select an item in repo section
    const nav = (globalThis as Record<string, unknown>)["__testNav"] as {
      select: (id: string) => void;
    };
    nav.select("gh:owner/repo:1");
    await new Promise((r) => setTimeout(r, 50));

    // Remove all items from repo section, keep only header
    const setItems = (globalThis as Record<string, unknown>)["__testSetItems"] as (
      fn: (prev: NavItem[]) => NavItem[],
    ) => void;
    setItems(() => [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "header:ticktick", section: "ticktick", type: "header" },
      { id: "tt:task-1", section: "ticktick", type: "item" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // Should fall back to repo section header
    expect(instance.lastFrame()!).toContain("selected:header:repo");

    instance.unmount();
  });

  it("should fall back to first header when entire section disappears", async () => {
    const instance = render(React.createElement(DynamicNavTester));
    await new Promise((r) => setTimeout(r, 50));

    // Select an item in repo section
    const nav = (globalThis as Record<string, unknown>)["__testNav"] as {
      select: (id: string) => void;
    };
    nav.select("gh:owner/repo:1");
    await new Promise((r) => setTimeout(r, 50));

    // Remove entire repo section
    const setItems = (globalThis as Record<string, unknown>)["__testSetItems"] as (
      fn: (prev: NavItem[]) => NavItem[],
    ) => void;
    setItems(() => [
      { id: "header:ticktick", section: "ticktick", type: "header" },
      { id: "tt:task-1", section: "ticktick", type: "item" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // Should fall back to first available header (ticktick)
    expect(instance.lastFrame()!).toContain("selected:header:ticktick");

    instance.unmount();
  });
});

describe("findFallback", () => {
  it("should prefer item in same section over header", () => {
    const items: NavItem[] = [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "gh:owner/repo:2", section: "repo", type: "item" },
      { id: "header:tt", section: "ticktick", type: "header" },
    ];
    const result = findFallback(items, "repo");
    expect(result?.id).toBe("gh:owner/repo:2");
  });

  it("should fall back to section header when no items remain", () => {
    const items: NavItem[] = [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "header:tt", section: "ticktick", type: "header" },
    ];
    const result = findFallback(items, "repo");
    expect(result?.id).toBe("header:repo");
  });

  it("should fall back to first header when section is gone", () => {
    const items: NavItem[] = [
      { id: "header:tt", section: "ticktick", type: "header" },
      { id: "tt:task-1", section: "ticktick", type: "item" },
    ];
    const result = findFallback(items, "repo");
    expect(result?.id).toBe("header:tt");
  });

  it("should fall back to first item when no headers exist", () => {
    const items: NavItem[] = [{ id: "gh:owner/repo:1", section: "repo", type: "item" }];
    const result = findFallback(items, "other");
    expect(result?.id).toBe("gh:owner/repo:1");
  });

  it("should return undefined for empty items", () => {
    const result = findFallback([], "repo");
    expect(result).toBeUndefined();
  });

  it("should fall back to first header when oldSection is null", () => {
    const items: NavItem[] = [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "gh:owner/repo:1", section: "repo", type: "item" },
    ];
    const result = findFallback(items, null);
    expect(result?.id).toBe("header:repo");
  });
});
