import { Box, Text } from "ink";
import type { GitHubIssue } from "../../github.js";

interface IssueRowProps {
  readonly issue: GitHubIssue;
  readonly selfLogin: string;
  readonly isSelected: boolean;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

function formatTargetDate(dateStr: string | undefined): { text: string; color: string } {
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

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

const LABEL_COLORS: Record<string, string> = {
  bug: "red",
  enhancement: "green",
  feature: "green",
  documentation: "blue",
  "good first issue": "magenta",
  help: "yellow",
  question: "yellow",
  urgent: "red",
  wontfix: "gray",
};

function labelColor(name: string): string {
  return LABEL_COLORS[name.toLowerCase()] ?? "cyan";
}

const LABEL_COL_WIDTH = 30;

function IssueRow({ issue, selfLogin, isSelected }: IssueRowProps) {
  const assignees = issue.assignees ?? [];
  const isSelf = assignees.some((a) => a.login === selfLogin);
  const isUnassigned = assignees.length === 0;

  const assigneeColor = isSelf ? "green" : isUnassigned ? "gray" : "white";
  const assigneeText = isUnassigned
    ? "unassigned"
    : truncate(assignees.map((a) => a.login).join(", "), 14);
  const labels = (issue.labels ?? []).slice(0, 2);
  const target = formatTargetDate(issue.targetDate);
  const titleStr = truncate(issue.title, 42).padEnd(42);

  return (
    <Box>
      {isSelected ? (
        <Text color="cyan" bold>
          {"\u25B6 "}
        </Text>
      ) : (
        <Text>{"  "}</Text>
      )}
      <Text color="cyan">#{String(issue.number).padEnd(5)}</Text>
      <Text> </Text>
      {isSelected ? (
        <Text color="white" bold>
          {titleStr}
        </Text>
      ) : (
        <Text>{titleStr}</Text>
      )}
      <Text> </Text>
      <Box width={LABEL_COL_WIDTH}>
        {labels.map((l, i) => (
          <Text key={l.name}>
            {i > 0 ? " " : ""}
            <Text color={labelColor(l.name)}>[{truncate(l.name, 12)}]</Text>
          </Text>
        ))}
      </Box>
      <Text> </Text>
      <Text color={assigneeColor}>{assigneeText.padEnd(14)}</Text>
      <Text> </Text>
      <Text color="gray">{timeAgo(issue.updatedAt).padStart(4)}</Text>
      {target.text ? (
        <>
          <Text> </Text>
          <Text color={target.color}>{target.text}</Text>
        </>
      ) : null}
    </Box>
  );
}

export { IssueRow };
export type { IssueRowProps };
