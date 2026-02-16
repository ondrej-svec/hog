import { beforeEach, describe, expect, it, vi } from "vitest";
import { printSuccess, printTasks, setFormat } from "./output.js";
import type { Task } from "./types.js";
import { Priority } from "./types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Test task",
    content: "",
    desc: "",
    isAllDay: false,
    startDate: "",
    dueDate: "",
    completedTime: "",
    priority: Priority.None,
    reminders: [],
    repeatFlag: "",
    sortOrder: 0,
    status: 0,
    timeZone: "",
    tags: [],
    items: [],
    ...overrides,
  };
}

describe("output", () => {
  beforeEach(() => {
    setFormat("json");
  });

  describe("printTasks", () => {
    it("outputs JSON array of tasks", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tasks = [makeTask(), makeTask({ id: "task-2", title: "Second" })];

      printTasks(tasks);

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Task[];
      expect(output).toHaveLength(2);
      expect(output[0]?.id).toBe("task-1");
      expect(output[1]?.title).toBe("Second");
      spy.mockRestore();
    });

    it("outputs empty array when no tasks", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTasks([]);

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Task[];
      expect(output).toEqual([]);
      spy.mockRestore();
    });
  });

  describe("printSuccess", () => {
    it("outputs JSON with ok:true and message", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSuccess("Task created", { taskId: "abc" });

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(output).toEqual({ ok: true, message: "Task created", taskId: "abc" });
      spy.mockRestore();
    });
  });
});
