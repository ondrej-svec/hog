import { Spinner, TextInput } from "@inkjs/ui";
import { Box, Text } from "ink";
import { useRef, useState } from "react";

interface StartPipelineOverlayProps {
  readonly onSubmit: (description: string) => void;
  readonly onCancel: () => void;
  readonly beadsAvailable: boolean;
}

export function StartPipelineOverlay({
  onSubmit,
  onCancel,
  beadsAvailable,
}: StartPipelineOverlayProps) {
  const lastValue = useRef("");
  const [submitting, setSubmitting] = useState(false);

  if (!beadsAvailable) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="red" bold>
          Beads (bd) is not installed
        </Text>
        <Box marginTop={1}>
          <Text>Install Beads to use pipelines: </Text>
          <Text color="cyan">brew install beads</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to close</Text>
        </Box>
      </Box>
    );
  }

  if (submitting) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box>
          <Spinner label="Creating pipeline — setting up Beads DAG..." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>What do you want to build?</Text>
      <Box marginTop={1}>
        <Text dimColor>Describe the feature — a pipeline will be created with:</Text>
      </Box>
      <Box>
        <Text dimColor>stories → tests → implementation → red team → merge</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan">→ </Text>
        <TextInput
          placeholder="Describe the feature..."
          onChange={(val) => {
            lastValue.current = val;
          }}
          onSubmit={() => {
            if (lastValue.current.trim()) {
              setSubmitting(true);
              onSubmit(lastValue.current.trim());
            }
          }}
        />
      </Box>
    </Box>
  );
}
