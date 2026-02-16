import { Box, Text } from "ink";
import type { Task } from "../../types.js";
import { Priority } from "../../types.js";

interface TaskRowProps {
  readonly task: Task;
  readonly isSelected: boolean;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

function formatDue(dateStr: string | undefined): { text: string; color: string } {
  if (!dateStr) return { text: "", color: "gray" };
  const d = new Date(dateStr);
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);

  if (days < 0) return { text: `${Math.abs(days)}d overdue`, color: "red" };
  if (days === 0) return { text: "today", color: "yellow" };
  if (days === 1) return { text: "tomorrow", color: "white" };
  if (days <= 7) return { text: `in ${days}d`, color: "white" };
  return {
    text: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    color: "gray",
  };
}

const PRIORITY_INDICATORS: Record<number, { text: string; color: string }> = {
  [Priority.High]: { text: "[!]", color: "red" },
  [Priority.Medium]: { text: "[~]", color: "yellow" },
  [Priority.Low]: { text: "[\u2193]", color: "blue" },
  [Priority.None]: { text: "   ", color: "gray" },
};

const DEFAULT_PRIORITY = { text: "   ", color: "gray" };

function TaskRow({ task, isSelected }: TaskRowProps) {
  const pri = PRIORITY_INDICATORS[task.priority] ?? DEFAULT_PRIORITY;
  const due = formatDue(task.dueDate);
  const titleStr = truncate(task.title, 45).padEnd(45);

  return (
    <Box>
      {isSelected ? (
        <Text color="cyan" bold>
          {"\u25B6 "}
        </Text>
      ) : (
        <Text>{"  "}</Text>
      )}
      <Text color={pri.color}>{pri.text}</Text>
      <Text> </Text>
      {isSelected ? (
        <Text color="white" bold>
          {titleStr}
        </Text>
      ) : (
        <Text>{titleStr}</Text>
      )}
      <Text> </Text>
      <Text color={due.color}>{due.text}</Text>
    </Box>
  );
}

export { TaskRow };
export type { TaskRowProps };
