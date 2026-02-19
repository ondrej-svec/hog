import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { CommentInput } from "./comment-input.js";

// Mock the ink-instance module to avoid errors from getInkInstance in the editor flow
vi.mock("../ink-instance.js", () => ({
  getInkInstance: vi.fn(() => null),
  setInkInstance: vi.fn(),
}));

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderCommentInput(
  overrides: {
    issueNumber?: number;
    onSubmit?: (body: string) => void;
    onCancel?: () => void;
    onPauseRefresh?: () => void;
    onResumeRefresh?: () => void;
  } = {},
) {
  const props = {
    issueNumber: 42,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(React.createElement(CommentInput, props)), props };
}

describe("CommentInput", () => {
  it("renders the issue number in the heading", async () => {
    const { lastFrame } = renderCommentInput({ issueNumber: 42 });
    await delay(50);
    expect(lastFrame()).toContain("#42");
  });

  it("renders the comment placeholder text", async () => {
    const { lastFrame } = renderCommentInput();
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("type comment");
  });

  it("calls onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = renderCommentInput({ onCancel });
    await delay(50);

    stdin.write("\x1b");
    await delay(50);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not call onSubmit when Escape is pressed", async () => {
    const onSubmit = vi.fn();
    const { stdin } = renderCommentInput({ onSubmit });
    await delay(50);

    stdin.write("\x1b");
    await delay(50);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with trimmed text when Enter is pressed with non-empty input", async () => {
    const onSubmit = vi.fn();
    const { stdin } = renderCommentInput({ onSubmit });
    await delay(50);

    // Type a comment then submit
    stdin.write("hello world");
    await delay(50);
    stdin.write("\r");
    await delay(50);

    expect(onSubmit).toHaveBeenCalledWith("hello world");
  });

  it("calls onCancel instead of onSubmit when Enter is pressed with empty input", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = renderCommentInput({ onSubmit, onCancel });
    await delay(50);

    // Submit without typing anything
    stdin.write("\r");
    await delay(50);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders different issue numbers correctly", async () => {
    const { lastFrame } = renderCommentInput({ issueNumber: 123 });
    await delay(50);
    expect(lastFrame()).toContain("#123");
  });
});
