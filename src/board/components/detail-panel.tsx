import { Box, Text } from "ink";
import { useEffect } from "react";
import type { GitHubIssue, IssueComment } from "../../github.js";
import type { Task } from "../../types.js";
import { Priority } from "../../types.js";

interface DetailPanelProps {
  readonly issue: GitHubIssue | null;
  readonly task: Task | null;
  readonly width: number;
  readonly commentsState?: IssueComment[] | "loading" | "error" | null;
  readonly fetchComments?: (repo: string, issueNumber: number) => void;
  readonly issueRepo?: string | null;
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n").slice(0, maxLines);
  return lines.join("\n");
}

/** Strip common markdown syntax for plain text display. */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/__(.+?)__/g, "$1") // bold alt
    .replace(/_(.+?)_/g, "$1") // italic alt
    .replace(/~~(.+?)~~/g, "$1") // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, "")) // inline code
    .replace(/^\s*[-*+]\s+/gm, "  - ") // list items
    .replace(/^\s*\d+\.\s+/gm, "  ") // numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "[$1]") // images
    .replace(/^>\s+/gm, "  ") // blockquotes
    .replace(/---+/g, "") // horizontal rules
    .replace(/\n{3,}/g, "\n\n") // collapse blank lines
    .trim();
}

function formatBody(body: string, maxLines: number): { text: string; remaining: number } {
  const plain = stripMarkdown(body);
  const lines = plain.split("\n");
  const truncated = lines.slice(0, maxLines).join("\n");
  return { text: truncated, remaining: Math.max(0, lines.length - maxLines) };
}

const SLACK_URL_RE = /https:\/\/[^/]+\.slack\.com\/archives\/[A-Z0-9]+\/p[0-9]+/gi;

function countSlackLinks(body: string | undefined): number {
  if (!body) return 0;
  return (body.match(SLACK_URL_RE) ?? []).length;
}

const PRIORITY_LABELS: Record<number, string> = {
  [Priority.High]: "High",
  [Priority.Medium]: "Medium",
  [Priority.Low]: "Low",
  [Priority.None]: "None",
};

function BodySection({
  body,
  issueNumber,
}: {
  readonly body: string;
  readonly issueNumber: number;
}) {
  const { text, remaining } = formatBody(body, 15);
  return (
    <>
      <Text>{""}</Text>
      <Text dimColor>--- Description ---</Text>
      <Text wrap="wrap">{text}</Text>
      {remaining > 0 ? (
        <Text dimColor>
          ... ({remaining} more lines — gh issue view {issueNumber} for full)
        </Text>
      ) : null}
    </>
  );
}

