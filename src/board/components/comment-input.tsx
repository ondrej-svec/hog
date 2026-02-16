import { TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface CommentInputProps {
  readonly issueNumber: number;
  readonly onSubmit: (body: string) => void;
  readonly onCancel: () => void;
}

function CommentInput({ issueNumber, onSubmit, onCancel }: CommentInputProps) {
  const [value, setValue] = useState("");

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box>
      <Text color="cyan">comment #{issueNumber}: </Text>
      <TextInput
        defaultValue={value}
        placeholder="type comment, Enter to post..."
        onChange={setValue}
        onSubmit={(text) => {
          if (text.trim()) onSubmit(text.trim());
          else onCancel();
        }}
      />
    </Box>
  );
}

export { CommentInput };
