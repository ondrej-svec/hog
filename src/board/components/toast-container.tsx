import { Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";
import type { Toast } from "../hooks/use-toast.js";

interface ToastContainerProps {
  toasts: Toast[];
}

const TYPE_COLORS = {
  info: "cyan",
  success: "green",
  error: "red",
  loading: "cyan",
} as const;

const TYPE_PREFIXES = {
  info: "\u2139",
  success: "\u2713",
  error: "\u2717",
} as const;

export function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <Box flexDirection="column">
      {toasts.map((t) => (
        <Box key={t.id}>
          {t.type === "loading" ? (
            <>
              <Spinner label="" />
              <Text color="cyan"> {t.message}</Text>
            </>
          ) : (
            <Text color={TYPE_COLORS[t.type]}>
              {TYPE_PREFIXES[t.type]} {t.message}
              {t.type === "error" ? (
                <Text color="gray">{t.retry ? " [r]etry [d]ismiss" : " [d]ismiss"}</Text>
              ) : null}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
