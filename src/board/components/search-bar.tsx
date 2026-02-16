import { TextInput } from "@inkjs/ui";
import { Box, Text } from "ink";

interface SearchBarProps {
  readonly defaultValue: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}

function SearchBar({ defaultValue, onChange, onSubmit }: SearchBarProps) {
  return (
    <Box>
      <Text color="yellow">/</Text>
      <TextInput
        defaultValue={defaultValue}
        placeholder="search..."
        onChange={onChange}
        onSubmit={onSubmit}
      />
    </Box>
  );
}

export { SearchBar };
export type { SearchBarProps };
