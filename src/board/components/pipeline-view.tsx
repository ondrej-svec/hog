/**
 * Pipeline View — the cockpit's main display.
 *
 * Lazygit-style panelled layout: bordered sections, overflow hidden,
 * activity feed fills remaining space, quality gates anchored at bottom.
 */

import { Box, Text } from "ink";
import type { Pipeline, PipelineStatus } from "../../engine/conductor.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";
import type { ActivityEntry, DaemonAgentInfo } from "../hooks/use-pipeline-data.js";
import { agentName, formatElapsed, humanizeTool, timeAgo } from "../humanize.js";
import { Panel } from "./panel.js";

// ── Types ──

export interface PipelineViewData {
  readonly pipelines: Pipeline[];
  readonly agents: readonly DaemonAgentInfo[];
  readonly pendingDecisions: Question[];
  readonly mergeQueue: readonly MergeQueueEntry[];
  readonly selectedIndex: number;
  readonly activityEntries?: readonly ActivityEntry[] | undefined;
}

interface PipelineViewProps {
  readonly data: PipelineViewData;
  readonly cols: number;
  readonly rows: number;
}

// ── Constants ──

const LEFT_PANEL_WIDTH = 26;

const PHASE_LABELS: Record<string, string> = {
  brainstorm: "brainstorm",
  stories: "stories",
  scaffold: "scaffold",
  test: "tests",
  impl: "impl",
  redteam: "redteam",
  merge: "merge",
};

/** Default phase order — used as fallback when pipeline doesn't specify its own. */
const DEFAULT_PHASE_ORDER = [
  "brainstorm",
  "stories",
  "scaffold",
  "test",
  "impl",
  "redteam",
  "merge",
] as const;

// ── Main Component ──

export function PipelineView({ data, cols, rows }: PipelineViewProps) {
  const { pipelines, agents, pendingDecisions, selectedIndex, activityEntries } = data;

  if (pipelines.length === 0) {
    return <EmptyState cols={cols} rows={rows} />;
  }

  const selectedPipeline = pipelines[selectedIndex];
  const showLeftPanel = pipelines.length > 1 && cols > 60;
  // Narrow viewport with multiple pipelines: show compact selector instead
  const showCompactSelector = pipelines.length > 1 && !showLeftPanel;
  const rightWidth = Math.max(40, showLeftPanel ? cols - LEFT_PANEL_WIDTH - 1 : cols);
  const detailRows = showCompactSelector ? rows - 1 : rows;

  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      {/* Compact pipeline selector for narrow viewports */}
      {showCompactSelector ? (
        <Box flexShrink={0} height={1}>
          <Text wrap="truncate">
            <Text dimColor> ◄ </Text>
            <Text bold>{selectedIndex + 1}</Text>
            <Text dimColor>/{pipelines.length} </Text>
            <Text>{selectedPipeline?.title ?? ""}</Text>
            <Text dimColor> ► j/k:nav</Text>
          </Text>
        </Box>
      ) : null}

      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {showLeftPanel ? (
          <Box flexDirection="column" width={LEFT_PANEL_WIDTH} flexShrink={0}>
            <Panel title="Pipelines" isActive={false} width={LEFT_PANEL_WIDTH} flexGrow={1}>
              <PipelineList pipelines={pipelines} selectedIndex={selectedIndex} rows={detailRows} />
            </Panel>
          </Box>
        ) : null}

        {selectedPipeline ? (
          <PipelineDetail
            pipeline={selectedPipeline}
            agents={agents}
            pendingDecisions={pendingDecisions}
            activityEntries={activityEntries}
            width={showLeftPanel ? rightWidth : cols}
            rows={detailRows}
          />
        ) : null}
      </Box>
    </Box>
  );
}

// ── Pipeline List (viewport-windowed) ──

