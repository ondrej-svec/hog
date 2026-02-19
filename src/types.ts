// ── Result Type (no throwing in data layer) ──

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface FetchError {
  readonly type: "github" | "ticktick" | "network";
  readonly message: string;
}

// ── GitHub Comment ──

export interface IssueComment {
  readonly body: string;
  readonly author: { readonly login: string };
  readonly createdAt: string;
}

// ── Board Data Types ──

export interface BoardIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly assignee: string | null;
  readonly labels: readonly string[];
  readonly updatedAt: string;
  readonly repo: string;
}

export interface BoardData {
  readonly github: readonly BoardIssue[];
  readonly ticktick: readonly Task[];
  readonly fetchedAt: Date;
}

// ── Pick Command ──

export interface PickResult {
  readonly success: boolean;
  readonly issue: BoardIssue;
  readonly ticktickTask?: Task;
  readonly warning?: string;
}

// ── TickTick Open API types ──

export interface Task {
  id: string;
  projectId: string;
  title: string;
  content: string;
  desc: string;
  isAllDay: boolean;
  startDate: string;
  dueDate: string;
  completedTime: string;
  priority: Priority;
  reminders: string[];
  repeatFlag: string;
  sortOrder: number;
  status: TaskStatus;
  timeZone: string;
  tags: string[];
  items: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  title: string;
  status: number;
  completedTime: number;
  isAllDay: boolean;
  sortOrder: number;
  startDate: string;
  timeZone: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  closed: boolean;
  groupId: string;
  viewMode: string;
  kind: string;
}

export interface ProjectData {
  project: Project;
  tasks: Task[];
}

export enum Priority {
  None = 0,
  Low = 1,
  Medium = 3,
  High = 5,
}

export enum TaskStatus {
  Active = 0,
  Completed = 2,
}

export interface CreateTaskInput {
  title: string;
  projectId?: string;
  content?: string;
  priority?: Priority;
  startDate?: string;
  dueDate?: string;
  isAllDay?: boolean;
  timeZone?: string;
  tags?: string[];
}

export interface UpdateTaskInput {
  id: string;
  projectId: string;
  title?: string;
  content?: string;
  priority?: Priority;
  startDate?: string;
  dueDate?: string;
  isAllDay?: boolean;
  tags?: string[];
}
