import { describe, expect, it } from "vitest";
import { agentName, formatElapsed, humanizeTool, resetAgentNames } from "./humanize.js";

describe("humanizeTool", () => {
  it("humanizes Read with file path", () => {
    expect(humanizeTool("Read (src/engine/scout.ts)")).toBe("reading scout.ts");
  });

  it("humanizes Edit with file path", () => {
    expect(humanizeTool("Edit (src/engine/scout.ts:142)")).toBe("editing scout.ts");
  });

  it("humanizes Write", () => {
    expect(humanizeTool("Write (src/pipeline/tracker.ts)")).toBe("creating tracker.ts");
  });

  it("humanizes Grep", () => {
    expect(humanizeTool("Grep (ContentScorer)")).toBe('searching for "ContentScorer"');
  });

  it("humanizes Bash npm test", () => {
    expect(humanizeTool("Bash (npm test)")).toBe("running tests");
  });

  it("humanizes Bash npm install", () => {
    expect(humanizeTool("Bash (npm install feedparser)")).toBe("installing dependencies");
  });

  it("humanizes Bash git commit", () => {
    expect(humanizeTool("Bash (git commit -m 'fix')")).toBe("committing changes");
  });

  it("humanizes pytest", () => {
    expect(humanizeTool("Bash (pytest -q)")).toBe("running tests");
  });

  it("returns working... for undefined", () => {
    expect(humanizeTool(undefined)).toBe("working...");
  });

  it("humanizes TodoWrite", () => {
    expect(humanizeTool("TodoWrite")).toBe("planning next steps");
  });
});

describe("agentName", () => {
  it("assigns consistent names to session IDs", () => {
    resetAgentNames();
    const name1 = agentName("session-1");
    const name2 = agentName("session-2");
    expect(name1).toBe("Ada");
    expect(name2).toBe("Bea");
    // Same session gets same name
    expect(agentName("session-1")).toBe("Ada");
  });
});

describe("formatElapsed", () => {
  it("formats minutes", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatElapsed(fiveMinAgo)).toBe("5m");
  });

  it("formats hours", () => {
    const twoHoursAgo = new Date(Date.now() - 125 * 60_000).toISOString();
    expect(formatElapsed(twoHoursAgo)).toBe("2h 5m");
  });
});
