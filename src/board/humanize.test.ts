import { afterEach, describe, expect, it } from "vitest";
import {
  agentName,
  formatElapsed,
  humanizeTool,
  resetAgentNames,
  roleCharacter,
  timeAgo,
} from "./humanize.js";

describe("humanizeTool", () => {
  // ── Core tools ──
  it.each([
    ["Read (src/engine/scout.ts)", "reading scout.ts"],
    ["Read (src/deep/nested/path/file.ts)", "reading file.ts"],
    ["Edit (src/engine/scout.ts:142)", "editing scout.ts"],
    ["MultiEdit (config.ts)", "editing config.ts"],
    ["Write (src/pipeline/tracker.ts)", "creating tracker.ts"],
    ["Grep (ContentScorer)", 'searching for "ContentScorer"'],
    ["Glob (*.test.ts)", "finding *.test.ts"],
    ["TodoWrite", "planning next steps"],
    ["Agent", "delegating to subagent"],
  ])("humanizes %s → %s", (raw, expected) => {
    expect(humanizeTool(raw)).toBe(expected);
  });

  // ── New tool types ──
  it.each([
    ["LS (src/engine)", "listing src/engine"],
    ["WebFetch (https://docs.example.com/api/v2)", "fetching docs.example.com/api/v2"],
    ["WebSearch (claude code auto mode)", 'searching web for "claude code auto mode"'],
    ["NotebookEdit", "editing notebook"],
  ])("humanizes %s → %s", (raw, expected) => {
    expect(humanizeTool(raw)).toBe(expected);
  });

  // ── Bash commands ──
  it.each([
    ["Bash (npm test)", "running tests"],
    ["Bash (npx vitest run)", "running tests"],
    ["Bash (pytest -q --tb=short)", "running tests"],
    ["Bash (cargo test)", "running tests"],
    ["Bash (go test ./...)", "running tests"],
    ["Bash (npm install feedparser)", "installing dependencies"],
    ["Bash (pip install requests)", "installing dependencies"],
    ["Bash (uv pip install pytest)", "installing dependencies"],
    ["Bash (npm run build)", "building project"],
    ["Bash (npm run lint)", "running linter"],
    ["Bash (biome check src/)", "running linter"],
    ["Bash (git commit -m 'fix')", "committing changes"],
    ["Bash (git add src/)", "staging files"],
    ["Bash (git diff --stat)", "checking changes"],
    ["Bash (ls -la src/)", "listing files"],
    ["Bash (mkdir -p dist/)", "creating directory"],
    ["Bash (uv run script.py)", "running script"],
  ])("humanizes %s → %s", (raw, expected) => {
    expect(humanizeTool(raw)).toBe(expected);
  });

  // ── Edge cases ──
  it("returns working... for undefined", () => {
    expect(humanizeTool(undefined)).toBe("working...");
  });

  it("truncates very long raw strings", () => {
    const long = "SomeUnknownTool".repeat(5);
    const result = humanizeTool(long);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toContain("...");
  });

  it("handles tool name without parentheses", () => {
    expect(humanizeTool("Read")).toBe("reading file");
  });

  it("handles empty detail", () => {
    // "Bash ()" doesn't match the regex, falls through to default
    expect(humanizeTool("Bash")).toBe("running command");
  });
});

describe("agentName", () => {
  afterEach(() => resetAgentNames());

  it("assigns deterministic names based on session ID", () => {
    const name1 = agentName("session-abc-123");
    const name2 = agentName("session-def-456");
    // Same ID always gets same name
    expect(agentName("session-abc-123")).toBe(name1);
    expect(agentName("session-def-456")).toBe(name2);
    // Different IDs get different names
    expect(name1).not.toBe(name2);
  });

  it("handles collisions with suffix", () => {
    // Force many names to exhaust the pool
    const names = new Set<string>();
    for (let i = 0; i < 20; i++) {
      names.add(agentName(`session-${i}`));
    }
    // All names should be unique
    expect(names.size).toBe(20);
  });

  it("resets cleanly", () => {
    const name1 = agentName("session-x");
    resetAgentNames();
    // After reset, same ID should get same deterministic name
    const name2 = agentName("session-x");
    expect(name1).toBe(name2);
  });
});

describe("formatElapsed", () => {
  it("formats just now", () => {
    const now = new Date().toISOString();
    expect(formatElapsed(now)).toBe("just now");
  });

  it("formats minutes", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatElapsed(fiveMinAgo)).toBe("5m");
  });

  it("formats hours and minutes", () => {
    const twoHoursAgo = new Date(Date.now() - 125 * 60_000).toISOString();
    expect(formatElapsed(twoHoursAgo)).toBe("2h 5m");
  });
});

describe("timeAgo", () => {
  it("formats just now", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
  });

  it("formats minutes ago", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(timeAgo(tenMinAgo)).toBe("10m ago");
  });

  it("formats hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 195 * 60_000).toISOString();
    expect(timeAgo(threeHoursAgo)).toBe("3h 15m ago");
  });
});

describe("roleCharacter — H2G2 character mapping", () => {
  it.each([
    ["brainstorm", "Zaphod"],
    ["stories", "Ford"],
    ["test", "Arthur"],
    ["impl", "Arthur"],
    ["redteam", "Marvin"],
    ["merge", "Vogons"],
  ] as const)("maps %s → %s", (role, expected) => {
    expect(roleCharacter(role)).toBe(expected);
  });

  it("returns the role name for unknown roles", () => {
    expect(roleCharacter("unknown")).toBe("unknown");
  });
});