function PipelineList({
  pipelines,
  selectedIndex,
  rows,
}: {
  pipelines: Pipeline[];
  selectedIndex: number;
  rows: number;
}) {
  // Each item is 2 lines. Panel borders take ~3 lines.
  const linesPerItem = 2;
  const availableLines = Math.max(2, rows - 3);
  const maxVisible = Math.floor(availableLines / linesPerItem);

  // Window the list to keep selectedIndex visible
  let startIdx = 0;
  if (pipelines.length > maxVisible) {
    // Center the selection in the viewport, clamped to bounds
    startIdx = Math.min(
      Math.max(0, selectedIndex - Math.floor(maxVisible / 2)),
      pipelines.length - maxVisible,
    );
  }
  const endIdx = Math.min(startIdx + maxVisible, pipelines.length);
  const visiblePipelines = pipelines.slice(startIdx, endIdx);

  const hasMore = endIdx < pipelines.length;
  const hasLess = startIdx > 0;

  return (
    <Box flexDirection="column">
      {hasLess ? <Text dimColor> ↑ {startIdx} more</Text> : null}
      {visiblePipelines.map((p, vi) => (
        <PipelineListItem
          key={p.featureId}
          pipeline={p}
          selected={startIdx + vi === selectedIndex}
        />
      ))}
      {hasMore ? <Text dimColor> ↓ {pipelines.length - endIdx} more</Text> : null}
    </Box>
  );
}

// ── Pipeline List Item ──

function PipelineListItem({ pipeline, selected }: { pipeline: Pipeline; selected: boolean }) {
  const completed = pipeline.completedBeads ?? 0;
  const pct = Math.round((completed / 6) * 100);
  const phase = pipeline.activePhase ?? "";
  const barWidth = 10;
  const filled = Math.round((completed / 6) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  const title = pipeline.title.length > 18 ? `${pipeline.title.slice(0, 16)}..` : pipeline.title;

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        {selected ? (
          <Text color="cyan" bold>
            ► {title}
          </Text>
        ) : (
          <Text> {title}</Text>
        )}
      </Text>
      <Text dimColor wrap="truncate">
        {" "}
        {bar} {pct}% {phase}
      </Text>
    </Box>
  );
}

// ── Pipeline Detail ──

function PipelineDetail({
  pipeline,
  agents,
  pendingDecisions,
  activityEntries,
  width,
  rows,
}: {
  pipeline: Pipeline;
  agents: readonly DaemonAgentInfo[];
  pendingDecisions: Question[];
  activityEntries?: readonly ActivityEntry[] | undefined;
  width: number;
  rows: number;
}) {
  const pipelineAgents = agents.filter(
    (a) =>
      a.featureId === pipeline.featureId ||
      (!a.featureId && a.isRunning && a.repo === pipeline.repo),
  );
  const activeAgents = pipelineAgents.filter((a) => a.isRunning);
  const activeAgent = activeAgents[0];
  const pipelineDecisions = pendingDecisions.filter((q) => q.featureId === pipeline.featureId);

  // Decision panel takes priority when blocked
  if (pipelineDecisions.length > 0) {
    return (
      <Box flexDirection="column" width={width} height={rows} overflow="hidden">
        <Panel title={pipeline.title} isActive={true} width={width} flexGrow={1}>
          <PhaseBar pipeline={pipeline} width={width - 4} />
          <Text> </Text>
          <DecisionPanel decisions={pipelineDecisions} />
        </Panel>
        <QualityGatesRow pipeline={pipeline} />
      </Box>
    );
  }

  // Count fixed rows: status panel ~8 lines, gates 1 line — rest goes to activity
  const completedCount = pipeline.completedBeads ?? 0;
  // Status panel height: title border(2) + phase(1) + spacer(1) + agent(2) + completed(completedCount+1) + border(1)
  const statusHeight = Math.min(rows - 6, 4 + 2 + (completedCount > 0 ? completedCount + 1 : 0));

  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      {/* Status panel — fixed height */}
      <Panel title={pipeline.title} isActive={true} width={width} height={statusHeight}>
        <PhaseBar pipeline={pipeline} width={width - 4} />
        <Text> </Text>
        <StatusSection
          pipeline={pipeline}
          activeAgent={activeAgent}
          pipelineAgents={pipelineAgents}
        />
        <CompletedPhases pipeline={pipeline} agents={pipelineAgents} />
      </Panel>

      {/* Activity panel — fills remaining space */}
      <Panel title="Activity" isActive={false} width={width} flexGrow={1}>
        {activityEntries && activityEntries.length > 0 ? (
          <ActivityFeed entries={activityEntries} />
        ) : (
          <Text dimColor>No activity yet</Text>
        )}
      </Panel>

      {/* Quality gates — anchored at bottom */}
      <QualityGatesRow pipeline={pipeline} />
    </Box>
  );
}

