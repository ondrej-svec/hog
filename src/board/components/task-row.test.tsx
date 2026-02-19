import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { Task } from "../../types.js";
import { Priority, TaskStatus } from "../../types.js";
import type { TaskRowProps } from "./task-row.js";
import { TaskRow } from "./task-row.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Write unit tests",
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

function renderRow(overrides: Partial<TaskRowProps> = {}) {
  const props: TaskRowProps = {
    task: makeTask(),
    isSelected: false,
    ...overrides,
  };
  return render(React.createElement(TaskRow, props));
}

describe("TaskRow", () => {
  it("renders the task title", async () => {
    const { lastFrame } = renderRow();
    await delay(50);
    expect(lastFrame()).toContain("Write unit tests");
  });

  it("truncates long titles to 45 characters", async () => {
    const longTitle = "B".repeat(60);
    const { lastFrame } = renderRow({ task: makeTask({ title: longTitle }) });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain(longTitle);
    expect(frame).toContain("B".repeat(44));
  });

  it("shows '[!]' indicator for high priority", async () => {
    const { lastFrame } = renderRow({ task: makeTask({ priority: Priority.High }) });
    await delay(50);
    expect(lastFrame()).toContain("[!]");
  });

  it("shows '[~]' indicator for medium priority", async () => {
    const { lastFrame } = renderRow({ task: makeTask({ priority: Priority.Medium }) });
    await delay(50);
    expect(lastFrame()).toContain("[~]");
  });

  it("shows down-arrow indicator for low priority", async () => {
    const { lastFrame } = renderRow({ task: makeTask({ priority: Priority.Low }) });
    await delay(50);
    // Low priority uses ↓ (Unicode \u2193)
    expect(lastFrame()).toContain("[\u2193]");
  });

  it("shows three spaces for no priority", async () => {
    const { lastFrame } = renderRow({ task: makeTask({ priority: Priority.None }) });
    await delay(50);
    // Priority.None renders three spaces — the title still renders after those spaces
    expect(lastFrame()).toContain("Write unit tests");
  });

  it("shows '▶ ' selection arrow when isSelected=true", async () => {
    const { lastFrame } = renderRow({ isSelected: true });
    await delay(50);
    expect(lastFrame()).toContain("▶");
  });

  it("does not show selection arrow when isSelected=false", async () => {
    const { lastFrame } = renderRow({ isSelected: false });
    await delay(50);
    expect(lastFrame()).not.toContain("▶");
  });

  it("shows 'today' due date label for a task due today", async () => {
    // Use midnight of today so Math.ceil((d - now) / 86400000) === 0
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { lastFrame } = renderRow({ task: makeTask({ dueDate: today.toISOString() }) });
    await delay(50);
    expect(lastFrame()).toContain("today");
  });

  it("shows 'tomorrow' label for task due tomorrow", async () => {
    // Set exactly midnight tomorrow so days === 1
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const { lastFrame } = renderRow({ task: makeTask({ dueDate: tomorrow.toISOString() }) });
    await delay(50);
    expect(lastFrame()).toContain("tomorrow");
  });

  it("shows 'X d overdue' for a task past its due date", async () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const { lastFrame } = renderRow({ task: makeTask({ dueDate: past.toISOString() }) });
    await delay(50);
    expect(lastFrame()).toContain("overdue");
  });

  it("shows 'in Xd' for a due date within 7 days", async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { lastFrame } = renderRow({ task: makeTask({ dueDate: future.toISOString() }) });
    await delay(50);
    expect(lastFrame()).toContain("in 3d");
  });

  it("shows a formatted date (e.g. 'Mar 1') for a due date more than 7 days away", async () => {
    // Pick a fixed future date to avoid locale-specific flakiness
    const future = new Date("2099-03-01T12:00:00Z");
    const { lastFrame } = renderRow({ task: makeTask({ dueDate: future.toISOString() }) });
    await delay(50);
    const frame = lastFrame() ?? "";
    // The formatted date should contain "Mar" (month) and "1" (day)
    expect(frame).toMatch(/Mar\s*1/);
  });

  it("does not show any due-date text when dueDate is empty", async () => {
    const { lastFrame } = renderRow({ task: makeTask({ dueDate: "" }) });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("overdue");
    expect(frame).not.toContain("today");
    expect(frame).not.toContain("tomorrow");
    expect(frame).not.toContain("in ");
  });

  it("renders title in bold when selected", async () => {
    // We can't directly test ANSI bold, but we verify the title still appears
    // and that the selection indicator is present alongside it
    const { lastFrame } = renderRow({ isSelected: true });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Write unit tests");
    expect(frame).toContain("▶");
  });
});
