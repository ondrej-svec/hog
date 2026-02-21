import type { CreateTaskInput, Project, ProjectData, Task, UpdateTaskInput } from "./types.js";

const BASE_URL = "https://api.ticktick.com/open/v1";

export class TickTickClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const url = `${BASE_URL}${path}`;

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TickTick API error ${res.status}: ${text}`);
    }

    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  }

  async listProjects(): Promise<Project[]> {
    return (await this.request<Project[]>("GET", "/project")) ?? [];
  }

  async getProject(projectId: string): Promise<Project> {
    const result = await this.request<Project>("GET", `/project/${projectId}`);
    if (!result) throw new Error(`TickTick API returned empty response for project ${projectId}`);
    return result;
  }

  async getProjectData(projectId: string): Promise<ProjectData> {
    const result = await this.request<ProjectData>("GET", `/project/${projectId}/data`);
    if (!result)
      throw new Error(`TickTick API returned empty response for project data ${projectId}`);
    return result;
  }

  async listTasks(projectId: string): Promise<Task[]> {
    const data = await this.getProjectData(projectId);
    return data.tasks ?? [];
  }

  async getTask(projectId: string, taskId: string): Promise<Task> {
    const result = await this.request<Task>("GET", `/project/${projectId}/task/${taskId}`);
    if (!result) throw new Error(`TickTick API returned empty response for task ${taskId}`);
    return result;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const result = await this.request<Task>("POST", "/task", input);
    if (!result) throw new Error("TickTick API returned empty response for createTask");
    return result;
  }

  async updateTask(input: UpdateTaskInput): Promise<Task> {
    const result = await this.request<Task>("POST", `/task/${input.id}`, input);
    if (!result) throw new Error(`TickTick API returned empty response for updateTask ${input.id}`);
    return result;
  }

  async completeTask(projectId: string, taskId: string): Promise<void> {
    await this.request<void>("POST", `/project/${projectId}/task/${taskId}/complete`);
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.request<void>("DELETE", `/project/${projectId}/task/${taskId}`);
  }
}
