import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React, { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useMultiSelect } from "./use-multi-select.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Simple repo resolver for tests
function getRepo(id: string): string | null {
  if (id.startsWith("gh:owner/repo:")) return "owner/repo";
  if (id.startsWith("gh:other/repo:")) return "other/repo";
  if (id.startsWith("tt:")) return "ticktick";
  if (id.startsWith("header:")) return null;
  return null;
}

function MultiSelectTester() {
  const ms = useMultiSelect(getRepo);
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  // Expose for testing
  (globalThis as Record<string, unknown>)["__ms"] = ms;

  return (
    <Box flexDirection="column">
      <Text>count:{ms.count}</Text>
      <Text>repo:{ms.constrainedRepo ?? "null"}</Text>
      <Text>renders:{renderCountRef.current}</Text>
    </Box>
  );
}

describe("useMultiSelect hook", () => {
  it("should start with empty selection", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("count:0");
    expect(frame).toContain("repo:null");

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    expect(ms.isSelected("gh:owner/repo:42")).toBe(false);

    instance.unmount();
  });

  it("should toggle selection on", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("gh:owner/repo:42");
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("count:1");
    expect(frame).toContain("repo:owner/repo");

    const ms2 = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<
      typeof useMultiSelect
    >;
    expect(ms2.isSelected("gh:owner/repo:42")).toBe(true);

    instance.unmount();
  });

  it("should toggle selection off", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("gh:owner/repo:42");
    await delay(50);
    ms.toggle("gh:owner/repo:42");
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("count:0");

    instance.unmount();
  });

  it("should select multiple items from same repo", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("gh:owner/repo:42");
    await delay(50);
    ms.toggle("gh:owner/repo:43");
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("count:2");
    expect(frame).toContain("repo:owner/repo");

    instance.unmount();
  });

  it("should reset selection when toggling item from different repo", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("gh:owner/repo:42");
    ms.toggle("gh:owner/repo:43");
    await delay(50);
    expect(instance.lastFrame()!).toContain("count:2");

    // Toggle item from different repo — resets to just this item
    ms.toggle("gh:other/repo:1");
    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("count:1");
    expect(frame).toContain("repo:other/repo");

    const ms2 = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<
      typeof useMultiSelect
    >;
    expect(ms2.isSelected("gh:owner/repo:42")).toBe(false);
    expect(ms2.isSelected("gh:other/repo:1")).toBe(true);

    instance.unmount();
  });

  it("should ignore headers and null-repo items", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("header:repo");
    await delay(50);

    expect(instance.lastFrame()!).toContain("count:0");

    instance.unmount();
  });

  it("should clear all selections", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("gh:owner/repo:42");
    ms.toggle("gh:owner/repo:43");
    await delay(50);
    expect(instance.lastFrame()!).toContain("count:2");

    ms.clear();
    await delay(50);
    expect(instance.lastFrame()!).toContain("count:0");
    expect(instance.lastFrame()!).toContain("repo:null");

    instance.unmount();
  });

  it("should not render-loop", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(100);

    const frame = instance.lastFrame()!;
    const count = parseInt(frame.match(/renders:(\d+)/)![1]!, 10);
    expect(count).toBeLessThan(5);

    instance.unmount();
  });

  it("should prune stale IDs after data refresh", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("gh:owner/repo:42");
    ms.toggle("gh:owner/repo:43");
    await delay(50);
    expect(instance.lastFrame()!).toContain("count:2");

    // Prune — only 42 is still valid
    ms.prune(new Set(["gh:owner/repo:42", "gh:owner/repo:99"]));
    await delay(50);

    expect(instance.lastFrame()!).toContain("count:1");
    const ms2 = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<
      typeof useMultiSelect
    >;
    expect(ms2.isSelected("gh:owner/repo:42")).toBe(true);
    expect(ms2.isSelected("gh:owner/repo:43")).toBe(false);

    instance.unmount();
  });

  it("should clear repo constraint when prune removes all items", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("gh:owner/repo:42");
    await delay(50);
    expect(instance.lastFrame()!).toContain("count:1");

    // Prune with no valid IDs
    ms.prune(new Set(["gh:owner/repo:99"]));
    await delay(50);

    expect(instance.lastFrame()!).toContain("count:0");
    expect(instance.lastFrame()!).toContain("repo:null");

    instance.unmount();
  });

  it("should no-op prune when all IDs are still valid", async () => {
    const instance = render(React.createElement(MultiSelectTester));
    await delay(50);

    const ms = (globalThis as Record<string, unknown>)["__ms"] as ReturnType<typeof useMultiSelect>;
    ms.toggle("gh:owner/repo:42");
    ms.toggle("gh:owner/repo:43");
    await delay(50);

    const rendersBefore = parseInt(instance.lastFrame()!.match(/renders:(\d+)/)![1]!, 10);

    // All IDs valid — should be a no-op
    ms.prune(new Set(["gh:owner/repo:42", "gh:owner/repo:43"]));
    await delay(50);

    expect(instance.lastFrame()!).toContain("count:2");
    const rendersAfter = parseInt(instance.lastFrame()!.match(/renders:(\d+)/)![1]!, 10);
    // No-op prune should not cause extra renders (returns same Set reference)
    expect(rendersAfter - rendersBefore).toBeLessThanOrEqual(1);

    instance.unmount();
  });
});
