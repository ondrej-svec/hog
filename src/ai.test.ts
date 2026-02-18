import { describe, expect, it, vi } from "vitest";
import { extractIssueFields, hasLlmApiKey, parseHeuristic } from "./ai.js";

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, getLlmAuth: () => null };
});

describe("parseHeuristic", () => {
  it("returns null when title is empty after stripping tokens", async () => {
    expect(await parseHeuristic("#bug @me")).toBeNull();
  });

  it("extracts label, assignee, and title", async () => {
    const result = await parseHeuristic("fix login bug #bug @alice");
    expect(result).not.toBeNull();
    expect(result?.title).toBe("fix login bug");
    expect(result?.labels).toContain("bug");
    expect(result?.assignee).toBe("alice");
  });

  it("extracts multiple labels", async () => {
    const result = await parseHeuristic("refactor auth #bug #priority:high");
    expect(result?.labels).toEqual(["bug", "priority:high"]);
    expect(result?.title).toBe("refactor auth");
  });

  it("last @mention wins for assignee", async () => {
    const result = await parseHeuristic("fix bug @alice @bob");
    expect(result?.assignee).toBe("bob");
  });

  it("parses due date and advances year for past dates", async () => {
    // Simulate Jan 16 2026, parsing "due Jan 15" — should advance to 2027
    const jan16 = new Date("2026-01-16T12:00:00Z");
    const result = await parseHeuristic("fix bug due Jan 15", jan16);
    expect(result?.dueDate).toBe("2027-01-15");
  });

  it("formats due date as YYYY-MM-DD", async () => {
    const today = new Date("2026-02-18T12:00:00Z");
    const result = await parseHeuristic("fix bug due tomorrow", today);
    expect(result?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns title-only result when no tokens present", async () => {
    const result = await parseHeuristic("just a plain title");
    expect(result?.title).toBe("just a plain title");
    expect(result?.labels).toHaveLength(0);
    expect(result?.assignee).toBeNull();
    expect(result?.dueDate).toBeNull();
  });
});

describe("extractIssueFields", () => {
  it("returns heuristic result when no API key set", async () => {
    // Ensure no API key in env
    const origOr = process.env["OPENROUTER_API_KEY"];
    const origAnt = process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];

    const result = await extractIssueFields("fix bug #bug @me");
    expect(result?.title).toBe("fix bug");
    expect(result?.labels).toContain("bug");

    if (origOr !== undefined) process.env["OPENROUTER_API_KEY"] = origOr;
    if (origAnt !== undefined) process.env["ANTHROPIC_API_KEY"] = origAnt;
  });

  it("returns null when input has no title", async () => {
    const result = await extractIssueFields("#bug @me");
    expect(result).toBeNull();
  });
});

describe("hasLlmApiKey", () => {
  it("returns false when no key set", () => {
    const origOr = process.env["OPENROUTER_API_KEY"];
    const origAnt = process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    expect(hasLlmApiKey()).toBe(false);
    if (origOr !== undefined) process.env["OPENROUTER_API_KEY"] = origOr;
    if (origAnt !== undefined) process.env["ANTHROPIC_API_KEY"] = origAnt;
  });

  it("returns true when OPENROUTER_API_KEY is set", () => {
    process.env["OPENROUTER_API_KEY"] = "test-key";
    expect(hasLlmApiKey()).toBe(true);
    delete process.env["OPENROUTER_API_KEY"];
  });
});
