import { Box, Text } from "ink";
import type { GitHubIssue } from "../../github.js";
import type { Task } from "../../types.js";
import { timeAgo } from "../constants.js";
import type { ActivityEvent } from "../fetch.js";
import { IssueRow } from "./issue-row.js";
import { TaskRow } from "./task-row.js";

// ── Types ──

export type FlatRow =
  | {
      type: "sectionHeader";
      key: string;
      navId: string;
      label: string;
      count: number;
      countLabel: string;
      isCollapsed: boolean;
    }
  | {
      type: "subHeader";
      key: string;
      navId: string | null;
      text: string;
      count?: number;
      isCollapsed?: boolean;
    }
  | { type: "issue"; key: string; navId: string; issue: GitHubIssue; repoName: string }
  | { type: "task"; key: string; navId: string; task: Task }
  | { type: "activity"; key: string; navId: null; event: ActivityEvent }
  | { type: "error"; key: string; navId: null; text: string }
  | { type: "gap"; key: string; navId: null };

interface RowRendererProps {
  readonly row: FlatRow;
  readonly selectedId: string | null;
  readonly selfLogin: string;
  readonly isMultiSelected?: boolean | undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many row type variants
export function RowRenderer({ row, selectedId, selfLogin, isMultiSelected }: RowRendererProps) {
  switch (row.type) {
    case "sectionHeader": {
      const arrow = row.isCollapsed ? "\u25B6" : "\u25BC";
      const isSel = selectedId === row.navId;
      return (
        <Box>
          <Text color={isSel ? "cyan" : "white"} bold>
            {arrow} {row.label}
          </Text>
          <Text color="gray">
            {" "}
            ({row.count} {row.countLabel})
          </Text>
        </Box>
      );
    }
    case "subHeader": {
      if (row.navId) {
        const arrow = row.isCollapsed ? "\u25B6" : "\u25BC";
        const isSel = selectedId === row.navId;
        return (
          <Box>
            <Text color={isSel ? "cyan" : "gray"}>
              {"  "}
              {arrow} {row.text}
            </Text>
            <Text color="gray"> ({row.count})</Text>
          </Box>
        );
      }
      return (
        <Box>
          <Text bold color="white">
            {" "}
            {row.text}
          </Text>
          {row.count != null ? <Text color="gray"> ({row.count})</Text> : null}
        </Box>
      );
    }
    case "issue": {
      const checkbox = isMultiSelected != null ? (isMultiSelected ? "\u2611 " : "\u2610 ") : "";
      return (
        <Box>
          {checkbox ? <Text color={isMultiSelected ? "cyan" : "gray"}>{checkbox}</Text> : null}
          <IssueRow issue={row.issue} selfLogin={selfLogin} isSelected={selectedId === row.navId} />
        </Box>
      );
    }
    case "task": {
      const checkbox = isMultiSelected != null ? (isMultiSelected ? "\u2611 " : "\u2610 ") : "";
      return (
        <Box>
          {checkbox ? <Text color={isMultiSelected ? "cyan" : "gray"}>{checkbox}</Text> : null}
          <TaskRow task={row.task} isSelected={selectedId === row.navId} />
        </Box>
      );
    }
    case "activity": {
      const ago = timeAgo(row.event.timestamp);
      return (
        <Text dimColor>
          {"  "}
          {ago}: <Text color="gray">@{row.event.actor}</Text> {row.event.summary}{" "}
          <Text dimColor>({row.event.repoShortName})</Text>
        </Text>
      );
    }
    case "error":
      return <Text color="red"> Error: {row.text}</Text>;
    case "gap":
      return <Text>{""}</Text>;
  }
}
