import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LabelOption } from "../../github.js";
import { LabelPicker } from "./label-picker.js";

// Mock fetchRepoLabelsAsync so tests don't make real gh CLI calls
vi.mock("../../github.js", () => ({
  fetchRepoLabelsAsync: vi.fn(),
}));

import { fetchRepoLabelsAsync } from "../../github.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mockLabels: LabelOption[] = [
  { name: "bug", color: "red" },
  { name: "feature", color: "blue" },
  { name: "docs", color: "green" },
];

function renderPicker(
  overrides: {
    repo?: string;
    currentLabels?: string[];
    labelCache?: Record<string, LabelOption[]>;
    onConfirm?: (addLabels: string[], removeLabels: string[]) => void;
    onCancel?: () => void;
    onError?: (msg: string) => void;
  } = {},
) {
  const props = {
    repo: "owner/repo",
    currentLabels: [],
    labelCache: {},
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  return { ...render(React.createElement(LabelPicker, props)), props };
}

describe("LabelPicker", () => {
  beforeEach(() => {
    vi.mocked(fetchRepoLabelsAsync).mockClear();
    vi.mocked(fetchRepoLabelsAsync).mockResolvedValue(mockLabels);
  });

  it("shows loading spinner while fetching labels", () => {
    const { lastFrame } = renderPicker();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Fetching labels");
  });

  it("renders label list after fetch completes", async () => {
    const { lastFrame } = renderPicker();
    await delay(100);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("bug");
    expect(frame).toContain("feature");
    expect(frame).toContain("docs");
  });

  it("renders heading after fetch completes", async () => {
    const { lastFrame } = renderPicker();
    await delay(100);
    expect(lastFrame()).toContain("Labels");
  });

  it("uses cached labels without fetching again", async () => {
    const cache: Record<string, LabelOption[]> = {
      "owner/repo": mockLabels,
    };
    const { lastFrame } = renderPicker({ labelCache: cache });
    // Should render immediately without waiting for fetch
    const frame = lastFrame() ?? "";
    expect(frame).toContain("bug");
    expect(fetchRepoLabelsAsync).not.toHaveBeenCalled();
  });

  it("shows current labels as selected with [x] marker", async () => {
    const { lastFrame } = renderPicker({ currentLabels: ["bug"] });
    await delay(100);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[x] bug");
  });

  it("shows unselected labels with [ ] marker", async () => {
    const { lastFrame } = renderPicker({ currentLabels: ["bug"] });
    await delay(100);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[ ] feature");
  });

  it("highlights first item with '>' cursor by default", async () => {
    const { lastFrame } = renderPicker();
    await delay(100);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("> [ ] bug");
  });

  it("navigates down with 'j' key", async () => {
    const { lastFrame, stdin } = renderPicker();
    await delay(100);

    stdin.write("j");
    await delay(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("> [ ] feature");
  });

  it("navigates up with 'k' key", async () => {
    const { lastFrame, stdin } = renderPicker();
    await delay(100);

    stdin.write("j");
    await delay(50);
    stdin.write("k");
    await delay(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("> [ ] bug");
  });

  it("does not move cursor above index 0 with 'k'", async () => {
    const { lastFrame, stdin } = renderPicker();
    await delay(100);

    stdin.write("k");
    await delay(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("> [ ] bug");
  });

  it("does not move cursor past last item with 'j'", async () => {
    const { lastFrame, stdin } = renderPicker();
    await delay(100);

    // Move past end
    stdin.write("j");
    await delay(50);
    stdin.write("j");
    await delay(50);
    stdin.write("j");
    await delay(50);
    stdin.write("j");
    await delay(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("> [ ] docs");
  });

  it("toggles label selection with Space key", async () => {
    const { lastFrame, stdin } = renderPicker();
    await delay(100);

    stdin.write(" ");
    await delay(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("[x] bug");
  });

  it("untogles a pre-selected label with Space", async () => {
    const { lastFrame, stdin } = renderPicker({ currentLabels: ["bug"] });
    await delay(100);

    stdin.write(" ");
    await delay(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("[ ] bug");
  });

  it("calls onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = renderPicker({ onCancel });
    await delay(100);

    stdin.write("\x1b");
    await delay(50);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with added labels when Enter is pressed", async () => {
    const onConfirm = vi.fn();
    const { stdin } = renderPicker({ onConfirm });
    await delay(100);

    // Select the first label (bug) then confirm
    stdin.write(" ");
    await delay(50);
    stdin.write("\r");
    await delay(50);

    expect(onConfirm).toHaveBeenCalledWith(["bug"], []);
  });

  it("calls onConfirm with removed labels when a current label is deselected", async () => {
    const onConfirm = vi.fn();
    const { stdin } = renderPicker({ currentLabels: ["bug"], onConfirm });
    await delay(100);

    // Cursor on 'bug' which is currently selected; deselect then confirm
    stdin.write(" ");
    await delay(50);
    stdin.write("\r");
    await delay(50);

    expect(onConfirm).toHaveBeenCalledWith([], ["bug"]);
  });

  it("calls onConfirm with empty arrays when no changes are made", async () => {
    const onConfirm = vi.fn();
    const { stdin } = renderPicker({ onConfirm });
    await delay(100);

    stdin.write("\r");
    await delay(50);

    expect(onConfirm).toHaveBeenCalledWith([], []);
  });

  it("shows 'No labels in this repo' message when label list is empty", async () => {
    vi.mocked(fetchRepoLabelsAsync).mockResolvedValue([]);
    const { lastFrame } = renderPicker();
    await delay(100);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No labels in this repo");
  });

  it("calls onError when fetch fails", async () => {
    vi.mocked(fetchRepoLabelsAsync).mockRejectedValue(new Error("network error"));
    const onError = vi.fn();
    renderPicker({ onError });
    await delay(100);
    expect(onError).toHaveBeenCalledWith("Could not fetch labels for owner/repo");
  });
});
