import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  jsonOut,
  printProjects,
  printSuccess,
  printSyncResult,
  printSyncStatus,
  printTask,
  printTasks,
  setFormat,
  useJson,
} from "./output.js";
import type { SyncResult } from "./sync.js";
import type { SyncMapping, SyncState } from "./sync-state.js";
import type { Project, Task } from "./types.js";
import { Priority, TaskStatus } from "./types.js";

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
    status: TaskStatus.Active,
    timeZone: "",
    tags: [],
    items: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "My Project",
    color: "#000",
    sortOrder: 0,
    closed: false,
    groupId: "",
    viewMode: "list",
    kind: "TASK",
    ...overrides,
  };
}

function makeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    created: [],
    updated: [],
    completed: [],
    ghUpdated: [],
    errors: [],
    ...overrides,
  };
}

function makeSyncMapping(overrides: Partial<SyncMapping> = {}): SyncMapping {
  return {
    githubRepo: "owner/repo",
    githubIssueNumber: 1,
    githubUrl: "https://github.com/owner/repo/issues/1",
    ticktickTaskId: "tt-1",
    ticktickProjectId: "proj-1",
    githubUpdatedAt: "2024-01-01T00:00:00Z",
    lastSyncedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

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

  // ── printTasks (human mode) ──

  describe("printTasks (human mode)", () => {
    beforeEach(() => {
      setFormat("human");
    });

    it("prints 'No tasks.' when the list is empty", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTasks([]);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]?.[0]).toContain("No tasks.");
      spy.mockRestore();
    });

    it("prints a task line for each task", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTasks([makeTask({ title: "Alpha" }), makeTask({ id: "task-2", title: "Beta" })]);

      expect(spy).toHaveBeenCalledTimes(2);
      const lines = spy.mock.calls.map((c) => c[0] as string);
      expect(lines.some((l) => l.includes("Alpha"))).toBe(true);
      expect(lines.some((l) => l.includes("Beta"))).toBe(true);
      spy.mockRestore();
    });

    it("includes priority label for High priority tasks", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTasks([makeTask({ priority: Priority.High, title: "Urgent" })]);

      const line = spy.mock.calls[0]?.[0] as string;
      expect(line).toContain("[HIGH]");
      expect(line).toContain("Urgent");
      spy.mockRestore();
    });

    it("includes priority label for Medium priority tasks", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTasks([makeTask({ priority: Priority.Medium, title: "Med task" })]);

      const line = spy.mock.calls[0]?.[0] as string;
      expect(line).toContain("[med]");
      spy.mockRestore();
    });

    it("includes priority label for Low priority tasks", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTasks([makeTask({ priority: Priority.Low, title: "Low task" })]);

      const line = spy.mock.calls[0]?.[0] as string;
      expect(line).toContain("[low]");
      spy.mockRestore();
    });

    it("includes tags in the line", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTasks([makeTask({ tags: ["work", "urgent"] })]);

      const line = spy.mock.calls[0]?.[0] as string;
      expect(line).toContain("#work");
      expect(line).toContain("#urgent");
      spy.mockRestore();
    });
  });

  // ── printTasks (json mode) ──

  describe("printTasks (json mode)", () => {
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

  // ── printTask ──

  describe("printTask (json mode)", () => {
    it("outputs JSON for a single task", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const task = makeTask({ id: "t-42", title: "Single" });

      printTask(task);

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Task;
      expect(output.id).toBe("t-42");
      expect(output.title).toBe("Single");
      spy.mockRestore();
    });
  });

  describe("printTask (human mode)", () => {
    beforeEach(() => {
      setFormat("human");
    });

    it("prints task fields as labelled lines", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const task = makeTask({ id: "t-1", title: "Do work", projectId: "p-99" });

      printTask(task);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("ID:");
      expect(output).toContain("t-1");
      expect(output).toContain("Title:");
      expect(output).toContain("Do work");
      expect(output).toContain("Project:");
      expect(output).toContain("p-99");
      spy.mockRestore();
    });

    it("includes content when present", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTask(makeTask({ content: "Some content" }));

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("Content:");
      expect(output).toContain("Some content");
      spy.mockRestore();
    });

    it("does not print content line when content is empty", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTask(makeTask({ content: "" }));

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).not.toContain("Content:");
      spy.mockRestore();
    });

    it("prints completed status for completed tasks", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTask(makeTask({ status: TaskStatus.Completed }));

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("completed");
      spy.mockRestore();
    });

    it("prints active status for active tasks", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTask(makeTask({ status: TaskStatus.Active }));

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("active");
      spy.mockRestore();
    });

    it("prints tags when present", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTask(makeTask({ tags: ["foo", "bar"] }));

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("Tags:");
      expect(output).toContain("foo, bar");
      spy.mockRestore();
    });

    it("prints priority label", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTask(makeTask({ priority: Priority.High }));

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("[HIGH]");
      spy.mockRestore();
    });
  });

  // ── printProjects ──

  describe("printProjects (json mode)", () => {
    it("outputs JSON array of projects", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const projects = [makeProject(), makeProject({ id: "p-2", name: "Other" })];

      printProjects(projects);

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Project[];
      expect(output).toHaveLength(2);
      expect(output[0]?.id).toBe("proj-1");
      spy.mockRestore();
    });
  });

  describe("printProjects (human mode)", () => {
    beforeEach(() => {
      setFormat("human");
    });

    it("prints 'No projects.' when list is empty", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printProjects([]);

      expect(spy.mock.calls[0]?.[0]).toContain("No projects.");
      spy.mockRestore();
    });

    it("prints a line per project", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const projects = [makeProject(), makeProject({ id: "p-2", name: "Beta" })];

      printProjects(projects);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("My Project");
      expect(output).toContain("Beta");
      spy.mockRestore();
    });

    it("appends (closed) for closed projects", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printProjects([makeProject({ closed: true })]);

      expect(spy.mock.calls[0]?.[0]).toContain("(closed)");
      spy.mockRestore();
    });

    it("does not append (closed) for open projects", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printProjects([makeProject({ closed: false })]);

      expect(spy.mock.calls[0]?.[0]).not.toContain("(closed)");
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

  // ── printSyncResult ──

  describe("printSyncResult (json mode)", () => {
    it("outputs JSON with ok:true, dryRun and result fields", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const result = makeSyncResult({ created: ["owner/repo#1"] });

      printSyncResult(result, false);

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(output["ok"]).toBe(true);
      expect(output["dryRun"]).toBe(false);
      expect(output["created"]).toEqual(["owner/repo#1"]);
      spy.mockRestore();
    });

    it("includes dryRun:true flag when dry run", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSyncResult(makeSyncResult(), true);

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(output["dryRun"]).toBe(true);
      spy.mockRestore();
    });
  });

  describe("printSyncResult (human mode)", () => {
    beforeEach(() => {
      setFormat("human");
    });

    it("prints 'Everything in sync.' when all arrays are empty", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSyncResult(makeSyncResult(), false);

      expect(spy.mock.calls[0]?.[0]).toContain("Everything in sync.");
      spy.mockRestore();
    });

    it("prints created items with '+' icon", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSyncResult(makeSyncResult({ created: ["owner/repo#1", "owner/repo#2"] }), false);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("+ owner/repo#1");
      expect(output).toContain("+ owner/repo#2");
      spy.mockRestore();
    });

    it("prints updated items with '~' icon", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSyncResult(makeSyncResult({ updated: ["owner/repo#3"] }), false);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("~ owner/repo#3");
      spy.mockRestore();
    });

    it("prints completed items with checkmark icon", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSyncResult(makeSyncResult({ completed: ["owner/repo#4"] }), false);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("✓ owner/repo#4");
      spy.mockRestore();
    });

    it("prefixes dry-run lines when dryRun is true", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSyncResult(makeSyncResult({ created: ["owner/repo#1"] }), true);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("[dry-run]");
      spy.mockRestore();
    });

    it("prints error items with '✗' icon", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSyncResult(makeSyncResult({ errors: ["something went wrong"] }), false);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("✗ something went wrong");
      spy.mockRestore();
    });

    it("does not print 'Everything in sync.' when there are errors", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      printSyncResult(makeSyncResult({ errors: ["err"] }), false);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).not.toContain("Everything in sync.");
      spy.mockRestore();
    });
  });

  // ── printSyncStatus ──

  describe("printSyncStatus (json mode)", () => {
    it("outputs JSON with repos, lastSyncAt and mappings", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const state: SyncState = {
        mappings: [makeSyncMapping()],
        lastSyncAt: "2024-06-01T10:00:00Z",
      };

      printSyncStatus(state, ["owner/repo"]);

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(output["repos"]).toEqual(["owner/repo"]);
      expect(output["lastSyncAt"]).toBe("2024-06-01T10:00:00Z");
      expect(Array.isArray(output["mappings"])).toBe(true);
      spy.mockRestore();
    });

    it("outputs null for lastSyncAt when never synced", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const state: SyncState = { mappings: [] };

      printSyncStatus(state, []);

      const output = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(output["lastSyncAt"]).toBeNull();
      spy.mockRestore();
    });
  });

  describe("printSyncStatus (human mode)", () => {
    beforeEach(() => {
      setFormat("human");
    });

    it("prints repos, last sync and active mapping count", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const state: SyncState = {
        mappings: [makeSyncMapping()],
        lastSyncAt: "2024-06-01T10:00:00Z",
      };

      printSyncStatus(state, ["owner/repo"]);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("owner/repo");
      expect(output).toContain("2024-06-01T10:00:00Z");
      expect(output).toContain("Active mappings: 1");
      spy.mockRestore();
    });

    it("prints 'never' when lastSyncAt is undefined", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const state: SyncState = { mappings: [] };

      printSyncStatus(state, ["owner/repo"]);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("never");
      spy.mockRestore();
    });

    it("lists individual mapping details", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const state: SyncState = {
        mappings: [
          makeSyncMapping({
            githubRepo: "owner/repo",
            githubIssueNumber: 42,
            ticktickTaskId: "tt-abc",
          }),
        ],
      };

      printSyncStatus(state, ["owner/repo"]);

      const output = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("owner/repo#42");
      expect(output).toContain("tt-abc");
      spy.mockRestore();
    });
  });
});