// ── Status Section (agent card or status message) ──

function StatusSection({
  pipeline,
  activeAgent,
  pipelineAgents,
}: {
  pipeline: Pipeline;
  activeAgent: DaemonAgentInfo | undefined;
  pipelineAgents: readonly DaemonAgentInfo[];
}) {
  if (activeAgent) {
    return <ActiveAgentCard agent={activeAgent} />;
  }

  if (pipeline.status === "running") {
    return (
      <Text dimColor wrap="truncate">
        {pipeline.activePhase === "brainstorm"
          ? "Brainstorm session should be open — press Z to reopen if needed"
          : "No active agents — daemon will advance to next phase"}
      </Text>
    );
  }

  if (pipeline.status === "completed") {
    return <CompletionSummary pipeline={pipeline} agents={pipelineAgents} />;
  }

  if (pipeline.status === "paused") {
    return <Text color="yellow">⏸ Pipeline paused — press x to resume</Text>;
  }

  if (pipeline.status === "blocked") {
    return <Text color="red">⚠ Pipeline blocked — waiting for resolution</Text>;
  }

  if (pipeline.status === "failed") {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>
          ✗ Pipeline failed
        </Text>
        <Text dimColor> Check the activity log for details</Text>
      </Box>
    );
  }

  return null;
}

// ── Phase Bar ──

