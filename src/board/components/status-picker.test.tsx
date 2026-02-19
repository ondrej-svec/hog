import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { StatusOption } from "../../github.js";
import { StatusPicker } from "./status-picker.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OPTIONS: StatusOption[] = [
  { id: "opt-1", name: "Backlog" },
  { id: "opt-2", name: "In Progress" },
  { id: "opt-3", name: "Done" },
];

function renderPicker(
  overrides: Partial<{
    options: StatusOption[];
    currentStatus: string | undefined;
    onSelect: (id: string) => void;
    onCancel: () => void;
    showTerminalStatuses: boolean;
  }> = {},
) {
  const props = {
    options: OPTIONS,
    currentStatus: undefined,
    onSelect: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return render(React.createElement(StatusPicker, props));
}

describe("StatusPicker", () => {
  it("renders the 'Move to status:' heading", async () => {
    const { lastFrame } = renderPicker();
    await delay(50);
    expect(lastFrame()).toContain("Move to status:");
  });

  it("renders all status option names", async () => {
    const { lastFrame } = renderPicker();
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Backlog");
    expect(frame).toContain("In Progress");
    expect(frame).toContain("Done");
  });

  it("shows (current) suffix for the current status", async () => {
    const { lastFrame } = renderPicker({ currentStatus: "In Progress" });
    await delay(50);
    expect(lastFrame()).toContain("In Progress (current)");
  });

  it("shows (Done) suffix for terminal statuses when showTerminalStatuses=true", async () => {
    const { lastFrame } = renderPicker({ showTerminalStatuses: true });
    await delay(50);
    // "Done" matches the TERMINAL_STATUS_RE pattern
    expect(lastFrame()).toContain("Done (Done)");
  });

  it("does not show (Done) suffix when showTerminalStatuses=false", async () => {
    const { lastFrame } = renderPicker({ showTerminalStatuses: false });
    await delay(50);
    expect(lastFrame()).not.toContain("(Done)");
  });

  it("highlights the first option by default with '> ' prefix", async () => {
    const { lastFrame } = renderPicker();
    await delay(50);
    expect(lastFrame()).toContain("> Backlog");
  });

  it("starts cursor on current status option when currentStatus is set", async () => {
    const { lastFrame } = renderPicker({ currentStatus: "In Progress" });
    await delay(50);
    expect(lastFrame()).toContain("> In Progress");
  });

  it("shows navigation hints", async () => {
    const { lastFrame } = renderPicker();
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("j/k:navigate");
    expect(frame).toContain("Enter:select");
    expect(frame).toContain("Esc:cancel");
  });

  it("calls onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = renderPicker({ onCancel });
    await delay(50);

    stdin.write("\x1b");
    await delay(50);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onSelect with option id when Enter is pressed on non-terminal option", async () => {
    const onSelect = vi.fn();
    const { stdin } = renderPicker({ onSelect });
    await delay(50);

    // Cursor starts on first item: "Backlog" (non-terminal)
    stdin.write("\r");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith("opt-1");
  });

  it("navigates down with 'j' key", async () => {
    const onSelect = vi.fn();
    const { stdin } = renderPicker({ onSelect });
    await delay(50);

    stdin.write("j");
    await delay(50);
    stdin.write("\r");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith("opt-2");
  });

  it("navigates up with 'k' key", async () => {
    const onSelect = vi.fn();
    const { stdin } = renderPicker({ onSelect, currentStatus: "Done" });
    await delay(50);

    // Cursor starts on "Done" (index 2); move up once to "In Progress"
    stdin.write("k");
    await delay(50);
    stdin.write("\r");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith("opt-2");
  });

  it("does not move cursor above index 0 with 'k'", async () => {
    const onSelect = vi.fn();
    const { stdin } = renderPicker({ onSelect });
    await delay(50);

    // Already at index 0; pressing k should keep cursor at 0
    stdin.write("k");
    await delay(50);
    stdin.write("\r");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith("opt-1");
  });

  it("does not move cursor past last item with 'j'", async () => {
    const onSelect = vi.fn();
    const { stdin } = renderPicker({ onSelect, currentStatus: "Done" });
    await delay(50);

    // Cursor starts at "Done" (index 2, last); pressing j should keep it there.
    // Pressing Enter on "Done" triggers the terminal confirmation prompt rather
    // than immediately calling onSelect — confirming the cursor stayed at "Done".
    stdin.write("j");
    await delay(50);
    stdin.write("\r");
    await delay(50);

    // Terminal confirmation is shown instead of calling onSelect directly
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows terminal confirmation prompt when Enter is pressed on a Done-type option", async () => {
    const { stdin, lastFrame } = renderPicker({
      currentStatus: "Done",
      showTerminalStatuses: true,
    });
    await delay(50);

    stdin.write("\r");
    await delay(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Mark as Done?");
    expect(frame).toContain("Continue? [y/n]");
  });

  it("calls onSelect after confirming terminal status with 'y'", async () => {
    const onSelect = vi.fn();
    const { stdin } = renderPicker({ onSelect, currentStatus: "Done", showTerminalStatuses: true });
    await delay(50);

    stdin.write("\r");
    await delay(50);
    stdin.write("y");
    await delay(50);

    expect(onSelect).toHaveBeenCalledWith("opt-3");
  });

  it("returns to picker when terminal confirmation is cancelled with 'n'", async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame } = renderPicker({
      onSelect,
      currentStatus: "Done",
      showTerminalStatuses: true,
    });
    await delay(50);

    stdin.write("\r");
    await delay(50);
    stdin.write("n");
    await delay(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Move to status:");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
