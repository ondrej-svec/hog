import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";

export type FocusEndAction = "restart" | "break" | "done" | "exit";

interface FocusModeProps {
  /** Label to show (e.g. "aibility#142 — Fix login bug") */
  readonly label: string;
  /** Duration in seconds (default 1500 = 25 min) */
  readonly durationSec: number;
  /** Called when user exits focus mode */
  readonly onExit: () => void;
  /** Called when timer ends and user picks an action */
  readonly onEndAction: (action: FocusEndAction) => void;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function FocusMode({ label, durationSec, onExit, onEndAction }: FocusModeProps) {
  const [remaining, setRemaining] = useState(durationSec);
  const [timerDone, setTimerDone] = useState(false);
  const bellSentRef = useRef(false);

  // Countdown timer
  useEffect(() => {
    if (timerDone) return;

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setTimerDone(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerDone]);

  // Terminal bell on completion
  useEffect(() => {
    if (timerDone && !bellSentRef.current) {
      bellSentRef.current = true;
      process.stdout.write("\x07");
    }
  }, [timerDone]);

  // Input: during timer, only Escape exits
  // After timer, show prompt: c=Continue, b=Break, d=Done, Esc=Exit
  const handleInput = useCallback(
    (input: string, key: { escape: boolean }) => {
      if (key.escape) {
        if (timerDone) {
          onEndAction("exit");
        } else {
          onExit();
        }
        return;
      }

      if (!timerDone) return; // No other keys during timer

      switch (input.toLowerCase()) {
        case "c":
          onEndAction("restart");
          break;
        case "b":
          onEndAction("break");
          break;
        case "d":
          onEndAction("done");
          break;
      }
    },
    [timerDone, onExit, onEndAction],
  );

  useInput(handleInput);

  if (timerDone) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green" bold>
            Focus complete!
          </Text>
          <Text color="gray"> {label}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="cyan">[c]</Text>
          <Text> Continue </Text>
          <Text color="cyan">[b]</Text>
          <Text> Break </Text>
          <Text color="cyan">[d]</Text>
          <Text> Done </Text>
          <Text color="gray">[Esc]</Text>
          <Text> Exit</Text>
        </Box>
      </Box>
    );
  }

  const progress = 1 - remaining / durationSec;
  const barWidth = 20;
  const filled = Math.round(progress * barWidth);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="magenta" bold>
          Focus:{" "}
        </Text>
        <Text>{label}</Text>
      </Box>
      <Box>
        <Text color="magenta">{bar}</Text>
        <Text> </Text>
        <Text bold>{formatTime(remaining)}</Text>
        <Text color="gray"> remaining</Text>
      </Box>
      <Text color="gray" dimColor>
        Esc to exit focus
      </Text>
    </Box>
  );
}

export { formatTime };
