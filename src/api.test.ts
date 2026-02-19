import { beforeEach, describe, expect, it, vi } from "vitest";
import { TickTickClient } from "./api.js";
import type { CreateTaskInput, Project, ProjectData, Task, UpdateTaskInput } from "./types.js";
import { Priority, TaskStatus } from "./types.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

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
    timeZone: "UTC",
    tags: [],
    items: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Inbox",
    color: "#ff0000",
    sortOrder: 0,
    closed: false,
    groupId: "",
    viewMode: "list",
    kind: "TASK",
    ...overrides,
  };
}

function mockOkResponse(body: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockEmptyResponse(): void {
  mockFetch.mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(""),
  });
}

function mockErrorResponse(status: number, body: string): void {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

describe("TickTickClient", () => {
  describe("constructor", () => {
    it("creates a client with the given token", () => {
      const client = new TickTickClient("my-token");
      expect(client).toBeInstanceOf(TickTickClient);
    });
  });

  describe("request internals", () => {
    it("sends Authorization header with Bearer token", async () => {
      const client = new TickTickClient("secret-token");
      mockOkResponse([]);

      await client.listProjects();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/project",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer secret-token",
          }),
        }),
      );
    });

    it("sets Content-Type to application/json", async () => {
      const client = new TickTickClient("token");
      mockOkResponse([]);

      await client.listProjects();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("throws on non-ok response with status and body", async () => {
      const client = new TickTickClient("token");
      mockErrorResponse(401, "Unauthorized");

      await expect(client.listProjects()).rejects.toThrow("TickTick API error 401: Unauthorized");
    });

    it("throws on 404 response", async () => {
      const client = new TickTickClient("token");
      mockErrorResponse(404, "Not Found");

      await expect(client.getProject("nonexistent")).rejects.toThrow(
        "TickTick API error 404: Not Found",
      );
    });

    it("throws on 500 response", async () => {
      const client = new TickTickClient("token");
      mockErrorResponse(500, "Internal Server Error");

      await expect(client.listProjects()).rejects.toThrow(
        "TickTick API error 500: Internal Server Error",
      );
    });

    it("returns undefined when response body is empty", async () => {
      const client = new TickTickClient("token");
      mockEmptyResponse();

      const result = await client.completeTask("proj-1", "task-1");
      expect(result).toBeUndefined();
    });
  });

  describe("listProjects", () => {
    it("calls GET /project and returns project list", async () => {
      const client = new TickTickClient("token");
      const projects = [makeProject(), makeProject({ id: "proj-2", name: "Work" })];
      mockOkResponse(projects);

      const result = await client.listProjects();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/project",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual(projects);
    });

    it("returns empty array when no projects", async () => {
      const client = new TickTickClient("token");
      mockOkResponse([]);

      const result = await client.listProjects();

      expect(result).toEqual([]);
    });
  });

  describe("getProject", () => {
    it("calls GET /project/:id and returns the project", async () => {
      const client = new TickTickClient("token");
      const project = makeProject({ id: "proj-42" });
      mockOkResponse(project);

      const result = await client.getProject("proj-42");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/project/proj-42",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual(project);
    });
  });

  describe("getProjectData", () => {
    it("calls GET /project/:id/data and returns project data", async () => {
      const client = new TickTickClient("token");
      const data: ProjectData = {
        project: makeProject(),
        tasks: [makeTask()],
      };
      mockOkResponse(data);

      const result = await client.getProjectData("proj-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/project/proj-1/data",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual(data);
    });
  });

  describe("listTasks", () => {
    it("returns tasks from getProjectData", async () => {
      const client = new TickTickClient("token");
      const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
      const data: ProjectData = { project: makeProject(), tasks };
      mockOkResponse(data);

      const result = await client.listTasks("proj-1");

      expect(result).toEqual(tasks);
    });

    it("returns empty array when project data has no tasks", async () => {
      const client = new TickTickClient("token");
      // tasks is missing from response — simulates nullish scenario
      mockOkResponse({ project: makeProject() });

      const result = await client.listTasks("proj-1");

      expect(result).toEqual([]);
    });
  });

  describe("getTask", () => {
    it("calls GET /project/:projectId/task/:taskId", async () => {
      const client = new TickTickClient("token");
      const task = makeTask({ id: "task-99", projectId: "proj-1" });
      mockOkResponse(task);

      const result = await client.getTask("proj-1", "task-99");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/project/proj-1/task/task-99",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual(task);
    });
  });

  describe("createTask", () => {
    it("calls POST /task with input body and returns created task", async () => {
      const client = new TickTickClient("token");
      const input: CreateTaskInput = {
        title: "New task",
        projectId: "proj-1",
        priority: Priority.High,
      };
      const created = makeTask({ id: "new-task", title: "New task", priority: Priority.High });
      mockOkResponse(created);

      const result = await client.createTask(input);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/task",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
      expect(result).toEqual(created);
    });

    it("includes all optional fields in request body", async () => {
      const client = new TickTickClient("token");
      const input: CreateTaskInput = {
        title: "Full task",
        projectId: "proj-1",
        content: "Details here",
        priority: Priority.Medium,
        startDate: "2026-02-01",
        dueDate: "2026-02-28",
        isAllDay: true,
        timeZone: "America/New_York",
        tags: ["github", "backend"],
      };
      mockOkResponse(makeTask({ title: "Full task" }));

      await client.createTask(input);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify(input) }),
      );
    });

    it("throws when API returns error", async () => {
      const client = new TickTickClient("token");
      mockErrorResponse(400, "Bad Request: missing title");

      await expect(client.createTask({ title: "" })).rejects.toThrow(
        "TickTick API error 400: Bad Request: missing title",
      );
    });
  });

  describe("updateTask", () => {
    it("calls POST /task/:id with input body and returns updated task", async () => {
      const client = new TickTickClient("token");
      const input: UpdateTaskInput = {
        id: "task-1",
        projectId: "proj-1",
        title: "Updated title",
        priority: Priority.Low,
      };
      const updated = makeTask({ id: "task-1", title: "Updated title", priority: Priority.Low });
      mockOkResponse(updated);

      const result = await client.updateTask(input);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/task/task-1",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
      expect(result).toEqual(updated);
    });

    it("uses the task id from the input for the URL", async () => {
      const client = new TickTickClient("token");
      const input: UpdateTaskInput = { id: "my-unique-id", projectId: "proj-abc" };
      mockOkResponse(makeTask({ id: "my-unique-id" }));

      await client.updateTask(input);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/task/my-unique-id",
        expect.any(Object),
      );
    });

    it("throws when API returns error", async () => {
      const client = new TickTickClient("token");
      mockErrorResponse(403, "Forbidden");

      await expect(client.updateTask({ id: "task-1", projectId: "proj-1" })).rejects.toThrow(
        "TickTick API error 403: Forbidden",
      );
    });
  });

  describe("completeTask", () => {
    it("calls POST /project/:projectId/task/:taskId/complete", async () => {
      const client = new TickTickClient("token");
      mockEmptyResponse();

      await client.completeTask("proj-1", "task-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/project/proj-1/task/task-1/complete",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("does not send a request body", async () => {
      const client = new TickTickClient("token");
      mockEmptyResponse();

      await client.completeTask("proj-1", "task-1");

      const callInit = mockFetch.mock.calls[0]?.[1] as RequestInit;
      expect(callInit.body).toBeUndefined();
    });

    it("throws when API returns error", async () => {
      const client = new TickTickClient("token");
      mockErrorResponse(404, "Task not found");

      await expect(client.completeTask("proj-1", "missing-task")).rejects.toThrow(
        "TickTick API error 404: Task not found",
      );
    });
  });

  describe("deleteTask", () => {
    it("calls DELETE /project/:projectId/task/:taskId", async () => {
      const client = new TickTickClient("token");
      mockEmptyResponse();

      await client.deleteTask("proj-1", "task-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.ticktick.com/open/v1/project/proj-1/task/task-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("does not send a request body", async () => {
      const client = new TickTickClient("token");
      mockEmptyResponse();

      await client.deleteTask("proj-1", "task-1");

      const callInit = mockFetch.mock.calls[0]?.[1] as RequestInit;
      expect(callInit.body).toBeUndefined();
    });

    it("throws when API returns error", async () => {
      const client = new TickTickClient("token");
      mockErrorResponse(404, "Task not found");

      await expect(client.deleteTask("proj-1", "missing")).rejects.toThrow(
        "TickTick API error 404: Task not found",
      );
    });
  });

  describe("token isolation", () => {
    it("two clients with different tokens use their own token", async () => {
      const clientA = new TickTickClient("token-A");
      const clientB = new TickTickClient("token-B");
      mockOkResponse([]);
      mockOkResponse([]);

      await clientA.listProjects();
      await clientB.listProjects();

      const calls = mockFetch.mock.calls as [string, RequestInit][];
      expect(calls).toHaveLength(2);
      expect((calls[0]?.[1].headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer token-A",
      );
      expect((calls[1]?.[1].headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer token-B",
      );
    });
  });
});
