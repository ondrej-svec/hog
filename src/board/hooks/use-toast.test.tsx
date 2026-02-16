import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { UseToastResult } from "./use-toast.js";
import { useToast } from "./use-toast.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ToastTester() {
  const result = useToast();
  (globalThis as Record<string, unknown>)["__toast"] = result;

  return (
    <Box>
      <Text>toasts: {result.toasts.length}</Text>
    </Box>
  );
}

function getToast(): UseToastResult {
  return (globalThis as Record<string, unknown>)["__toast"] as UseToastResult;
}

describe("useToast hook", () => {
  it("should start with no toasts", () => {
    const instance = render(React.createElement(ToastTester));
    expect(getToast().toasts).toHaveLength(0);
    instance.unmount();
  });

  it("should add info toast", async () => {
    const instance = render(React.createElement(ToastTester));

    getToast().toast.info("Hello");
    await delay(10);

    expect(getToast().toasts).toHaveLength(1);
    expect(getToast().toasts[0]!.type).toBe("info");
    expect(getToast().toasts[0]!.message).toBe("Hello");

    instance.unmount();
  });

  it("should add success toast", async () => {
    const instance = render(React.createElement(ToastTester));

    getToast().toast.success("Done!");
    await delay(10);

    expect(getToast().toasts).toHaveLength(1);
    expect(getToast().toasts[0]!.type).toBe("success");

    instance.unmount();
  });

  it("should add error toast with retry callback", async () => {
    const instance = render(React.createElement(ToastTester));
    const retry = vi.fn();

    getToast().toast.error("Failed", retry);
    await delay(10);

    expect(getToast().toasts).toHaveLength(1);
    expect(getToast().toasts[0]!.type).toBe("error");
    expect(getToast().toasts[0]!.retry).toBe(retry);

    instance.unmount();
  });

  it("should add loading toast", async () => {
    const instance = render(React.createElement(ToastTester));

    getToast().toast.loading("Working...");
    await delay(10);

    expect(getToast().toasts).toHaveLength(1);
    expect(getToast().toasts[0]!.type).toBe("loading");
    expect(getToast().toasts[0]!.message).toBe("Working...");

    instance.unmount();
  });

  it("should auto-dismiss info toast after ~3s", async () => {
    const instance = render(React.createElement(ToastTester));

    getToast().toast.info("Temporary");
    await delay(10);
    expect(getToast().toasts).toHaveLength(1);

    // Wait for auto-dismiss (3000ms + buffer)
    await delay(3200);
    expect(getToast().toasts).toHaveLength(0);

    instance.unmount();
  }, 10_000);

  it("should NOT auto-dismiss error toasts after 3s", async () => {
    const instance = render(React.createElement(ToastTester));

    getToast().toast.error("Bad");
    await delay(10);

    // Wait longer than auto-dismiss threshold
    await delay(3500);
    expect(getToast().toasts).toHaveLength(1);
    expect(getToast().toasts[0]!.type).toBe("error");

    instance.unmount();
  }, 10_000);

  it("should NOT auto-dismiss loading toasts after 3s", async () => {
    const instance = render(React.createElement(ToastTester));

    getToast().toast.loading("Working...");
    await delay(10);

    await delay(3500);
    expect(getToast().toasts).toHaveLength(1);
    expect(getToast().toasts[0]!.type).toBe("loading");

    instance.unmount();
  }, 10_000);

  it("should enforce max 3 visible toasts, evicting oldest dismissable", async () => {
    const instance = render(React.createElement(ToastTester));

    getToast().toast.error("First"); // persistent — won't be evicted first
    await delay(10);
    getToast().toast.info("Second"); // dismissable — evicted first
    await delay(10);
    getToast().toast.error("Third"); // persistent
    await delay(10);
    expect(getToast().toasts).toHaveLength(3);

    // Adding a 4th should evict "Second" (the only dismissable one)
    getToast().toast.error("Fourth");
    await delay(10);
    expect(getToast().toasts).toHaveLength(3);
    expect(getToast().toasts.map((t) => t.message)).toEqual(["First", "Third", "Fourth"]);

    instance.unmount();
  });

  it("should evict oldest persistent toast when all are persistent", async () => {
    const instance = render(React.createElement(ToastTester));

    getToast().toast.error("E1");
    await delay(10);
    getToast().toast.error("E2");
    await delay(10);
    getToast().toast.error("E3");
    await delay(10);

    // All 3 are error (persistent). Adding 4th evicts oldest.
    getToast().toast.error("E4");
    await delay(10);
    expect(getToast().toasts).toHaveLength(3);
    expect(getToast().toasts.map((t) => t.message)).toEqual(["E2", "E3", "E4"]);

    instance.unmount();
  });

  describe("loading toast resolve/reject", () => {
    it("should replace loading toast with success on resolve", async () => {
      const instance = render(React.createElement(ToastTester));

      const handle = getToast().toast.loading("Loading...");
      await delay(10);
      expect(getToast().toasts).toHaveLength(1);
      expect(getToast().toasts[0]!.type).toBe("loading");

      handle.resolve("Done!");
      await delay(10);
      // Loading removed, success added
      expect(getToast().toasts).toHaveLength(1);
      expect(getToast().toasts[0]!.type).toBe("success");
      expect(getToast().toasts[0]!.message).toBe("Done!");

      instance.unmount();
    });

    it("should replace loading toast with error on reject", async () => {
      const instance = render(React.createElement(ToastTester));

      const handle = getToast().toast.loading("Loading...");
      await delay(10);

      handle.reject("Failed!");
      await delay(10);
      expect(getToast().toasts).toHaveLength(1);
      expect(getToast().toasts[0]!.type).toBe("error");
      expect(getToast().toasts[0]!.message).toBe("Failed!");

      instance.unmount();
    });
  });

  describe("dismiss", () => {
    it("should dismiss a specific toast by id", async () => {
      const instance = render(React.createElement(ToastTester));

      getToast().toast.error("Error 1");
      await delay(10);
      getToast().toast.error("Error 2");
      await delay(10);

      const id = getToast().toasts[0]!.id;
      getToast().dismiss(id);
      await delay(10);

      expect(getToast().toasts).toHaveLength(1);
      expect(getToast().toasts[0]!.message).toBe("Error 2");

      instance.unmount();
    });

    it("should dismiss all toasts", async () => {
      const instance = render(React.createElement(ToastTester));

      getToast().toast.info("One");
      await delay(10);
      getToast().toast.error("Two");
      await delay(10);
      getToast().toast.loading("Three");
      await delay(10);

      getToast().dismissAll();
      await delay(10);
      expect(getToast().toasts).toHaveLength(0);

      instance.unmount();
    });
  });

  describe("handleErrorAction", () => {
    it("should dismiss oldest error toast on 'dismiss' action", async () => {
      const instance = render(React.createElement(ToastTester));

      getToast().toast.error("Error");
      await delay(10);

      const handled = getToast().handleErrorAction("dismiss");
      expect(handled).toBe(true);
      await delay(10);
      expect(getToast().toasts).toHaveLength(0);

      instance.unmount();
    });

    it("should call retry and remove error toast on 'retry' action", async () => {
      const instance = render(React.createElement(ToastTester));
      const retry = vi.fn();

      getToast().toast.error("Error", retry);
      await delay(10);

      const handled = getToast().handleErrorAction("retry");
      expect(handled).toBe(true);
      expect(retry).toHaveBeenCalledOnce();
      await delay(10);
      expect(getToast().toasts).toHaveLength(0);

      instance.unmount();
    });

    it("should return false when no error toasts exist", async () => {
      const instance = render(React.createElement(ToastTester));

      getToast().toast.info("Not an error");
      await delay(10);

      const handled = getToast().handleErrorAction("dismiss");
      expect(handled).toBe(false);

      instance.unmount();
    });

    it("should return false for retry when error has no retry function", async () => {
      const instance = render(React.createElement(ToastTester));

      getToast().toast.error("Error without retry");
      await delay(10);

      const handled = getToast().handleErrorAction("retry");
      expect(handled).toBe(false);

      instance.unmount();
    });
  });
});
