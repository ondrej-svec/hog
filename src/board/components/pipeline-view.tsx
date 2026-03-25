import { Box, Text } from "ink";
import type { TrackedAgent } from "../../engine/agent-manager.js";
import type { Pipeline, PipelineStatus } from "../../engine/conductor.js";
import type { Question } from "../../engine/question-queue.js";
import type { MergeQueueEntry } from "../../engine/refinery.js";

function timeAgo(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

// ── Types ──

export interface PipelineViewData {
  readonly pipelines: Pipeline[];
  readonly agents: readonly TrackedAgent[];
  readonly pendingDecisions: Question[];
  readonly mergeQueue: readonly MergeQueueEntry[];
  readonly selectedIndex: number;
  /** Recent log entries for the selected pipeline. */
  readonly logEntries?: readonly string[] | undefined;
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
  const total = 6;
  const completed = pipeline.completedBeads ?? 0;
  const filled = Math.round((completed / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function progressPercent(pipeline: Pipeline): string {
  const pct = Math.round(((pipeline.completedBeads ?? 0) / 6) * 100);
  return `${pct}%`;
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
  const isBrainstorming = pipeline.activePhase === "brainstorm";
  const icon = isBrainstorming ? "?" : statusIcon(pipeline.status);
  const color = isBrainstorming ? "cyan" : statusColor(pipeline.status);
  // Allocate: 4 chars icon/selection + title + 1 space + bar(8) + percentage(5) + phase(10)
  const overhead = 28; // icon(4) + bar(8) + pct(5) + phase(10) + spaces
  const maxTitle = Math.max(10, width - overhead);
  const bar = progressBar(pipeline, 8);
  const title =
    pipeline.title.length > maxTitle
      ? `${pipeline.title.slice(0, maxTitle - 3)}...`
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
      <Text dimColor> {progressPercent(pipeline)}</Text>
      {pipeline.activePhase ? <Text dimColor> {pipeline.activePhase}</Text> : null}
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

// ── Brainstorm Panel ──

function BrainstormPanel({ pipeline }: { pipeline: Pipeline }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Ready to brainstorm: {pipeline.title}
        </Text>
      </Box>
      <Box>
        <Text dimColor>Pipeline: </Text>
        <Text>{pipeline.featureId}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Press </Text>
        <Text color="cyan" bold>
          Z
        </Text>
        <Text> to start the brainstorm session</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          You'll brainstorm with Claude to refine the spec into user stories.
          {"\n"}When done, close the bead and autonomous work begins.
        </Text>
      </Box>
    </Box>
  );
}

// ── All Clear Panel ──

function AllClearPanel({ pipelines }: { pipelines: Pipeline[] }) {
  const runningCount = pipelines.filter((p) => p.status === "running").length;
  const completedCount = pipelines.filter((p) => p.status === "completed").length;

  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center" paddingY={2}>
      <Text color="green" bold>
        ✓ Nothing needs your attention.
      </Text>
      {runningCount > 0 ? (
        <Box marginTop={1}>
          <Text dimColor>
            {runningCount} pipeline{runningCount > 1 ? "s" : ""} running autonomously.
          </Text>
        </Box>
      ) : null}
      {completedCount > 0 ? (
        <Box marginTop={1}>
          <Text color="green">
            {completedCount} pipeline{completedCount > 1 ? "s" : ""} completed.
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>Go do deep work. Hog will toast when it needs you.</Text>
      </Box>
    </Box>
  );
}

// ── Pipeline Status Bar ──

function PipelineStatusBar({
  pipelines,
  agents,
  pendingDecisions,
  mergeQueue,
}: {
  pipelines: Pipeline[];
  agents: readonly TrackedAgent[];
  pendingDecisions: Question[];
  mergeQueue: readonly MergeQueueEntry[];
}) {
  const running = pipelines.filter((p) => p.status === "running").length;
  const brainstorming = pipelines.filter(
    (p) => p.status === "running" && p.activePhase === "brainstorm",
  ).length;
  const autonomous = running - brainstorming;
  const blocked = pipelines.filter((p) => p.status === "blocked").length;
  const agentCount = agents.filter((a) => a.monitor.isRunning).length;
  const decisions = pendingDecisions.length;
  const queueDepth = mergeQueue.filter((e) => e.status === "pending").length;

  const pipelineLabel =
    brainstorming > 0 && autonomous > 0
      ? `${brainstorming} brainstorming, ${autonomous} autonomous`
      : brainstorming > 0
        ? `${running} pipeline${running !== 1 ? "s" : ""} (brainstorming)`
        : `${running} pipeline${running !== 1 ? "s" : ""}`;

  return (
    <Box>
      <Text dimColor>{pipelineLabel}</Text>
      <Text dimColor> · </Text>
      <Text dimColor>
        {agentCount} agent{agentCount !== 1 ? "s" : ""}
      </Text>
      {decisions > 0 ? (
        <>
          <Text dimColor> · </Text>
          <Text color="red" bold>
            ⚠ {decisions} decision{decisions !== 1 ? "s" : ""}
          </Text>
        </>
      ) : null}
      {blocked > 0 ? (
        <>
          <Text dimColor> · </Text>
          <Text color="yellow">{blocked} blocked</Text>
        </>
      ) : null}
      {queueDepth > 0 ? (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>queue: {queueDepth}</Text>
        </>
      ) : null}
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

function PipelineDetailPanel({
  pipeline,
  agents,
  logEntries,
}: {
  pipeline: Pipeline;
  agents: readonly TrackedAgent[];
  logEntries?: readonly string[] | undefined;
}) {
  const phases = ["brainstorm", "stories", "tests", "impl", "redteam", "merge"] as const;
  // Filter agents belonging to this pipeline (match by repo)
  const pipelineAgents = agents.filter((a) => a.repo === pipeline.repo);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>{pipeline.title}</Text>
      </Box>

      {/* DAG visualization with real status */}
      <Box>
        {phases.map((phase, i) => {
          const phaseOrder = phases.indexOf(phase);
          const completed = pipeline.completedBeads ?? 0;
          let phaseIcon: string;
          let phaseColor: string;

          if (phaseOrder < completed) {
            phaseIcon = "✓";
            phaseColor = "green";
          } else if (phase === pipeline.activePhase) {
            phaseIcon = "◐";
            phaseColor = "yellow";
          } else if (pipeline.status === "failed") {
            phaseIcon = "✗";
            phaseColor = "red";
          } else {
            phaseIcon = "○";
            phaseColor = "gray";
          }

          return (
            <Text key={phase}>
              <Text color={phaseColor}>
                {phase} {phaseIcon}
              </Text>
              {i < phases.length - 1 ? <Text dimColor> → </Text> : null}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Status: </Text>
        {pipeline.activePhase === "brainstorm" ? (
          <Text color="cyan">waiting for you — press Z to brainstorm</Text>
        ) : (
          <Text color={statusColor(pipeline.status)}>{pipeline.status}</Text>
        )}
        <Text dimColor>
          {" "}
          · {progressPercent(pipeline)} · started {timeAgo(pipeline.startedAt)}
        </Text>
      </Box>

      {/* Active agents for this pipeline */}
      {pipelineAgents.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>── Agents ──</Text>
          {pipelineAgents.map((agent) => {
            const elapsed = Math.floor((Date.now() - new Date(agent.startedAt).getTime()) / 60_000);
            const activity = agent.monitor.lastToolUse
              ? `using ${agent.monitor.lastToolUse}`
              : agent.monitor.isRunning
                ? "working..."
                : "done";
            return (
              <Box key={agent.sessionId}>
                <Text color={agent.monitor.isRunning ? "yellow" : "green"}>
                  {agent.monitor.isRunning ? "◐ " : "✓ "}
                </Text>
                <Text bold>{agent.phase}</Text>
                <Text dimColor>
                  {" "}
                  {activity} · {elapsed}m
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : null}

      {/* Recent log entries */}
      {logEntries && logEntries.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>── Log ──</Text>
          {logEntries.map((entry, i) => {
            // Parse timestamp and message from "[ISO] message" format
            const match = entry.match(/^\[([^\]]+)\]\s+(.*)/);
            const msg = match ? match[2] : entry;
            const ts = match ? timeAgo(match[1]!) : "";
            return (
              <Box key={`${i}`}>
                <Text dimColor>  {ts ? `${ts}: ` : ""}</Text>
                <Text>{msg}</Text>
              </Box>
            );
          })}
        </Box>
      ) : null}

      {/* Blocked/failed indicator */}
      {pipeline.status === "blocked" ? (
        <Box marginTop={1}>
          <Text color="red" bold>
            ⚠ Blocked — waiting for your decision (see above or press 1-9)
          </Text>
        </Box>
      ) : null}
      {pipeline.status === "failed" ? (
        <Box marginTop={1}>
          <Text color="red" bold>
            ✗ Pipeline failed at {pipeline.activePhase ?? "unknown"} phase
          </Text>
        </Box>
      ) : null}
      {pipeline.status === "completed" ? (
        <Box marginTop={1}>
          <Text color="green" bold>
            ✓ Complete! {pipeline.completedBeads}/6 phases done.
            {pipeline.completedAt ? ` Finished ${timeAgo(pipeline.completedAt)}` : ""}
          </Text>
        </Box>
      ) : null}
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
  const { pipelines, agents, pendingDecisions, mergeQueue, selectedIndex, logEntries } = data;
  const isWide = cols >= 100;
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
  const brainstormPipeline =
    selectedPipeline?.activePhase === "brainstorm" ? selectedPipeline : undefined;
  const focusContent = brainstormPipeline ? (
    <BrainstormPanel pipeline={brainstormPipeline} />
  ) : pendingDecisions.length > 0 ? (
    <DecisionPanel question={pendingDecisions[0]!} />
  ) : selectedPipeline ? (
    <PipelineDetailPanel pipeline={selectedPipeline} agents={agents} logEntries={logEntries} />
  ) : (
    <AllClearPanel pipelines={pipelines} />
  );

  // Narrow layout: list + inline focus content (decisions/detail)
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

          {/* Focus content inline in narrow layout */}
          <Box flexDirection="column" marginTop={1}>
            {focusContent}
          </Box>

          {agents.length > 0 && pendingDecisions.length === 0 && !selectedPipeline ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>── Agents ({agents.length}) ──</Text>
              {agents.slice(0, 5).map((a) => (
                <AgentListItem key={a.sessionId} agent={a} />
              ))}
            </Box>
          ) : null}

          <MergeQueueSection entries={mergeQueue} />
        </Box>
        <PipelineStatusBar
          pipelines={pipelines}
          agents={agents}
          pendingDecisions={pendingDecisions}
          mergeQueue={mergeQueue}
        />
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
      <PipelineStatusBar
        pipelines={pipelines}
        agents={agents}
        pendingDecisions={pendingDecisions}
        mergeQueue={mergeQueue}
      />
    </Box>
  );
}
