import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { buildTopLine, Panel } from "./panel.js";

describe("buildTopLine", () => {
  it("produces exactly width chars", () => {
    const line = buildTopLine("[1] Repos", 24);
    expect(line.length).toBe(24);
  });

  it("embeds title in top border", () => {
    const line = buildTopLine("[1] Repos", 24);
    expect(line).toMatchInlineSnapshot(`"╭─ [1] Repos ──────────╮"`);
  });

  it("handles short width gracefully", () => {
    const line = buildTopLine("X", 6);
    expect(line.length).toBe(6);
    expect(line.startsWith("╭")).toBe(true);
    expect(line.endsWith("╮")).toBe(true);
  });
});

describe("Panel", () => {
  it("renders title in top border with rounded corners (inactive)", () => {
    const { lastFrame } = render(
      <Panel title="[1] Repos" isActive={false} width={24}>
        <Text>content line</Text>
      </Panel>,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("╭─ [1] Repos");
    expect(frame).toContain("╰");
    expect(frame).toContain("content line");
  });

  it("renders title in top border with rounded corners (active)", () => {
    const { lastFrame } = render(
      <Panel title="[2] Statuses" isActive={true} width={24}>
        <Text>item one</Text>
      </Panel>,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("╭─ [2] Statuses");
    expect(frame).toContain("item one");
  });

  it("renders empty panel without crashing", () => {
    const { lastFrame } = render(
      <Panel title="[3] Issues" isActive={false} width={40}>
        <Text color="gray">—</Text>
      </Panel>,
    );
    expect(lastFrame()).toContain("╭─ [3] Issues");
  });
});
