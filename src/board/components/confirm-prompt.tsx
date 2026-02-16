import { Box, Text, useInput } from "ink";

interface ConfirmPromptProps {
  readonly message: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function ConfirmPrompt({ message, onConfirm, onCancel }: ConfirmPromptProps) {
  useInput((input, key) => {
    if (input === "y" || input === "Y") return onConfirm();
    if (input === "n" || input === "N" || key.escape) return onCancel();
  });

  return (
    <Box>
      <Text color="cyan">{message}</Text>
      <Text color="gray"> (y/n)</Text>
    </Box>
  );
}

export { ConfirmPrompt };
