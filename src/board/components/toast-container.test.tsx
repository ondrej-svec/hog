import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { Toast } from "../hooks/use-toast.js";
import { ToastContainer } from "./toast-container.js";

function makeToast(overrides: Partial<Toast> & { type: Toast["type"]; message: string }): Toast {
  return {
    id: "toast-1",
    createdAt: Date.now(),
    ...overrides,
  };
}

function renderToasts(toasts: Toast[]) {
  return render(React.createElement(ToastContainer, { toasts }));
}

describe("ToastContainer", () => {
  it("renders nothing when toasts array is empty", () => {
    const { lastFrame } = renderToasts([]);
    // Component returns null for empty toasts
    expect(lastFrame()).toBe("");
  });

  it("renders the message for a single info toast", () => {
    const toast = makeToast({ type: "info", message: "Issue picked" });
    const { lastFrame } = renderToasts([toast]);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Issue picked");
  });

  it("renders info prefix symbol for info toast", () => {
    const toast = makeToast({ id: "t1", type: "info", message: "Info message" });
    const { lastFrame } = renderToasts([toast]);
    const frame = lastFrame() ?? "";
    // ℹ symbol (U+2139)
    expect(frame).toContain("\u2139");
  });

  it("renders success prefix symbol for success toast", () => {
    const toast = makeToast({ id: "t1", type: "success", message: "Done!" });
    const { lastFrame } = renderToasts([toast]);
    const frame = lastFrame() ?? "";
    // ✓ symbol (U+2713)
    expect(frame).toContain("\u2713");
  });

  it("renders error prefix symbol for error toast (lines 25-28)", () => {
    const toast = makeToast({ id: "t1", type: "error", message: "Failed to assign" });
    const { lastFrame } = renderToasts([toast]);
    const frame = lastFrame() ?? "";
    // ✗ symbol (U+2717)
    expect(frame).toContain("\u2717");
    expect(frame).toContain("Failed to assign");
  });

  it("renders dismiss hint for error toast without retry (line 38)", () => {
    const toast = makeToast({ id: "t1", type: "error", message: "Oops" });
    const { lastFrame } = renderToasts([toast]);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[d]ismiss");
    expect(frame).not.toContain("[r]etry");
  });

  it("renders retry and dismiss hints for error toast with retry (line 38)", () => {
    const retryFn = vi.fn();
    const toast = makeToast({ id: "t1", type: "error", message: "Oops", retry: retryFn });
    const { lastFrame } = renderToasts([toast]);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[r]etry");
    expect(frame).toContain("[d]ismiss");
  });

  it("renders a loading toast with its message (lines 25-28)", () => {
    const toast = makeToast({ id: "t1", type: "loading", message: "Saving..." });
    const { lastFrame } = renderToasts([toast]);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Saving...");
  });

  it("renders multiple toasts — all messages visible", () => {
    const toasts: Toast[] = [
      makeToast({ id: "t1", type: "info", message: "First toast" }),
      makeToast({ id: "t2", type: "success", message: "Second toast" }),
      makeToast({ id: "t3", type: "error", message: "Third toast" }),
    ];
    const { lastFrame } = renderToasts(toasts);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("First toast");
    expect(frame).toContain("Second toast");
    expect(frame).toContain("Third toast");
  });

  it("renders correct prefix symbols for multiple toast types together", () => {
    const toasts: Toast[] = [
      makeToast({ id: "t1", type: "success", message: "Saved" }),
      makeToast({ id: "t2", type: "error", message: "Failed" }),
    ];
    const { lastFrame } = renderToasts(toasts);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("\u2713"); // success
    expect(frame).toContain("\u2717"); // error
  });
});
