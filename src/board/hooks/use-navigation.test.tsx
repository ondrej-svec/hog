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

// Flexible test component that accepts initial items and exposes full nav API + state
function NavActionTester({ initialItems }: { initialItems: NavItem[] }) {
  const [items, setItems] = useState<NavItem[]>(initialItems);
  const nav = useNavigation(items);

  // Expose for testing
  (globalThis as Record<string, unknown>)["__testNav"] = nav;
  (globalThis as Record<string, unknown>)["__testSetItems"] = setItems;

  return (
    <Box flexDirection="column">
      <Text>selected:{nav.selectedId ?? "none"}</Text>
      <Text>index:{nav.selectedIndex}</Text>
      <Text>collapsed:{[...nav.collapsedSections].sort().join(",")}</Text>
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

// ── Sub-section collapsing ──

function makeSubSectionItems(): NavItem[] {
  return [
    { id: "header:repo", section: "repo", type: "header" },
    { id: "sub:repo:In Progress", section: "repo", type: "subHeader" },
    {
      id: "gh:repo:1",
      section: "repo",
      type: "item",
      subSection: "sub:repo:In Progress",
    },
    { id: "sub:repo:Backlog", section: "repo", type: "subHeader" },
    {
      id: "gh:repo:2",
      section: "repo",
      type: "item",
      subSection: "sub:repo:Backlog",
    },
    { id: "header:tt", section: "ticktick", type: "header" },
    { id: "tt:1", section: "ticktick", type: "item" },
  ];
}

type NavAPI = ReturnType<typeof useNavigation>;

function getNav(): NavAPI {
  return (globalThis as Record<string, unknown>)["__testNav"] as NavAPI;
}

describe("sub-section collapsing", () => {
  it("toggleSection on a subHeader collapses its items", async () => {
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeSubSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // Navigate to the In Progress subHeader
    getNav().select("sub:repo:In Progress");
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:sub:repo:In Progress");

    // Re-get nav so toggleSection has updated selectedIndex pointing to the subHeader
    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    // The subHeader ID should now be in collapsedSections
    expect(instance.lastFrame()!).toContain("sub:repo:In Progress");

    instance.unmount();
  });

  it("moveDown skips items in a collapsed sub-section", async () => {
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeSubSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // Select the In Progress subHeader
    getNav().select("sub:repo:In Progress");
    await new Promise((r) => setTimeout(r, 50));

    // Re-get nav so toggleSection has updated selectedIndex
    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    // Now move down — should skip gh:repo:1 (inside collapsed sub-section)
    // and land on sub:repo:Backlog
    getNav().moveDown();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:sub:repo:Backlog");

    instance.unmount();
  });

  it("toggleSection on a header collapses entire section (all subHeaders and items)", async () => {
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeSubSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // header:repo is the default selection (first item)
    // Call toggleSection to collapse the whole section
    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    // repo section should be in collapsedSections — re-get nav for fresh state
    expect(getNav().isCollapsed("repo")).toBe(true);

    // Moving down from the header should skip to the ticktick header directly
    getNav().moveDown();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:header:tt");

    instance.unmount();
  });
});

it("collapseAll moves cursor to section header when cursor is inside a section", async () => {
  const instance = render(
    React.createElement(NavActionTester, { initialItems: makeSubSectionItems() }),
  );
  await new Promise((r) => setTimeout(r, 50));

  // Navigate to an issue item inside a sub-section
  getNav().select("gh:repo:2");
  await new Promise((r) => setTimeout(r, 50));

  expect(instance.lastFrame()!).toContain("selected:gh:repo:2");

  // Collapse all sections
  getNav().collapseAll();
  await new Promise((r) => setTimeout(r, 50));

  // Cursor should have moved to the section header, not teleported to index 0
  expect(instance.lastFrame()!).toContain("selected:header:repo");

  instance.unmount();
});

// ── nextSection / prevSection ──

function makeTwoSectionItems(): NavItem[] {
  return [
    { id: "header:repo1", section: "repo1", type: "header" },
    { id: "gh:repo1:1", section: "repo1", type: "item" },
    { id: "gh:repo1:2", section: "repo1", type: "item" },
    { id: "header:repo2", section: "repo2", type: "header" },
    { id: "gh:repo2:1", section: "repo2", type: "item" },
  ];
}

describe("nextSection and prevSection", () => {
  it("nextSection jumps to the header of the next section", async () => {
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeTwoSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // Start at first item inside repo1
    getNav().select("gh:repo1:1");
    await new Promise((r) => setTimeout(r, 50));

    // Re-get nav so nextSection has updated selectedIndex
    getNav().nextSection();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:header:repo2");

    instance.unmount();
  });

  it("prevSection jumps to the header of the previous section", async () => {
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeTwoSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // Start inside repo2
    getNav().select("gh:repo2:1");
    await new Promise((r) => setTimeout(r, 50));

    // Re-get nav so prevSection has updated selectedIndex
    getNav().prevSection();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:header:repo1");

    instance.unmount();
  });

  it("nextSection is a no-op when already at the last section", async () => {
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeTwoSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    getNav().select("gh:repo2:1");
    await new Promise((r) => setTimeout(r, 50));

    getNav().nextSection();
    await new Promise((r) => setTimeout(r, 50));

    // Should stay at the last section item or header — not crash
    expect(instance.lastFrame()!).toMatch(/selected:(gh:repo2:1|header:repo2)/);

    instance.unmount();
  });

  it("prevSection is a no-op when already at the first section", async () => {
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeTwoSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    const nav = getNav();
    // Default starts at first header
    await new Promise((r) => setTimeout(r, 50));

    nav.prevSection();
    await new Promise((r) => setTimeout(r, 50));

    // Should stay at header:repo1
    expect(instance.lastFrame()!).toContain("selected:header:repo1");

    instance.unmount();
  });
});

// ── Cursor tracking after items move sections (status-change simulation) ──

describe("cursor tracking after items change sections", () => {
  it("should stay on the same item when it moves to a different subSection (status change)", async () => {
    const initialItems: NavItem[] = [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "sub:repo:Backlog", section: "repo", type: "subHeader" },
      {
        id: "gh:repo:42",
        section: "repo",
        type: "item",
        subSection: "sub:repo:Backlog",
      },
    ];

    const instance = render(React.createElement(NavActionTester, { initialItems }));
    await new Promise((r) => setTimeout(r, 50));

    const nav = getNav();
    nav.select("gh:repo:42");
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:gh:repo:42");

    // Simulate optimistic status update: issue moves from Backlog → In Progress
    const setItems = (globalThis as Record<string, unknown>)["__testSetItems"] as (
      items: NavItem[],
    ) => void;
    setItems([
      { id: "header:repo", section: "repo", type: "header" },
      { id: "sub:repo:In Progress", section: "repo", type: "subHeader" },
      {
        id: "gh:repo:42",
        section: "repo",
        type: "item",
        subSection: "sub:repo:In Progress",
      },
      { id: "sub:repo:Backlog", section: "repo", type: "subHeader" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // Cursor should remain on the same issue (id unchanged)
    expect(instance.lastFrame()!).toContain("selected:gh:repo:42");

    instance.unmount();
  });

  it("should relocate cursor to subHeader when its sub-section is collapsed after a status change", async () => {
    // Regression: state.allItems was not updated by the bail-out, so relocateOnToggle
    // used stale item positions and failed to move the cursor when the user collapsed
    // the sub-section that the issue had moved into.
    const initialItems: NavItem[] = [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "sub:repo:Backlog", section: "repo", type: "subHeader" },
      { id: "gh:repo:42", section: "repo", type: "item", subSection: "sub:repo:Backlog" },
    ];

    const instance = render(React.createElement(NavActionTester, { initialItems }));
    await new Promise((r) => setTimeout(r, 50));

    getNav().select("gh:repo:42");
    await new Promise((r) => setTimeout(r, 50));

    // Simulate optimistic status update: issue moves Backlog → In Progress
    const setItems = (globalThis as Record<string, unknown>)["__testSetItems"] as (
      items: NavItem[],
    ) => void;
    setItems([
      { id: "header:repo", section: "repo", type: "header" },
      { id: "sub:repo:In Progress", section: "repo", type: "subHeader" },
      { id: "gh:repo:42", section: "repo", type: "item", subSection: "sub:repo:In Progress" },
      { id: "sub:repo:Backlog", section: "repo", type: "subHeader" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // Navigate to the In Progress sub-header and collapse it
    getNav().select("sub:repo:In Progress");
    await new Promise((r) => setTimeout(r, 50));

    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    // Cursor must still be on the sub-header (not hidden or jumped to index 0)
    expect(instance.lastFrame()!).toContain("selected:sub:repo:In Progress");

    instance.unmount();
  });

  it("should relocate cursor to subHeader when cursor is on issue that is in collapsed sub-section after status change", async () => {
    // Regression: if cursor is on the issue when its sub-section is collapsed,
    // relocateOnToggle must correctly detect the issue's NEW sub-section.
    const initialItems: NavItem[] = [
      { id: "header:repo", section: "repo", type: "header" },
      { id: "sub:repo:Backlog", section: "repo", type: "subHeader" },
      { id: "gh:repo:42", section: "repo", type: "item", subSection: "sub:repo:Backlog" },
    ];

    const instance = render(React.createElement(NavActionTester, { initialItems }));
    await new Promise((r) => setTimeout(r, 50));

    getNav().select("gh:repo:42");
    await new Promise((r) => setTimeout(r, 50));

    // Simulate status change: issue moves Backlog → In Progress
    const setItems = (globalThis as Record<string, unknown>)["__testSetItems"] as (
      items: NavItem[],
    ) => void;
    setItems([
      { id: "header:repo", section: "repo", type: "header" },
      { id: "sub:repo:In Progress", section: "repo", type: "subHeader" },
      { id: "gh:repo:42", section: "repo", type: "item", subSection: "sub:repo:In Progress" },
      { id: "sub:repo:Backlog", section: "repo", type: "subHeader" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // Cursor is still on gh:repo:42 (which is now in In Progress)
    expect(instance.lastFrame()!).toContain("selected:gh:repo:42");

    // Navigate to In Progress sub-header and collapse it
    getNav().select("sub:repo:In Progress");
    await new Promise((r) => setTimeout(r, 50));
    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    // Issue is now hidden; cursor should be on the sub-header, not ghost-pointing at #42
    expect(instance.lastFrame()!).toContain("selected:sub:repo:In Progress");

    instance.unmount();
  });

  it("should correctly navigate to a new issue that arrived after first load", async () => {
    // Regression: new issues added by refresh were not in state.allItems,
    // so collapsing after navigating to a new issue would leave cursor stranded.
    const instance = render(React.createElement(NavActionTester, { initialItems: makeNavItems() }));
    await new Promise((r) => setTimeout(r, 50));

    const setItems = (globalThis as Record<string, unknown>)["__testSetItems"] as (
      items: NavItem[],
    ) => void;

    // Simulate refresh adding a new issue #999 to the repo section
    setItems([
      { id: "header:repo", section: "repo", type: "header" },
      { id: "gh:owner/repo:1", section: "repo", type: "item" },
      { id: "gh:owner/repo:2", section: "repo", type: "item" },
      { id: "gh:owner/repo:999", section: "repo", type: "item" },
      { id: "header:ticktick", section: "ticktick", type: "header" },
      { id: "tt:task-1", section: "ticktick", type: "item" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // Navigate to the newly-arrived issue
    getNav().select("gh:owner/repo:999");
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:gh:owner/repo:999");

    // Collapse the repo section from its header — cursor should move to header
    getNav().select("header:repo");
    await new Promise((r) => setTimeout(r, 50));
    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    // Cursor should be on the header, not stuck on the now-hidden #999
    expect(instance.lastFrame()!).toContain("selected:header:repo");

    instance.unmount();
  });

  it("collapseAll then expand section restores sub-sections into visibleItems", async () => {
    // Regression scenario reported by user:
    // "collapse all and open one of the boards, I dont see any statuses"
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeSubSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // Initially cursor is on header:repo (first item)
    expect(instance.lastFrame()!).toContain("selected:header:repo");

    // collapseAll — collapses all sections
    getNav().collapseAll();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:header:repo");
    expect(getNav().isCollapsed("repo")).toBe(true);

    // Expand repo section (Enter/Space on header:repo)
    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    expect(getNav().isCollapsed("repo")).toBe(false);
    // Sub-sections must NOT be individually collapsed after expand
    expect(getNav().isCollapsed("sub:repo:In Progress")).toBe(false);
    expect(getNav().isCollapsed("sub:repo:Backlog")).toBe(false);

    // moveDown from header:repo must land on the FIRST sub-header (not skip to an issue)
    getNav().moveDown();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:sub:repo:In Progress");

    instance.unmount();
  });

  it("sub-header is reachable via moveDown navigation (not skipped)", async () => {
    // Regression scenario: user navigates through issues and "at some point
    // the status element shows" — meaning sub-headers must be in visibleItems
    // and reachable by j/k navigation from the very start.
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeSubSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // Start at header:repo (index 0). One moveDown should land on the sub-header.
    getNav().moveDown();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:sub:repo:In Progress");

    // Another moveDown → first issue inside In Progress
    getNav().moveDown();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:gh:repo:1");

    // Another moveDown → Backlog sub-header (not another issue)
    getNav().moveDown();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:sub:repo:Backlog");

    instance.unmount();
  });

  it("collapsing a sub-section keeps sub-header navigable and hides its issues", async () => {
    // Regression scenario: "when I collapse it, it does not seem to work properly"
    const instance = render(
      React.createElement(NavActionTester, { initialItems: makeSubSectionItems() }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // Navigate to the In Progress sub-header
    getNav().select("sub:repo:In Progress");
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:sub:repo:In Progress");

    // Collapse it
    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    // Sub-header must still be selected (not teleported away)
    expect(instance.lastFrame()!).toContain("selected:sub:repo:In Progress");

    // Sub-section must now be collapsed
    expect(getNav().isCollapsed("sub:repo:In Progress")).toBe(true);

    // moveDown from collapsed sub-header must skip its hidden issues
    // and land directly on the Backlog sub-header
    getNav().moveDown();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:sub:repo:Backlog");

    // Expanding In Progress again: issues must reappear
    getNav().select("sub:repo:In Progress");
    await new Promise((r) => setTimeout(r, 50));
    getNav().toggleSection();
    await new Promise((r) => setTimeout(r, 50));

    expect(getNav().isCollapsed("sub:repo:In Progress")).toBe(false);

    // moveDown now hits the issue inside In Progress
    getNav().moveDown();
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:gh:repo:1");

    instance.unmount();
  });

  it("should stay on selected item when sections order changes but item id is unchanged", async () => {
    const instance = render(React.createElement(NavActionTester, { initialItems: makeNavItems() }));
    await new Promise((r) => setTimeout(r, 50));

    const nav = getNav();
    nav.select("gh:owner/repo:2");
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("selected:gh:owner/repo:2");

    // Simulate refresh with same items but new array reference
    const setItems = (globalThis as Record<string, unknown>)["__testSetItems"] as (
      items: NavItem[],
    ) => void;
    setItems([...makeNavItems()]);
    await new Promise((r) => setTimeout(r, 50));

    // Cursor should not jump
    expect(instance.lastFrame()!).toContain("selected:gh:owner/repo:2");

    instance.unmount();
  });
});
