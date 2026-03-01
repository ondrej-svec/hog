import { Box, Text } from "ink";
import type { TrackedAgent } from "../hooks/use-agent-sessions.js";

export interface AgentActivityPanelProps {
  readonly agents: readonly TrackedAgent[];
  readonly maxHeight: number;
}

/** Format elapsed time since start as "Xm" or "Xs". */
function elapsed(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}

/** Status indicator for an agent. */
function statusIcon(agent: TrackedAgent): string {
  if (!agent.monitor.isRunning) return "✓";
  return "⟳";
}

/** Status color based on agent state. */
function statusColor(agent: TrackedAgent): string {
  if (!agent.monitor.isRunning) return "green";
  return "yellow";
}

/** Current activity summary for a running agent. */
function activityText(agent: TrackedAgent): string {
  if (!agent.monitor.isRunning) return "done";
  if (agent.monitor.lastToolUse) return `using ${agent.monitor.lastToolUse}`;
  return "running";
}

export function AgentActivityPanel({ agents, maxHeight }: AgentActivityPanelProps) {
  if (agents.length === 0) return null;

  const visible = agents.slice(0, Math.max(1, maxHeight));

  return (
    <Box flexDirection="column">
      {visible.map((agent) => (
        <Box key={agent.sessionId} gap={1}>
          <Text color={statusColor(agent)}>
            {statusIcon(agent)}
          </Text>
          <Text color="cyan" bold>
            #{agent.issueNumber}
          </Text>
          <Text color="white">{agent.phase}</Text>
          <Text dimColor>
            {activityText(agent)} ({elapsed(agent.startedAt)})
          </Text>
        </Box>
      ))}
    </Box>
  );
}
