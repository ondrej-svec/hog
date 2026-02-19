import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// ── LLM call paths via extractIssueFields ──

describe("extractIssueFields with LLM (OpenRouter)", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    process.env["OPENROUTER_API_KEY"] = "test-or-key";
    delete process.env["ANTHROPIC_API_KEY"];
  });

  afterEach(() => {
    delete process.env["OPENROUTER_API_KEY"];
    vi.unstubAllGlobals();
  });

  it("merges LLM title when heuristic has explicit tokens", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Fix login bug cleaned up",
                  labels: ["bug"],
                  due_date: null,
                  assignee: "alice",
                }),
              },
            },
          ],
        }),
    });

    const result = await extractIssueFields("fix login bug #bug @alice");
    expect(result).not.toBeNull();
    // LLM title used when heuristic had explicit tokens
    expect(result?.title).toBe("Fix login bug cleaned up");
    // Heuristic label wins
    expect(result?.labels).toContain("bug");
    // Heuristic assignee wins
    expect(result?.assignee).toBe("alice");
  });

  it("uses heuristic title when heuristic has no explicit tokens (plain text)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "LLM improved title",
                  labels: [],
                  due_date: null,
                  assignee: null,
                }),
              },
            },
          ],
        }),
    });

    const result = await extractIssueFields("just a plain title");
    expect(result).not.toBeNull();
    // No explicit tokens so heuristic title is kept
    expect(result?.title).toBe("just a plain title");
  });

  it("falls back to heuristic and calls onLlmFallback when LLM API returns non-ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const onLlmFallback = vi.fn();
    const result = await extractIssueFields("fix bug #bug", { onLlmFallback });
    expect(result).not.toBeNull();
    expect(result?.labels).toContain("bug");
    expect(onLlmFallback).toHaveBeenCalledWith("AI parsing unavailable, used keyword matching");
  });

  it("falls back to heuristic when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const onLlmFallback = vi.fn();
    const result = await extractIssueFields("fix bug #bug", { onLlmFallback });
    expect(result).not.toBeNull();
    expect(result?.labels).toContain("bug");
    expect(onLlmFallback).toHaveBeenCalledWith("AI parsing unavailable, used keyword matching");
  });

  it("falls back to heuristic when OpenRouter choices array is missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ not_choices: [] }),
    });

    const onLlmFallback = vi.fn();
    const result = await extractIssueFields("fix bug #bug", { onLlmFallback });
    expect(result?.labels).toContain("bug");
    expect(onLlmFallback).toHaveBeenCalled();
  });

  it("falls back to heuristic when OpenRouter message content is missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: {} }],
        }),
    });

    const onLlmFallback = vi.fn();
    const result = await extractIssueFields("fix bug #bug", { onLlmFallback });
    expect(result?.labels).toContain("bug");
    expect(onLlmFallback).toHaveBeenCalled();
  });

  it("falls back to heuristic when OpenRouter content is not valid JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "not json {{{" } }],
        }),
    });

    const onLlmFallback = vi.fn();
    const result = await extractIssueFields("fix bug #bug", { onLlmFallback });
    expect(result?.labels).toContain("bug");
    expect(onLlmFallback).toHaveBeenCalled();
  });

  it("passes validLabels to the LLM call", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Fix bug",
                  labels: ["enhancement"],
                  due_date: null,
                  assignee: null,
                }),
              },
            },
          ],
        }),
    });

    await extractIssueFields("fix bug #bug", { validLabels: ["bug", "enhancement"] });

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = body.messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain("bug,enhancement");
  });

  it("merges heuristic dueDate over LLM due_date when both present", async () => {
    const today = new Date("2026-02-18T12:00:00Z");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Fix bug",
                  labels: [],
                  due_date: "2026-03-01",
                  assignee: null,
                }),
              },
            },
          ],
        }),
    });

    const result = await extractIssueFields("fix bug due tomorrow #bug", { today });
    // Heuristic dueDate (tomorrow = 2026-02-19) wins over LLM's 2026-03-01
    expect(result?.dueDate).toBe("2026-02-19");
  });

  it("uses LLM due_date when heuristic has no due date and LLM provides ISO date", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Fix bug",
                  labels: [],
                  due_date: "2026-04-01",
                  assignee: null,
                }),
              },
            },
          ],
        }),
    });

    const result = await extractIssueFields("fix bug");
    expect(result?.dueDate).toBe("2026-04-01");
  });

  it("ignores LLM due_date when it is not a valid ISO date", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Fix bug",
                  labels: [],
                  due_date: "next week",
                  assignee: null,
                }),
              },
            },
          ],
        }),
    });

    const result = await extractIssueFields("fix bug");
    expect(result?.dueDate).toBeNull();
  });
});

describe("extractIssueFields with LLM (Anthropic)", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    delete process.env["OPENROUTER_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "test-ant-key";
  });

  afterEach(() => {
    delete process.env["ANTHROPIC_API_KEY"];
    vi.unstubAllGlobals();
  });

  it("calls the Anthropic endpoint when ANTHROPIC_API_KEY is set", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: "Fix bug",
                labels: ["bug"],
                due_date: null,
                assignee: null,
              }),
            },
          ],
        }),
    });

    await extractIssueFields("fix bug #bug");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("extracts fields from Anthropic content array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: "Cleaned up title",
                labels: ["bug"],
                due_date: "2026-05-01",
                assignee: "bob",
              }),
            },
          ],
        }),
    });

    const result = await extractIssueFields("fix bug #bug @bob");
    expect(result).not.toBeNull();
    expect(result?.assignee).toBe("bob");
  });

  it("falls back to heuristic when Anthropic content array is missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ not_content: [] }),
    });

    const onLlmFallback = vi.fn();
    const result = await extractIssueFields("fix bug #bug", { onLlmFallback });
    expect(result?.labels).toContain("bug");
    expect(onLlmFallback).toHaveBeenCalled();
  });

  it("falls back to heuristic when Anthropic text field is missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text" }],
        }),
    });

    const onLlmFallback = vi.fn();
    const result = await extractIssueFields("fix bug #bug", { onLlmFallback });
    expect(result?.labels).toContain("bug");
    expect(onLlmFallback).toHaveBeenCalled();
  });

  it("falls back to heuristic when Anthropic text is not valid JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "not json {{{" }],
        }),
    });

    const onLlmFallback = vi.fn();
    const result = await extractIssueFields("fix bug #bug", { onLlmFallback });
    expect(result?.labels).toContain("bug");
    expect(onLlmFallback).toHaveBeenCalled();
  });

  it("returns null labels array when LLM labels field is not an array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: "Fix bug",
                labels: "bug",
                due_date: null,
                assignee: null,
              }),
            },
          ],
        }),
    });

    const result = await extractIssueFields("fix bug");
    // LLM gave non-array labels; heuristic has none either so result.labels is []
    expect(Array.isArray(result?.labels)).toBe(true);
    expect(result?.labels).toHaveLength(0);
  });
});
