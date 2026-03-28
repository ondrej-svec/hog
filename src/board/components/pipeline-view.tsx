/**
 * Pipeline View — the cockpit's main display.
 *
 * Design A with personality: spacious layout, agent names, humanized tools,
 * narrative activity feed, quality gates row.
 */

import { Box, Text } from "ink";
import type { DaemonAgentInfo } from "../hooks/use-pipeline-data.js";
import type { Pipeline, PipelineStatus } from "../../engine/conductor.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";
import { agentName, formatElapsed, humanizeTool, timeAgo } from "../humanize.js";

// ── Types ──

export interface PipelineViewData {
  readonly pipelines: Pipeline[];
  readonly agents: readonly DaemonAgentInfo[];
  readonly pendingDecisions: Question[];
  readonly mergeQueue: readonly MergeQueueEntry[];
  readonly selectedIndex: number;
  readonly logEntries?: readonly string[] | undefined;
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
  test: "tests",
  impl: "impl",
  redteam: "redteam",
  merge: "merge",
};

const PHASE_ORDER = ["brainstorm", "stories", "test", "impl", "redteam", "merge"] as const;

// ── Main Component ──

export function PipelineView({ data, cols, rows }: PipelineViewProps) {
  const { pipelines, agents, pendingDecisions, selectedIndex, logEntries } = data;

  if (pipelines.length === 0) {
    return <EmptyState cols={cols} rows={rows} />;
  }

  const selectedPipeline = pipelines[selectedIndex];
  const showLeftPanel = pipelines.length > 1 && cols > 60;
  const rightWidth = Math.max(40, showLeftPanel ? cols - LEFT_PANEL_WIDTH - 3 : cols);

  return (
    <Box flexDirection="row" height={rows}>
      {showLeftPanel ? (
        <Box flexDirection="column" width={LEFT_PANEL_WIDTH} borderStyle="single" borderRight>
          <Text bold> Pipelines</Text>
          <Text> </Text>
          {pipelines.map((p, i) => (
            <PipelineListItem key={p.featureId} pipeline={p} selected={i === selectedIndex} />
          ))}
        </Box>
      ) : null}

      {selectedPipeline ? (
        <PipelineDetail
          pipeline={selectedPipeline}
          agents={agents}
          pendingDecisions={pendingDecisions}
          logEntries={logEntries}
          width={rightWidth}
          rows={rows}
        />
      ) : null}
    </Box>
  );
}

// ── Pipeline List Item ──

