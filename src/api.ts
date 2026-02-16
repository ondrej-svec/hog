import type { CreateTaskInput, Project, ProjectData, Task, UpdateTaskInput } from "./types.js";

const BASE_URL = "https://api.ticktick.com/open/v1";

export class TickTickClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("GET", "/project");
  }

  async getProject(projectId: string): Promise<Project> {
    return this.request<Project>("GET", `/project/${projectId}`);
  }

  async getProjectData(projectId: string): Promise<ProjectData> {
    return this.request<ProjectData>("GET", `/project/${projectId}/data`);
  }

  async listTasks(projectId: string): Promise<Task[]> {
    const data = await this.getProjectData(projectId);
    return data.tasks ?? [];
  }

  async getTask(projectId: string, taskId: string): Promise<Task> {
    return this.request<Task>("GET", `/project/${projectId}/task/${taskId}`);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.request<Task>("POST", "/task", input);
  }

  async updateTask(input: UpdateTaskInput): Promise<Task> {
    return this.request<Task>("POST", `/task/${input.id}`, input);
  }

  async completeTask(projectId: string, taskId: string): Promise<void> {
    await this.request<void>("POST", `/project/${projectId}/task/${taskId}/complete`);
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.request<void>("DELETE", `/project/${projectId}/task/${taskId}`);
  }
}
