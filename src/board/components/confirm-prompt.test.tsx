import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmPrompt } from "./confirm-prompt.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderConfirmPrompt(
  overrides: { message?: string; onConfirm?: () => void; onCancel?: () => void } = {},
) {
  const props = {
    message: "Are you sure?",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(React.createElement(ConfirmPrompt, props)), props };
}

describe("ConfirmPrompt", () => {
  it("renders the message text", async () => {
    const { lastFrame } = renderConfirmPrompt({ message: "Delete this issue?" });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Delete this issue?");
  });

  it("renders the y/n hint", async () => {
    const { lastFrame } = renderConfirmPrompt();
    await delay(50);
    expect(lastFrame()).toContain("(y/n)");
  });

  it("calls onConfirm when 'y' is pressed", async () => {
    const onConfirm = vi.fn();
    const { stdin } = renderConfirmPrompt({ onConfirm });
    await delay(50);

    stdin.write("y");
    await delay(50);

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onConfirm when 'Y' is pressed", async () => {
    const onConfirm = vi.fn();
    const { stdin } = renderConfirmPrompt({ onConfirm });
    await delay(50);

    stdin.write("Y");
    await delay(50);

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when 'n' is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = renderConfirmPrompt({ onCancel });
    await delay(50);

    stdin.write("n");
    await delay(50);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when 'N' is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = renderConfirmPrompt({ onCancel });
    await delay(50);

    stdin.write("N");
    await delay(50);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = renderConfirmPrompt({ onCancel });
    await delay(50);

    stdin.write("\x1b");
    await delay(50);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not call onConfirm when Escape is pressed", async () => {
    const onConfirm = vi.fn();
    const { stdin } = renderConfirmPrompt({ onConfirm });
    await delay(50);

    stdin.write("\x1b");
    await delay(50);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not call onCancel when 'y' is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = renderConfirmPrompt({ onCancel });
    await delay(50);

    stdin.write("y");
    await delay(50);

    expect(onCancel).not.toHaveBeenCalled();
  });
});