function PipelineListItem({
  pipeline,
  selected,
}: {
  pipeline: Pipeline;
  selected: boolean;
}) {
  const completed = pipeline.completedBeads ?? 0;
  const pct = Math.round((completed / 6) * 100);
  const phase = pipeline.activePhase ?? "";
  const barWidth = 12;
  const filled = Math.round((completed / 6) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box>
        {selected ? (
          <Text color="cyan" bold>
            {"► "}
            {pipeline.title.length > 20 ? `${pipeline.title.slice(0, 18)}..` : pipeline.title}
          </Text>
        ) : (
          <Text>
            {"  "}
            {pipeline.title.length > 20 ? `${pipeline.title.slice(0, 18)}..` : pipeline.title}
          </Text>
        )}
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>
          {bar} {pct}% {phase}
        </Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}

// ── Pipeline Detail ──

function PipelineDetail({
  pipeline,
  agents,
  pendingDecisions,
  logEntries,
  width,
  rows,
}: {
  pipeline: Pipeline;
  agents: readonly DaemonAgentInfo[];
  pendingDecisions: Question[];
  logEntries?: readonly string[] | undefined;
  width: number;
  rows: number;
}) {
  const pipelineAgents = agents.filter(
    (a) => a.featureId === pipeline.featureId || (!a.featureId && a.repo === pipeline.repo),
  );
  const activeAgents = pipelineAgents.filter((a) => a.isRunning);
  const activeAgent = activeAgents[0];
  const pipelineDecisions = pendingDecisions.filter(
    (q) => q.featureId === pipeline.featureId,
  );

  return (
    <Box flexDirection="column" paddingLeft={1} width={width}>
      {/* Title */}
      <Text bold>{pipeline.title}</Text>
      <Text> </Text>

      {/* Phase DAG */}
      <PhaseBar pipeline={pipeline} />
      <Text> </Text>

      {/* Decision panel (takes priority when blocked) */}
      {pipelineDecisions.length > 0 ? (
        <DecisionPanel decisions={pipelineDecisions} />
      ) : (
        <>
          {/* Active Agent Spotlight */}
          {activeAgent ? (
            <ActiveAgentCard agent={activeAgent} />
          ) : pipeline.status === "running" ? (
            <Text dimColor>  No active agents — daemon will advance to next phase</Text>
          ) : pipeline.status === "completed" ? (
            <CompletionSummary pipeline={pipeline} agents={pipelineAgents} />
          ) : pipeline.status === "paused" ? (
            <Text color="yellow">  ⏸ Pipeline paused — press x to resume</Text>
          ) : pipeline.status === "blocked" ? (
            <Text color="red">  ⚠ Pipeline blocked — waiting for resolution</Text>
          ) : pipeline.status === "failed" ? (
            <Box flexDirection="column" paddingLeft={2}>
              <Text color="red" bold>✗ Pipeline failed</Text>
              <Text dimColor>  Check the activity log for details</Text>
            </Box>
          ) : null}

          <Text> </Text>

          {/* Completed Phases */}
          <CompletedPhases pipeline={pipeline} agents={pipelineAgents} />

          <Text> </Text>

          {/* Activity Feed */}
          {logEntries && logEntries.length > 0 ? (
            <ActivityFeed entries={logEntries} />
          ) : null}

          <Text> </Text>

          {/* Quality Gates (compact row) */}
          <QualityGatesRow pipeline={pipeline} />
        </>
      )}
    </Box>
  );
}

// ── Phase Bar ──

function PhaseBar({ pipeline }: { pipeline: Pipeline }) {
  const completed = pipeline.completedBeads ?? 0;

  return (
    <Box>
      <Text>  </Text>
      {PHASE_ORDER.map((phase, i) => {
        const label = PHASE_LABELS[phase] ?? phase;
        const beadKey = phase === "test" ? "tests" : phase;
        const isCompleted = i < completed;
        const isActive =
          phase === pipeline.activePhase ||
          (phase === "test" && pipeline.activePhase === "test");

        const connector = i < PHASE_ORDER.length - 1 ? " ── " : "";

        if (isCompleted) {
          return (
            <Text key={beadKey}>
              <Text color="green">{label} ✓</Text>
              <Text dimColor>{connector}</Text>
            </Text>
          );
        }
        if (isActive) {
          return (
            <Text key={beadKey}>
              <Text color="yellow" bold>{label} ◐</Text>
              <Text dimColor>{connector}</Text>
            </Text>
          );
        }
        return (
          <Text key={beadKey}>
            <Text dimColor>{label} ·</Text>
            <Text dimColor>{connector}</Text>
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
  const phaseLabel =
    agent.phase === "impl"
      ? "Implementer"
      : agent.phase === "test"
        ? "Test Writer"
        : agent.phase === "redteam"
          ? "Red Team"
          : agent.phase === "merge"
            ? "Merge Gatekeeper"
            : agent.phase;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box>
        <Text color="cyan" bold>
          ◐ {name}
        </Text>
        <Text> is </Text>
        <Text bold>{activity}</Text>
        <Text dimColor>  {elapsed}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>
          {phaseLabel} phase
        </Text>
      </Box>
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

  const completedPhases = PHASE_ORDER.slice(0, completed);

  return (
    <Box flexDirection="column">
      <Text dimColor>  ── Completed ──</Text>
      {completedPhases.map((phase) => {
        const label = PHASE_LABELS[phase] ?? phase;
        const phaseAgents = agents.filter((a) => a.phase === phase);
        const agentCount = phaseAgents.length;
        const names = phaseAgents.map((a) => agentName(a.sessionId)).join(", ");
        const elapsed = phaseAgents[0] ? formatElapsed(phaseAgents[0].startedAt) : "";

        // Get summary from pipeline context
        const summary = pipeline.context?.phaseSummaries?.[phase];
        const shortSummary = summary
          ? summary.split("\n")[0]?.slice(0, 60)
          : agentCount > 1
            ? `${agentCount} agents (${names})`
            : "";

        return (
          <Box key={phase} paddingLeft={2}>
            <Text color="green">✓ </Text>
            <Text>{label.padEnd(12)}</Text>
            <Text dimColor>
              {elapsed ? `${elapsed.padEnd(6)}` : "      "}
              {shortSummary}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Activity Feed ──

function ActivityFeed({ entries }: { entries: readonly string[] }) {
  // Filter to meaningful events only
  const meaningful = entries
    .filter((e) => {
      // Skip internal conductor noise
      if (e.includes("preparing:")) return false;
      if (e.includes("beads-reconciled")) return false;
      if (e.includes("baseline-captured")) return false;
      if (e.includes("bead-unstuck")) return false;
      if (e.includes("context:test-captured")) return false;
      return true;
    })
    .slice(-7);

  if (meaningful.length === 0) return null;

  return (
    <Box flexDirection="column">
      <Text dimColor>  ── Activity ──</Text>
      {meaningful.map((entry, i) => {
        // Parse "[ISO] action:sub:detail: message" format
        // Split on ": " (colon-space) to separate action from message, not first ":"
        const tsMatch = entry.match(/^\[([^\]]+)\]\s+(.*)/);
        const ts = tsMatch?.[1] ? formatTime(tsMatch[1]) : "";
        const rest = tsMatch?.[2] ?? entry;
        // Find the action (everything before first ": " that contains a letter)
        const colonSpaceIdx = rest.indexOf(": ");
        const action = colonSpaceIdx > 0 ? rest.slice(0, colonSpaceIdx) : "";
        const detail = colonSpaceIdx > 0 ? rest.slice(colonSpaceIdx + 2) : rest;

        // Humanize the detail
        const humanDetail = humanizeLogEntry(detail);

        // Skip entries that are purely internal
        if (!humanDetail || humanDetail.length < 3) return null;

        return (
          <Box key={`${i}`} paddingLeft={2}>
            <Text dimColor>{ts ? `${ts}  ` : "      "}</Text>
            <Text>{humanDetail}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso.slice(11, 16);
  }
}

function humanizeLogEntry(detail: string): string {
  // Clean up common patterns
  return (
    detail
      // Remove session IDs
      .replace(/\(session:\s*[\w-]+\)/g, "")
      // Remove bead IDs
      .replace(/for bead \S+/g, "")
      // Remove "Spawned X agent" → "X started"
      .replace(/Spawned (\w[\w ]+) agent\s*/g, "$1 started")
      // Trim whitespace
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

// ── Quality Gates Row ──

function QualityGatesRow({ pipeline }: { pipeline: Pipeline }) {
  const completed = pipeline.completedBeads ?? 0;
  const implDone = completed >= 4;
  const redteamDone = completed >= 5;
  const mergeDone = completed >= 6;

  const gates = [
    { name: "lint", done: implDone, after: "impl" },
    { name: "typecheck", done: implDone, after: "impl" },
    { name: "security", done: redteamDone, after: "redteam" },
    { name: "mutation", done: redteamDone, after: "redteam" },
    { name: "suite", done: mergeDone, after: "merge" },
  ];

  return (
    <Box paddingLeft={2}>
      <Text dimColor>  gates: </Text>
      {gates.map((gate) =>
        gate.done ? (
          <Text key={gate.name}>
            <Text color="green">✓ {gate.name} </Text>
          </Text>
        ) : (
          <Text key={gate.name}>
            <Text dimColor>○ {gate.name} </Text>
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
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
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
        const ms = new Date(pipeline.completedAt).getTime() - new Date(pipeline.startedAt).getTime();
        const mins = Math.floor(ms / 60_000);
        if (mins < 60) return `${mins}m`;
        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
      })()
    : formatElapsed(pipeline.startedAt);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color="green" bold>
        ✓ Pipeline complete
      </Text>
      <Text dimColor>  {elapsed} total · {agents.length} agents used</Text>
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
        Press <Text color="cyan" bold>P</Text> to start a new pipeline
      </Text>
      <Text> </Text>
      <Text dimColor>
        Describe a feature and hog will:
      </Text>
      <Text dimColor>
        brainstorm → write stories → write tests → implement → red team → merge
      </Text>
    </Box>
  );
}
