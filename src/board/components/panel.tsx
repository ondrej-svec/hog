import { Box, Text } from "ink";
import type { ReactNode } from "react";

interface PanelProps {
  /** Text shown inside the top border: ╭─ title ──╮ */
  readonly title: string;
  /** Whether this panel is currently focused (cyan border vs gray) */
  readonly isActive: boolean;
  /** Total outer width including border chars */
  readonly width: number;
  /** Fixed total height (optional; use flexGrow instead for variable-height panels) */
  readonly height?: number | undefined;
  /** CSS flex grow factor — use 1 for panels that should fill available space */
  readonly flexGrow?: number | undefined;
  readonly children: ReactNode;
}

/**
 * Build the top border line with the title embedded.
 * Output: ╭─ title ─────────╮  (exactly `width` chars)
 */
export function buildTopLine(title: string, width: number): string {
  const titlePart = `─ ${title} `; // "─ title "
  const dashCount = Math.max(0, width - 2 - titlePart.length); // corners = 2 chars
  return `╭${titlePart}${"─".repeat(dashCount)}╮`;
}

/**
 * A lazygit-style panel: title embedded in the top border, rounded corners,
 * cyan border when active / gray when inactive.
 *
 * Rendering:
 *   ╭─ [1] Repos ──────────╮   ← manually drawn Text (1 row)
 *   │ content               │   ← Ink Box with borderTop=false
 *   ╰───────────────────────╯   ← from Ink Box bottom border
 */
export function Panel({ title, isActive, width, height, flexGrow, children }: PanelProps) {
  const color = isActive ? "cyan" : "gray";
  const topLine = buildTopLine(title, width);

  return (
    <Box flexDirection="column" width={width} height={height} flexGrow={flexGrow} overflow="hidden">
      <Text color={color}>{topLine}</Text>
      <Box
        borderStyle="round"
        borderTop={false}
        borderColor={color}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        width={width}
      >
        {children}
      </Box>
    </Box>
  );
}

export type { PanelProps };
