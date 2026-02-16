import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { FocusMode, formatTime } from "./focus-mode.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("formatTime", () => {
  it("should format 0 seconds", () => {
    expect(formatTime(0)).toBe("00:00");
  });

  it("should format 90 seconds", () => {
    expect(formatTime(90)).toBe("01:30");
  });

  it("should format 1500 seconds (25 min)", () => {
    expect(formatTime(1500)).toBe("25:00");
  });
});

describe("FocusMode component", () => {
  it("should show label and timer in focus state", async () => {
    const instance = render(
      React.createElement(FocusMode, {
        label: "aibility#42 — Fix login",
        durationSec: 120,
        onExit: vi.fn(),
        onEndAction: vi.fn(),
      }),
    );

    await delay(50);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("Focus:");
    expect(frame).toContain("aibility#42");
    expect(frame).toContain("remaining");

    instance.unmount();
  });

  it("should count down the timer", async () => {
    const instance = render(
      React.createElement(FocusMode, {
        label: "Test task",
        durationSec: 3,
        onExit: vi.fn(),
        onEndAction: vi.fn(),
      }),
    );

    // Wait for 2 seconds of countdown
    await delay(2200);

    const frame = instance.lastFrame()!;
    // Should show 1 second remaining (or 0 if timer completed)
    expect(frame).toMatch(/00:0[01]/);

    instance.unmount();
  });

  it("should show completion prompt when timer ends", async () => {
    const onEndAction = vi.fn();

    const instance = render(
      React.createElement(FocusMode, {
        label: "Test task",
        durationSec: 1,
        onExit: vi.fn(),
        onEndAction,
      }),
    );

    // Wait for timer to complete
    await delay(1500);

    const frame = instance.lastFrame()!;
    expect(frame).toContain("Focus complete!");
    expect(frame).toContain("Continue");
    expect(frame).toContain("Break");
    expect(frame).toContain("Done");
    expect(frame).toContain("Exit");

    instance.unmount();
  });

  it("should call onExit when Escape pressed during timer", async () => {
    const onExit = vi.fn();

    const instance = render(
      React.createElement(FocusMode, {
        label: "Test task",
        durationSec: 60,
        onExit,
        onEndAction: vi.fn(),
      }),
    );

    await delay(100);
    instance.stdin.write("\x1B"); // Escape
    await delay(50);

    expect(onExit).toHaveBeenCalledTimes(1);

    instance.unmount();
  });

  it("should call onEndAction('restart') when 'c' pressed after timer", async () => {
    const onEndAction = vi.fn();

    const instance = render(
      React.createElement(FocusMode, {
        label: "Test task",
        durationSec: 1,
        onExit: vi.fn(),
        onEndAction,
      }),
    );

    await delay(1500);
    instance.stdin.write("c");
    await delay(50);

    expect(onEndAction).toHaveBeenCalledWith("restart");

    instance.unmount();
  });

  it("should call onEndAction('break') when 'b' pressed after timer", async () => {
    const onEndAction = vi.fn();

    const instance = render(
      React.createElement(FocusMode, {
        label: "Test task",
        durationSec: 1,
        onExit: vi.fn(),
        onEndAction,
      }),
    );

    await delay(1500);
    instance.stdin.write("b");
    await delay(50);

    expect(onEndAction).toHaveBeenCalledWith("break");

    instance.unmount();
  });

  it("should call onEndAction('done') when 'd' pressed after timer", async () => {
    const onEndAction = vi.fn();

    const instance = render(
      React.createElement(FocusMode, {
        label: "Test task",
        durationSec: 1,
        onExit: vi.fn(),
        onEndAction,
      }),
    );

    await delay(1500);
    instance.stdin.write("d");
    await delay(50);

    expect(onEndAction).toHaveBeenCalledWith("done");

    instance.unmount();
  });

  it("should call onEndAction('exit') when Escape pressed after timer", async () => {
    const onEndAction = vi.fn();

    const instance = render(
      React.createElement(FocusMode, {
        label: "Test task",
        durationSec: 1,
        onExit: vi.fn(),
        onEndAction,
      }),
    );

    await delay(1500);
    instance.stdin.write("\x1B"); // Escape
    await delay(50);

    expect(onEndAction).toHaveBeenCalledWith("exit");

    instance.unmount();
  });
});
