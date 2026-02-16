import type { SyncResult } from "./sync.js";
import type { SyncState } from "./sync-state.js";
import type { Project, Task } from "./types.js";
import { Priority } from "./types.js";

const isTTY = process.stdout.isTTY ?? false;

let forceFormat: "json" | "human" | null = null;

export function setFormat(format: "json" | "human"): void {
  forceFormat = format;
}

export function useJson(): boolean {
  if (forceFormat === "json") return true;
  if (forceFormat === "human") return false;
  return !isTTY;
}

export function jsonOut(data: unknown): void {
  console.log(JSON.stringify(data));
}

const PRIORITY_LABELS: Record<number, string> = {
  [Priority.None]: "",
  [Priority.Low]: "[low]",
  [Priority.Medium]: "[med]",
  [Priority.High]: "[HIGH]",
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);

  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return `in ${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function taskLine(t: Task): string {
  const parts: string[] = [];
  const pri = PRIORITY_LABELS[t.priority] ?? "";
  if (pri) parts.push(pri);
  parts.push(t.title);
  if (t.dueDate) parts.push(`  ${formatDate(t.dueDate)}`);
  if (t.tags.length > 0) parts.push(`  #${t.tags.join(" #")}`);
  return `  ${t.id}  ${parts.join(" ")}`;
}

export function printTasks(tasks: Task[]): void {
  if (useJson()) {
    jsonOut(tasks);
    return;
  }
  if (tasks.length === 0) {
    console.log("  No tasks.");
    return;
  }
  for (const t of tasks) {
    console.log(taskLine(t));
  }
}

export function printTask(task: Task): void {
  if (useJson()) {
    jsonOut(task);
    return;
  }
  console.log(`  ID:       ${task.id}`);
  console.log(`  Title:    ${task.title}`);
  if (task.content) console.log(`  Content:  ${task.content}`);
  console.log(`  Priority: ${PRIORITY_LABELS[task.priority] ?? "none"}`);
  if (task.dueDate) console.log(`  Due:      ${formatDate(task.dueDate)}`);
  if (task.startDate) console.log(`  Start:    ${formatDate(task.startDate)}`);
  if (task.tags.length > 0) console.log(`  Tags:     ${task.tags.join(", ")}`);
  console.log(`  Project:  ${task.projectId}`);
  console.log(`  Status:   ${task.status === 2 ? "completed" : "active"}`);
}

export function printProjects(projects: Project[]): void {
  if (useJson()) {
    jsonOut(projects);
    return;
  }
  if (projects.length === 0) {
    console.log("  No projects.");
    return;
  }
  for (const p of projects) {
    const closed = p.closed ? " (closed)" : "";
    console.log(`  ${p.id}  ${p.name}${closed}`);
  }
}

export function printSuccess(message: string, data?: Record<string, unknown>): void {
  if (useJson()) {
    jsonOut({ ok: true, message, ...data });
    return;
  }
  console.log(message);
}

function printSection(prefix: string, label: string, icon: string, items: string[]): void {
  if (items.length === 0) return;
  console.log(`${prefix}${label} ${items.length} task(s):`);
  for (const key of items) console.log(`  ${icon} ${key}`);
}

export function printSyncResult(result: SyncResult, dryRun: boolean): void {
  if (useJson()) {
    jsonOut({ ok: true, dryRun, ...result });
    return;
  }
  const prefix = dryRun ? "[dry-run] " : "";
  printSection(prefix, "Created", "+", result.created);
  printSection(prefix, "Updated", "~", result.updated);
  printSection(prefix, "Completed", "✓", result.completed);
  printSection(prefix, "GitHub updated", "→", result.ghUpdated);
  printSection("", "Errors", "✗", result.errors);
  const total =
    result.created.length +
    result.updated.length +
    result.completed.length +
    result.ghUpdated.length;
  if (total === 0 && result.errors.length === 0) {
    console.log(`${prefix}Everything in sync.`);
  }
}

export function printSyncStatus(state: SyncState, repos: string[]): void {
  if (useJson()) {
    jsonOut({ repos, lastSyncAt: state.lastSyncAt ?? null, mappings: state.mappings });
    return;
  }
  console.log(`  Repos: ${repos.join(", ")}`);
  console.log(`  Last sync: ${state.lastSyncAt ?? "never"}`);
  console.log(`  Active mappings: ${state.mappings.length}`);
  if (state.mappings.length > 0) {
    for (const m of state.mappings) {
      console.log(`    ${m.githubRepo}#${m.githubIssueNumber} → ${m.ticktickTaskId}`);
    }
  }
}
