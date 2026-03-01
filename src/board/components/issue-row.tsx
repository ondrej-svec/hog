import { Box, Text } from "ink";
import type { GitHubIssue } from "../../github.js";

interface IssueRowProps {
  readonly issue: GitHubIssue;
  readonly selfLogin: string;
  readonly isSelected: boolean;
  /** Outer panel width (including border chars). Used to compute title column width. */
  readonly panelWidth: number;
  /** Short phase indicator (e.g. "plan", "impl") from enrichment sessions */
  readonly phaseIndicator?: string | undefined;
  /** Days the issue has been in its current status */
  readonly statusAgeDays?: number | undefined;
  /** Staleness thresholds (days) for color coding */
  readonly stalenessConfig?: { warningDays: number; criticalDays: number } | undefined;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

function formatDate(issue: GitHubIssue): { text: string; color: string } {
  if (issue.targetDate) {
    const d = new Date(issue.targetDate);
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
  const seconds = Math.floor((Date.now() - new Date(issue.updatedAt).getTime()) / 1000);
  if (seconds < 60) return { text: "now", color: "gray" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { text: `${minutes}m`, color: "gray" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { text: `${hours}h`, color: "gray" };
  const days = Math.floor(hours / 24);
  if (days < 30) return { text: `${days}d`, color: "gray" };
  const months = Math.floor(days / 30);
  return { text: `${months}mo`, color: "gray" };
}

const PLAIN_ABBREVS: Record<string, string> = {
  bug: "bug",
  feature: "feat",
  enhancement: "enh",
  documentation: "docs",
  "good first issue": "gfi",
  help: "help",
  question: "?",
  urgent: "urg!",
  wontfix: "wont",
  task: "task",
};

function compactLabel(name: string): string {
  const lc = name.toLowerCase();
  const colon = lc.indexOf(":");
  if (colon < 0) return PLAIN_ABBREVS[lc] ?? name.slice(0, 5);
  const key = lc.slice(0, colon);
  const val = name.slice(colon + 1);
  if (key === "size") return val.slice(0, 3).toUpperCase();
  if (key === "priority") return `p:${val.slice(0, 1).toUpperCase()}`;
  if (key === "work") return "WIP";
  return `${key.slice(0, 2)}:${val.slice(0, 2)}`;
}

function labelColor(name: string): string {
  const lc = name.toLowerCase();
  if (lc === "bug" || lc === "urgent" || lc.startsWith("priority:h") || lc.startsWith("priority:c"))
    return "red";
  if (lc.startsWith("priority:m") || lc.startsWith("work:")) return "yellow";
  if (lc.startsWith("priority:l") || lc === "wontfix") return "gray";
  if (lc.startsWith("size:")) return "white";
  if (lc === "feature" || lc === "enhancement") return "green";
  if (lc === "documentation") return "blue";
  if (lc === "good first issue") return "magenta";
  return "cyan";
}

/** Abbreviate phase name to 2-4 chars for compact display. */
const PHASE_ABBREVS: Record<string, string> = {
  research: "rs",
  brainstorm: "bs",
  plan: "pl",
  implement: "im",
  review: "rv",
  compound: "cp",
};

export function abbreviatePhase(phase: string): string {
  return PHASE_ABBREVS[phase] ?? phase.slice(0, 2);
}

/** Compute age color based on staleness thresholds. */
export function ageColor(
  days: number,
  config?: { warningDays: number; criticalDays: number },
): string | undefined {
  const warning = config?.warningDays ?? 7;
  const critical = config?.criticalDays ?? 14;
  if (days >= critical) return "red";
  if (days >= warning) return "yellow";
  return undefined;
}

// ── Fixed column widths ──────────────────────────────────────────────────────
//
//   ► #1234  <title…>              [sM] [p:H]  username      in 4d
//   2    7      titleW             13      1    10     1      10
//
// Phase indicator and age suffix are appended after the date column
// only when present, using variable width (not fixed).
//
const CURSOR_W = 2; // "► " or "  "
const NUM_W = 7; // "#xxxx  " (padEnd(5) + 1 space)
const LABEL_W = 13; // up to 2 compact labels: "[bug] [p:H]"
const ASSIGN_W = 10;
const DATE_W = 10; // "3d overdue" fits in 10
const FIXED_OVERHEAD = CURSOR_W + NUM_W + 1 + LABEL_W + 1 + ASSIGN_W + 1 + DATE_W;

function IssueRow({
  issue,
  selfLogin,
  isSelected,
  panelWidth,
  phaseIndicator,
  statusAgeDays,
  stalenessConfig,
}: IssueRowProps) {
  const assignees = issue.assignees ?? [];
  const isSelf = assignees.some((a) => a.login === selfLogin);
  const isUnassigned = assignees.length === 0;

  const assigneeColor = isSelf ? "green" : isUnassigned ? "gray" : "white";
  const assigneeText = isUnassigned
    ? "unassigned"
    : truncate(assignees.map((a) => a.login).join(", "), ASSIGN_W);

  const labels = (issue.labels ?? []).slice(0, 2);
  const date = formatDate(issue);

  // Dynamic title column: fill whatever space remains after fixed columns
  const innerW = panelWidth - 2;
  const titleW = Math.max(8, innerW - FIXED_OVERHEAD);
  const titleStr = truncate(issue.title, titleW).padEnd(titleW);
  const dateStr = date.text.padStart(DATE_W);

  // Age suffix — only shown when stale (above warning threshold)
  const ageColorVal =
    statusAgeDays != null ? ageColor(statusAgeDays, stalenessConfig) : undefined;

  return (
    <Box>
      {/* Cursor */}
      {isSelected ? (
        <Text color="cyan" bold>
          {"\u25B6 "}
        </Text>
      ) : (
        <Text>{"  "}</Text>
      )}

      {/* Issue number */}
      <Text color="cyan">#{String(issue.number).padEnd(5)}</Text>
      <Text> </Text>

      {/* Title — truncated to exact titleW so total row width is deterministic */}
      {isSelected ? (
        <Text bold color="white">
          {titleStr}
        </Text>
      ) : (
        <Text>{titleStr}</Text>
      )}
      <Text> </Text>

      {/* Labels — compact abbreviations in a fixed-width slot */}
      <Box width={LABEL_W} overflow="hidden">
        {labels.length === 0 ? (
          <Text color="gray">{" ".repeat(LABEL_W)}</Text>
        ) : (
          labels.map((l, i) => (
            <Text key={l.name}>
              {i > 0 ? " " : ""}
              <Text color={labelColor(l.name)}>[{compactLabel(l.name)}]</Text>
            </Text>
          ))
        )}
      </Box>
      <Text> </Text>

      {/* Assignee */}
      <Text color={assigneeColor}>{assigneeText.padEnd(ASSIGN_W)}</Text>
      <Text> </Text>

      {/* Date — target date takes priority over updatedAt */}
      <Text color={date.color}>{dateStr}</Text>

      {/* Phase indicator — appended after date, only when present */}
      {phaseIndicator ? (
        <Text color="magenta"> {abbreviatePhase(phaseIndicator)}</Text>
      ) : null}

      {/* Age suffix — only shown when stale (above warning threshold) */}
      {ageColorVal && statusAgeDays != null ? (
        <Text color={ageColorVal}>
          {" "}
          [{String(statusAgeDays)}d]
        </Text>
      ) : null}
    </Box>
  );
}

export { IssueRow };
export type { IssueRowProps };
