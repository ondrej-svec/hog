import { Box, Text } from "ink";
import type { TrackedAgent } from "../../engine/agent-manager.js";
import type { Pipeline, PipelineStatus } from "../../engine/conductor.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";

// ── Types ──

export interface PipelineViewData {
  readonly pipelines: Pipeline[];
  readonly agents: readonly TrackedAgent[];
  readonly pendingDecisions: Question[];
  readonly mergeQueue: readonly MergeQueueEntry[];
  readonly selectedIndex: number;
}

interface PipelineViewProps {
  readonly data: PipelineViewData;
  readonly cols: number;
  readonly rows: number;
}

// ── Status Icons ──

function statusIcon(status: PipelineStatus): string {
  switch (status) {
    case "running":
      return "◐";
    case "paused":
      return "⏸";
    case "blocked":
      return "⚠";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
  }
}

function statusColor(status: PipelineStatus): string {
  switch (status) {
    case "running":
      return "yellow";
    case "paused":
      return "gray";
    case "blocked":
      return "red";
    case "completed":
      return "green";
    case "failed":
      return "red";
  }
}

function progressBar(pipeline: Pipeline, width: number): string {
  const beadIds = Object.values(pipeline.beadIds);
  const total = beadIds.length;
  // For now, estimate progress from status
  let completed = 0;
  if (pipeline.status === "completed") completed = total;
  else if (pipeline.status === "running") completed = Math.floor(total * 0.4); // placeholder
  const filled = Math.round((completed / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ── Pipeline List Item ──

function PipelineListItem({
  pipeline,
  selected,
  width,
}: {
  pipeline: Pipeline;
  selected: boolean;
  width: number;
}) {
  const icon = statusIcon(pipeline.status);
  const color = statusColor(pipeline.status);
  const barWidth = Math.max(8, Math.min(20, width - 40));
  const bar = progressBar(pipeline, barWidth);
  const title =
    pipeline.title.length > width - 35
      ? `${pipeline.title.slice(0, width - 38)}...`
      : pipeline.title;

  return (
    <Box>
      {selected ? (
        <Text color="cyan" bold>
          {"▶ "}
        </Text>
      ) : (
        <Text>{"  "}</Text>
      )}
      <Text color={color}>{icon} </Text>
      {selected ? <Text bold>{title}</Text> : <Text>{title}</Text>}
      <Text> </Text>
      <Text color="yellow">{bar}</Text>
    </Box>
  );
}

// ── Agent List Item ──

function AgentListItem({ agent }: { agent: TrackedAgent }) {
  const elapsed = Math.floor((Date.now() - new Date(agent.startedAt).getTime()) / 60_000);
  const activity = agent.monitor.lastToolUse
    ? `using ${agent.monitor.lastToolUse}`
    : agent.monitor.isRunning
      ? "running"
      : "done";

  return (
    <Box>
      <Text color={agent.monitor.isRunning ? "yellow" : "green"}>
        {agent.monitor.isRunning ? "  ◐ " : "  ✓ "}
      </Text>
      <Text>{agent.phase.padEnd(8)}</Text>
      <Text dimColor> {activity}</Text>
      <Text dimColor> {elapsed}m</Text>
    </Box>
  );
}

// ── Decision Panel ──

function DecisionPanel({ question }: { question: Question }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="red" bold>
          ⚠ DECISION NEEDED
        </Text>
      </Box>
      <Box>
        <Text dimColor>Pipeline: </Text>
        <Text>{question.featureId}</Text>
      </Box>
      <Box marginTop={1}>
        <Text bold>{question.question}</Text>
      </Box>
      {question.options ? (
        <Box flexDirection="column" marginTop={1}>
          {question.options.map((opt, i) => (
            <Box key={opt}>
              <Text color="cyan" bold>
                [{i + 1}]{" "}
              </Text>
              <Text>{opt}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>Press number to answer, or D for custom response</Text>
      </Box>
    </Box>
  );
}

// ── All Clear Panel ──

function AllClearPanel() {
  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center" paddingY={2}>
      <Text color="green" bold>
        ✓ All pipelines running. Nothing needs your attention.
      </Text>
      <Box marginTop={1}>
        <Text dimColor>Go do deep work. Hog will toast when it needs you.</Text>
      </Box>
    </Box>
  );
}

// ── Empty State ──

function EmptyState() {
  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center" paddingY={3}>
      <Text bold>What do you want to build?</Text>
      <Box marginTop={1}>
        <Text dimColor>Press </Text>
        <Text color="cyan" bold>
          P
        </Text>
        <Text dimColor> to start a pipeline, or </Text>
        <Text color="cyan" bold>
          i
        </Text>
        <Text dimColor> to browse issues</Text>
      </Box>
    </Box>
  );
}

// ── Pipeline Detail Panel ──

function PipelineDetailPanel({ pipeline }: { pipeline: Pipeline }) {
  const phases = ["stories", "tests", "impl", "redteam", "merge"] as const;
  const beadEntries = Object.entries(pipeline.beadIds);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>{pipeline.title}</Text>
      </Box>

      {/* DAG visualization */}
      <Box>
        {phases.map((phase, i) => {
          const beadId = beadEntries.find(([key]) => key === phase)?.[1];
          const icon = beadId ? "○" : "?";
          return (
            <Text key={phase}>
              <Text dimColor>{phase} </Text>
              <Text color="gray">{icon}</Text>
              {i < phases.length - 1 ? <Text dimColor> ──→ </Text> : null}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Status: </Text>
        <Text color={statusColor(pipeline.status)}>{pipeline.status}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Started: {pipeline.startedAt}</Text>
        {pipeline.completedAt ? <Text dimColor>Completed: {pipeline.completedAt}</Text> : null}
      </Box>
    </Box>
  );
}

// ── Merge Queue Section ──

function MergeQueueSection({ entries }: { entries: readonly MergeQueueEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>── Merge Queue ({entries.length}) ──</Text>
      {entries.slice(0, 3).map((entry) => (
        <Box key={entry.id}>
          <Text color={entry.status === "merged" ? "green" : "yellow"}>
            {"  "}
            {entry.status === "pending" ? "○" : "◐"}{" "}
          </Text>
          <Text dimColor>{entry.status.padEnd(10)}</Text>
          <Text>{entry.branch}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Main Pipeline View ──

export function PipelineView({ data, cols, rows }: PipelineViewProps) {
  const { pipelines, agents, pendingDecisions, mergeQueue, selectedIndex } = data;
  const isWide = cols >= 140;
  const listWidth = isWide ? Math.min(40, Math.floor(cols * 0.35)) : cols - 2;
  const detailWidth = isWide ? cols - listWidth - 4 : 0;

  // If no pipelines, show empty state
  if (pipelines.length === 0) {
    return (
      <Box flexDirection="column" height={rows}>
        <EmptyState />
      </Box>
    );
  }

  const selectedPipeline = pipelines[selectedIndex];

  // Determine what the focus panel shows
  const focusContent =
    pendingDecisions.length > 0 ? (
      <DecisionPanel question={pendingDecisions[0]!} />
    ) : selectedPipeline ? (
      <PipelineDetailPanel pipeline={selectedPipeline} />
    ) : (
      <AllClearPanel />
    );

  // Narrow layout: list only
  if (!isWide) {
    return (
      <Box flexDirection="column" height={rows} overflow="hidden">
        <Box flexDirection="column" flexGrow={1}>
          {pipelines.map((p, i) => (
            <PipelineListItem
              key={p.featureId}
              pipeline={p}
              selected={i === selectedIndex}
              width={listWidth}
            />
          ))}

          {agents.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>── Agents ({agents.length}) ──</Text>
              {agents.slice(0, 5).map((a) => (
                <AgentListItem key={a.sessionId} agent={a} />
              ))}
            </Box>
          ) : null}

          <MergeQueueSection entries={mergeQueue} />
        </Box>
      </Box>
    );
  }

  // Wide layout: list + detail
  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      <Box flexGrow={1}>
        {/* Left: pipeline list + agents */}
        <Box flexDirection="column" width={listWidth}>
          {pipelines.map((p, i) => (
            <PipelineListItem
              key={p.featureId}
              pipeline={p}
              selected={i === selectedIndex}
              width={listWidth}
            />
          ))}

          {agents.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>── Agents ({agents.length}) ──</Text>
              {agents.slice(0, 5).map((a) => (
                <AgentListItem key={a.sessionId} agent={a} />
              ))}
            </Box>
          ) : null}

          <MergeQueueSection entries={mergeQueue} />
        </Box>

        {/* Right: focus panel */}
        <Box flexDirection="column" width={detailWidth} borderStyle="single" borderColor="gray">
          {focusContent}
        </Box>
      </Box>
    </Box>
  );
}
