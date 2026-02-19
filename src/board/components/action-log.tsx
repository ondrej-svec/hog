import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { ActionLogEntry } from "../hooks/use-action-log.js";

interface ActionLogProps {
  readonly entries: ActionLogEntry[];
}

function relativeTime(ago: number): string {
  const seconds = Math.floor((Date.now() - ago) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function statusPrefix(status: ActionLogEntry["status"]): string {
  if (status === "success") return "\u2713";
  if (status === "error") return "\u2717";
  return "\u22EF";
}

function statusColor(status: ActionLogEntry["status"]): "green" | "red" | "yellow" {
  if (status === "success") return "green";
  if (status === "error") return "red";
  return "yellow";
}

function ActionLog({ entries }: ActionLogProps) {
  // Tick every 5s to update relative timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const visible = entries.slice(-5);
  // Find the most recent undoable entry
  const lastUndoable = [...entries].reverse().find((e) => !!e.undo);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      <Box paddingX={1}>
        <Text color="gray" bold>
          Action Log
        </Text>
        <Text color="gray" dimColor>
          {" "}
          (L: close)
        </Text>
      </Box>
      {visible.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>No actions yet.</Text>
        </Box>
      ) : (
        visible.map((entry) => {
          const isUndoable = lastUndoable?.id === entry.id && !!entry.undo;
          return (
            <Box key={entry.id} paddingX={1}>
              <Text color={statusColor(entry.status)}>{statusPrefix(entry.status)} </Text>
              <Text>{entry.description}</Text>
              <Text dimColor> {relativeTime(entry.ago)}</Text>
              {isUndoable ? <Text color="cyan"> [u: undo]</Text> : null}
              {entry.retry && entry.status === "error" ? (
                <Text color="yellow"> [retry]</Text>
              ) : null}
            </Box>
          );
        })
      )}
    </Box>
  );
}

export { ActionLog };
export type { ActionLogProps };
