import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonOut, printSuccess, setFormat, useJson } from "./output.js";

describe("output", () => {
  beforeEach(() => {
    setFormat("json");
  });

  // ── setFormat / useJson ──

  describe("setFormat and useJson", () => {
    afterEach(() => {
      // Reset to json to avoid bleeding into other tests
      setFormat("json");
    });

    it("useJson returns true after setFormat('json')", () => {
      setFormat("json");
      expect(useJson()).toBe(true);
    });

    it("useJson returns false after setFormat('human')", () => {
      setFormat("human");
      expect(useJson()).toBe(false);
    });
  });

  // ── jsonOut ──

  describe("jsonOut", () => {
    it("calls console.log with JSON.stringify of the data", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const data = { key: "value", num: 42 };

      jsonOut(data);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]?.[0]).toBe(JSON.stringify(data));
      spy.mockRestore();
    });

    it("handles arrays", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      jsonOut([1, 2, 3]);

      expect(spy.mock.calls[0]?.[0]).toBe("[1,2,3]");
      spy.mockRestore();
    });

    it("handles null", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      jsonOut(null);

      expect(spy.mock.calls[0]?.[0]).toBe("null");
      spy.mockRestore();
    });

    it("handles primitive string", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      jsonOut("hello");

      expect(spy.mock.calls[0]?.[0]).toBe('"hello"');
      spy.mockRestore();
    });
  });

  // ── printSuccess ──

  describe("printSuccess", () => {
    it("outputs JSON with ok:true and message", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSuccess("Task created", { taskId: "abc" });

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(output).toEqual({ ok: true, message: "Task created", taskId: "abc" });
      spy.mockRestore();
    });

    it("works without extra data", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSuccess("Done");

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(output["ok"]).toBe(true);
      expect(output["message"]).toBe("Done");
      spy.mockRestore();
    });

    it("prints message string in human mode", () => {
      setFormat("human");
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSuccess("Human success");

      expect(spy.mock.calls[0]?.[0]).toBe("Human success");
      spy.mockRestore();
    });
  });
});