function PhaseBar({ pipeline, width }: { pipeline: Pipeline; width?: number }) {
  const completed = pipeline.completedBeads ?? 0;
  // Use compact connectors to fit terminal width
  const connector = width && width < 80 ? "→" : " → ";

  return (
    <Box>
      {DEFAULT_PHASE_ORDER.map((phase, i) => {
        const label = PHASE_LABELS[phase] ?? phase;
        const beadKey = phase === "test" ? "tests" : phase;
        const isCompleted = i < completed;
        const isActive =
          phase === pipeline.activePhase || (phase === "test" && pipeline.activePhase === "test");

        const sep = i < DEFAULT_PHASE_ORDER.length - 1 ? connector : "";

        if (isCompleted) {
          return (
            <Text key={beadKey}>
              <Text color="green">{label} ✓</Text>
              <Text dimColor>{sep}</Text>
            </Text>
          );
        }
        if (isActive) {
          return (
            <Text key={beadKey}>
              <Text color="yellow" bold>
                {label} ◐
              </Text>
              <Text dimColor>{sep}</Text>
            </Text>
          );
        }
        return (
          <Text key={beadKey}>
            <Text dimColor>{label} ·</Text>
            <Text dimColor>{sep}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

// ── Active Agent Card ──

function ActiveAgentCard({ agent }: { agent: DaemonAgentInfo }) {
  const name = agentName(agent.sessionId);
  const elapsed = formatElapsed(agent.startedAt);
  const activity = humanizeTool(agent.lastToolUse);
  const ROLE_LABELS: Record<string, string> = {
    brainstorm: "Brainstorm",
    stories: "Architect",
    scaffold: "Scaffolder",
    test: "Test Writer",
    impl: "Implementer",
    redteam: "Red Team",
    merge: "Merge Gatekeeper",
  };
  const phaseLabel = ROLE_LABELS[agent.phase] ?? agent.phase;

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="cyan" bold>
          ◐ {name}
        </Text>
        <Text> is </Text>
        <Text bold>{activity}</Text>
        <Text dimColor> {elapsed}</Text>
      </Text>
      <Text dimColor> {phaseLabel} phase</Text>
    </Box>
  );
}

// ── Completed Phases ──

function CompletedPhases({
  pipeline,
  agents,
}: {
  pipeline: Pipeline;
  agents: readonly DaemonAgentInfo[];
}) {
  const completed = pipeline.completedBeads ?? 0;
  if (completed === 0) return null;

  const completedPhases = DEFAULT_PHASE_ORDER.slice(0, completed);

  return (
    <Box flexDirection="column">
      {completedPhases.map((phase) => {
        const label = PHASE_LABELS[phase] ?? phase;
        const phaseAgents = agents.filter((a) => a.phase === phase);
        const agentCount = phaseAgents.length;
        const names = phaseAgents.map((a) => agentName(a.sessionId)).join(", ");
        const elapsed = phaseAgents[0] ? formatElapsed(phaseAgents[0].startedAt) : "";

        const summary = pipeline.context?.phaseSummaries?.[phase];
        const shortSummary = summary
          ? summary.split("\n")[0]?.slice(0, 50)
          : agentCount > 1
            ? `${agentCount} agents (${names})`
            : "";

        return (
          <Text key={phase} wrap="truncate">
            <Text color="green">✓ </Text>
            <Text>{label.padEnd(12)}</Text>
            <Text dimColor>{shortSummary}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

// ── Activity Feed ──

/** Icon and color for each activity type. */
const ACTIVITY_STYLE: Record<
  string,
  { icon: string; color?: string }
> = {
  "phase-start": { icon: "▶", color: "yellow" },
  "phase-complete": { icon: "✓", color: "green" },
  "agent-spawn": { icon: "●", color: "cyan" },
  "agent-progress": { icon: " " },
  "agent-complete": { icon: "✓", color: "green" },
  "agent-fail": { icon: "✗", color: "red" },
};

function ActivityFeed({
  entries,
}: {
  entries: readonly ActivityEntry[];
}) {
  // Deduplicate rapid agent:progress events — keep last per agent within 2s windows
  const deduplicated = deduplicateProgress(entries);
  const maxVisible = 30;
  const visible = deduplicated.slice(-maxVisible);
  const olderCount = deduplicated.length - visible.length;

  if (visible.length === 0) return <Text dimColor>No activity yet</Text>;

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
      {olderCount > 0 ? (
        <Text dimColor>  ↑ {olderCount} older entries (press l for full log)</Text>
      ) : null}
      {visible.map((entry, i) => {
        const ts = formatTime(entry.timestamp);
        const style = ACTIVITY_STYLE[entry.type] ?? { icon: "·" };
        const name = entry.agentSessionId ? agentName(entry.agentSessionId) : undefined;
        const detail = formatActivityDetail(entry, name);

        return (
          <Text key={`${i}`} wrap="truncate">
            <Text dimColor>{ts} </Text>
            {style.color ? (
              <Text color={style.color}>{style.icon} </Text>
            ) : (
              <Text dimColor>{style.icon} </Text>
            )}
            {name && entry.type === "agent-progress" ? (
              <Text>
                <Text color="cyan">{name}</Text>
                <Text> {detail}</Text>
              </Text>
            ) : (
              <Text>{detail}</Text>
            )}
          </Text>
        );
      })}
    </Box>
  );
}

/** Collapse rapid agent:progress events — keep only the latest per agent within 2s windows. */
function deduplicateProgress(entries: readonly ActivityEntry[]): ActivityEntry[] {
  const result: ActivityEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.type !== "agent-progress") {
      result.push(entry);
      continue;
    }
    // Look ahead: if the next entry is also progress from the same agent within 2s, skip this one
    const next = entries[i + 1];
    if (
      next?.type === "agent-progress" &&
      next.agentSessionId === entry.agentSessionId
    ) {
      const gap = new Date(next.timestamp).getTime() - new Date(entry.timestamp).getTime();
      if (gap < 2000) continue; // skip — next one is more recent
    }
    result.push(entry);
  }
  return result;
}

/** Humanize an activity entry's detail for display. */
function formatActivityDetail(entry: ActivityEntry, name: string | undefined): string {
  switch (entry.type) {
    case "phase-start":
      return `${capitalize(entry.phase ?? "Phase")} started`;
    case "phase-complete":
      return `${capitalize(entry.phase ?? "Phase")} complete`;
    case "agent-spawn":
      return name
        ? `${name} joined — ${capitalize(entry.phase ?? "unknown")} phase`
        : `Agent spawned for ${entry.phase ?? "unknown"}`;
    case "agent-progress":
      return humanizeTool(entry.detail);
    case "agent-complete": {
      // Clean markdown from summaries
      const clean = entry.detail
        .replace(/\*\*/g, "")
        .replace(/^#+\s*/gm, "")
        .split("\n")[0]
        ?.slice(0, 80) ?? "";
      return name ? `${name} finished — ${clean}` : clean;
    }
    case "agent-fail":
      return name ? `${name} failed — ${entry.detail.slice(0, 60)}` : entry.detail.slice(0, 60);
    default:
      return entry.detail;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso.slice(11, 16);
  }
}

// ── Quality Gates Row ──

function QualityGatesRow({ pipeline }: { pipeline: Pipeline }) {
  const completed = pipeline.completedBeads ?? 0;
  const implDone = completed >= 4;
  const redteamDone = completed >= 5;
  const mergeDone = completed >= 6;

  const gates = [
    { name: "lint", done: implDone },
    { name: "typecheck", done: implDone },
    { name: "security", done: redteamDone },
    { name: "mutation", done: redteamDone },
    { name: "suite", done: mergeDone },
  ];

  return (
    <Box flexShrink={0} height={1}>
      <Text dimColor> gates: </Text>
      {gates.map((gate) =>
        gate.done ? (
          <Text key={gate.name} color="green">
            ✓ {gate.name}{" "}
          </Text>
        ) : (
          <Text key={gate.name} dimColor>
            ○ {gate.name}{" "}
          </Text>
        ),
      )}
    </Box>
  );
}

// ── Decision Panel ──

function DecisionPanel({ decisions }: { decisions: Question[] }) {
  const decision = decisions[0];
  if (!decision) return null;

  return (
    <Box flexDirection="column">
      <Text color="red" bold>
        ⚠ DECISION NEEDED
      </Text>
      <Text> </Text>
      <Text>{decision.question}</Text>
      <Text> </Text>
      {(decision.options ?? []).map((option, i) => (
        <Box key={option}>
          <Text color="cyan" bold>
            [{i + 1}]
          </Text>
          <Text> {option}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor>Press 1-{(decision.options ?? []).length} to choose</Text>
    </Box>
  );
}

// ── Completion Summary ──

function CompletionSummary({
  pipeline,
  agents,
}: {
  pipeline: Pipeline;
  agents: readonly DaemonAgentInfo[];
}) {
  const elapsed = pipeline.completedAt
    ? (() => {
        const ms =
          new Date(pipeline.completedAt).getTime() - new Date(pipeline.startedAt).getTime();
        const mins = Math.floor(ms / 60_000);
        if (mins < 60) return `${mins}m`;
        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
      })()
    : formatElapsed(pipeline.startedAt);

  return (
    <Box flexDirection="column">
      <Text color="green" bold>
        ✓ Pipeline complete
      </Text>
      <Text dimColor>
        {" "}
        {elapsed} total · {agents.length} agents used
      </Text>
    </Box>
  );
}

// ── Empty State ──

function EmptyState({ cols, rows }: { cols: number; rows: number }) {
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width={cols}
      height={rows}
    >
      <Text bold>What do you want to build?</Text>
      <Text> </Text>
      <Text>
        Press{" "}
        <Text color="cyan" bold>
          P
        </Text>{" "}
        to start a new pipeline
      </Text>
      <Text> </Text>
      <Text dimColor>brainstorm → stories → scaffold → tests → implement → red team → merge</Text>
    </Box>
  );
}