function formatCommentAge(createdAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: conditional rendering for issue vs task
function DetailPanel({ issue, task, width, commentsState, fetchComments, issueRepo }: DetailPanelProps) {
  // Trigger lazy fetch when issue changes and panel is visible
  useEffect(() => {
    if (!issue || !fetchComments || !issueRepo) return;
    if (commentsState !== null && commentsState !== undefined) return; // already fetched or loading
    fetchComments(issueRepo, issue.number);
  }, [issue?.number, issueRepo, fetchComments, commentsState]);
  if (!(issue || task)) {
    return (
      <Box
        width={width}
        borderStyle="single"
        borderColor="gray"
        flexDirection="column"
        paddingX={1}
      >
        <Text color="gray">No item selected</Text>
      </Box>
    );
  }

  if (issue) {
    return (
      <Box
        width={width}
        borderStyle="single"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
      >
        <Text color="cyan" bold>
          #{issue.number} {issue.title}
        </Text>
        <Text>{""}</Text>

        <Box>
          <Text color="gray">State: </Text>
          <Text color={issue.state === "open" ? "green" : "red"}>{issue.state}</Text>
        </Box>

        {(issue.assignees ?? []).length > 0 ? (
          <Box>
            <Text color="gray">Assignees: </Text>
            <Text>{(issue.assignees ?? []).map((a) => a.login).join(", ")}</Text>
          </Box>
        ) : null}

        {issue.labels.length > 0 ? (
          <Box>
            <Text color="gray">Labels: </Text>
            <Text>{issue.labels.map((l) => l.name).join(", ")}</Text>
          </Box>
        ) : null}

        {issue.projectStatus ? (
          <Box>
            <Text color="gray">Status: </Text>
            <Text color="magenta">{issue.projectStatus}</Text>
          </Box>
        ) : null}

        {issue.targetDate ? (
          <Box>
            <Text color="gray">Target: </Text>
            <Text>{issue.targetDate}</Text>
          </Box>
        ) : null}

        <Box>
          <Text color="gray">Updated: </Text>
          <Text>{new Date(issue.updatedAt).toLocaleString()}</Text>
        </Box>

        {issue.slackThreadUrl ? (
          <Box>
            <Text color="gray">Slack: </Text>
            <Text color="blue">
              {countSlackLinks(issue.body) > 1
                ? `${countSlackLinks(issue.body)} links (s opens first)`
                : "thread (s to open)"}
            </Text>
          </Box>
        ) : null}

        {issue.body ? (
          <BodySection body={issue.body} issueNumber={issue.number} />
        ) : (
          <>
            <Text>{""}</Text>
            <Text color="gray">(no description)</Text>
          </>
        )}

        {/* Comments section */}
        <Text>{""}</Text>
        <Text dimColor>--- Comments ---</Text>
        {commentsState === "loading" ? (
          <Text dimColor>fetching comments...</Text>
        ) : commentsState === "error" ? (
          <Text color="red">could not load comments</Text>
        ) : commentsState && commentsState.length === 0 ? (
          <Text dimColor>No comments yet.</Text>
        ) : commentsState && commentsState.length > 0 ? (
          <>
            {commentsState.slice(-5).map((comment, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list
              <Box key={i} flexDirection="column" marginBottom={1}>
                <Text color="cyan">
                  @{comment.author.login} · {formatCommentAge(comment.createdAt)}
                </Text>
                <Text wrap="wrap">  {comment.body.split("\n")[0]}</Text>
              </Box>
            ))}
          </>
        ) : (
          <Text dimColor>fetching comments...</Text>
        )}

        <Text>{""}</Text>
        <Text color="gray" dimColor>
          {issue.url}
        </Text>
      </Box>
    );
  }

  // TickTick task — task is guaranteed non-null here (early return above covers null case)
  const t = task as Task;
  return (
    <Box
      width={width}
      borderStyle="single"
      borderColor="yellow"
      flexDirection="column"
      paddingX={1}
    >
      <Text color="yellow" bold>
        {t.title}
      </Text>
      <Text>{""}</Text>

      <Box>
        <Text color="gray">Priority: </Text>
        <Text>{PRIORITY_LABELS[t.priority] ?? "None"}</Text>
      </Box>

      {t.dueDate ? (
        <Box>
          <Text color="gray">Due: </Text>
          <Text>{new Date(t.dueDate).toLocaleDateString()}</Text>
        </Box>
      ) : null}

      {(t.tags ?? []).length > 0 ? (
        <Box>
          <Text color="gray">Tags: </Text>
          <Text>{t.tags.join(", ")}</Text>
        </Box>
      ) : null}

      {t.content ? (
        <>
          <Text>{""}</Text>
          <Text>{truncateLines(t.content, 8)}</Text>
        </>
      ) : null}

      {(t.items ?? []).length > 0 ? (
        <>
          <Text>{""}</Text>
          <Text color="gray">Checklist:</Text>
          {t.items.slice(0, 5).map((item) => (
            <Text key={item.id}>
              {item.status === 2 ? "\u2611" : "\u2610"} {item.title}
            </Text>
          ))}
          {t.items.length > 5 ? <Text color="gray">...and {t.items.length - 5} more</Text> : null}
        </>
      ) : null}
    </Box>
  );
}

export { DetailPanel };
export type { DetailPanelProps };
