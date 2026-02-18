/**
 * Natural language issue field extraction.
 *
 * Two-layer approach:
 *  1. Heuristic parser — always runs, no API key needed.
 *  2. Optional LLM layer — used when OPENROUTER_API_KEY or ANTHROPIC_API_KEY is set.
 *     If both keys are set, OpenRouter is preferred.
 *
 * The merge strategy: heuristic wins on explicitly-marked tokens (#, @, due);
 * LLM wins only on ambiguous title cleanup.
 */

export interface ParsedIssue {
  title: string;
  labels: string[];
  assignee: string | null;
  dueDate: string | null; // YYYY-MM-DD
}

// ── Heuristic Parser ──

/**
 * Parse a natural-language issue string with simple token extraction.
 *
 * Token rules:
 *  - `#word`         → label (lowercased)
 *  - `@me`/`@user`   → assignee
 *  - `due <expr>`    → due date (chrono-node, forwardDate, dynamically imported)
 *  - everything else → title
 *
 * Returns null if the title after stripping tokens is empty.
 */
export async function parseHeuristic(
  input: string,
  today: Date = new Date(),
): Promise<ParsedIssue | null> {
  let remaining = input;

  // Extract #labels
  const labelMatches = [...remaining.matchAll(/#([\w:/-]+)/g)];
  const rawLabels = labelMatches.map((m) => (m[1] ?? "").toLowerCase());
  remaining = remaining.replace(/#[\w:/-]+/g, "").trim();

  // Extract @assignee (last one wins)
  const assigneeMatches = [...remaining.matchAll(/@([\w-]+)/g)];
  const assignee =
    assigneeMatches.length > 0 ? (assigneeMatches[assigneeMatches.length - 1]?.[1] ?? null) : null;
  remaining = remaining.replace(/@[\w-]+/g, "").trim();

  // Extract "due <expression>"
  let dueDate: string | null = null;
  const dueMatch = remaining.match(/\bdue\s+(.+?)(?:\s+#|\s+@|$)/i);
  if (dueMatch?.[1]) {
    const { parse } = await import("chrono-node");
    const results = parse(dueMatch[1], { instant: today }, { forwardDate: true });
    const first = results[0];
    if (first) {
      let date = first.date();
      // chrono-node bug #240: forwardDate may not advance year for e.g. "Jan 15"
      // when today is Jan 16 — post-check and add a year if the parsed date is in the past
      if (date < today) {
        date = new Date(date);
        date.setFullYear(date.getFullYear() + 1);
      }
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      dueDate = `${yyyy}-${mm}-${dd}`;
    }
    remaining = remaining.slice(0, dueMatch.index ?? 0).trim();
  }

  // What's left is the title
  const title = remaining.replace(/\s+/g, " ").trim();
  if (!title) return null;

  return { title, labels: rawLabels, assignee, dueDate };
}

// ── LLM Parser ──

interface LLMResult {
  title: string;
  labels: string[];
  due_date: string | null;
  assignee: string | null;
}

function detectProvider(): { provider: "openrouter" | "anthropic"; apiKey: string } | null {
  const orKey = process.env["OPENROUTER_API_KEY"];
  if (orKey) return { provider: "openrouter", apiKey: orKey };
  const antKey = process.env["ANTHROPIC_API_KEY"];
  if (antKey) return { provider: "anthropic", apiKey: antKey };
  return null;
}

async function callLLM(
  userText: string,
  validLabels: string[],
  today: Date,
  providerConfig: { provider: "openrouter" | "anthropic"; apiKey: string },
): Promise<LLMResult | null> {
  const { provider, apiKey } = providerConfig;
  const todayStr = today.toISOString().slice(0, 10);
  const systemPrompt = `Extract GitHub issue fields. Today is ${todayStr}. Return JSON with: title (string), labels (string[]), due_date (YYYY-MM-DD or null), assignee (string or null).`;
  const escapedText = userText.replace(/<\/input>/gi, "< /input>");
  const userContent = `<input>${escapedText}</input>\n<valid_labels>${validLabels.join(",")}</valid_labels>`;

  const jsonSchema = {
    name: "issue",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        due_date: { type: ["string", "null"] },
        assignee: { type: ["string", "null"] },
      },
      required: ["title", "labels", "due_date", "assignee"],
      additionalProperties: false,
    },
  };

  try {
    let response: Response;

    if (provider === "openrouter") {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_schema", json_schema: jsonSchema },
          max_tokens: 256,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } else {
      // Anthropic direct
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
          max_tokens: 256,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    }

    if (!response.ok) return null;

    const json = (await response.json()) as Record<string, unknown>;

    let raw: unknown;
    if (provider === "openrouter") {
      const choicesRaw = json["choices"];
      if (!Array.isArray(choicesRaw)) return null;
      const firstChoice = choicesRaw[0] as { message?: { content?: string } } | undefined;
      const content = firstChoice?.message?.content;
      if (!content) return null;
      raw = JSON.parse(content);
    } else {
      // Anthropic: content[0].text
      const contentRaw = json["content"];
      if (!Array.isArray(contentRaw)) return null;
      const firstItem = contentRaw[0] as { type: string; text?: string } | undefined;
      const text = firstItem?.text;
      if (!text) return null;
      raw = JSON.parse(text);
    }

    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    return {
      title: typeof r["title"] === "string" ? r["title"] : "",
      labels: Array.isArray(r["labels"])
        ? (r["labels"] as unknown[]).filter((l): l is string => typeof l === "string")
        : [],
      due_date:
        typeof r["due_date"] === "string" && ISO_DATE_RE.test(r["due_date"]) ? r["due_date"] : null,
      assignee: typeof r["assignee"] === "string" ? r["assignee"] : null,
    };
  } catch {
    return null;
  }
}

// ── Combined extractor ──

export interface ExtractOptions {
  /** Repo label list for validation hints */
  validLabels?: string[];
  /** Override today's date (for testing) */
  today?: Date;
  /** Called with a warning if LLM was unavailable but was configured */
  onLlmFallback?: ((reason: string) => void) | undefined;
}

/**
 * Extract issue fields from a natural language string.
 * Runs heuristic first, then optionally merges LLM result on top.
 * Heuristic wins on explicit tokens (#, @, due); LLM wins on title cleanup.
 */
export async function extractIssueFields(
  input: string,
  options: ExtractOptions = {},
): Promise<ParsedIssue | null> {
  const today = options.today ?? new Date();
  const heuristic = await parseHeuristic(input, today);
  if (!heuristic) return null;

  const providerConfig = detectProvider();
  if (!providerConfig) return heuristic;

  const llmResult = await callLLM(input, options.validLabels ?? [], today, providerConfig);
  if (!llmResult) {
    options.onLlmFallback?.("AI parsing unavailable, used keyword matching");
    return heuristic;
  }

  // Merge: heuristic wins on explicit tokens; LLM fills in title cleanup
  const merged: ParsedIssue = {
    ...llmResult,
    // Heuristic explicit tokens always win
    labels: heuristic.labels.length > 0 ? heuristic.labels : llmResult.labels,
    assignee: heuristic.assignee ?? llmResult.assignee,
    dueDate: heuristic.dueDate ?? llmResult.due_date,
    // LLM title is used only if heuristic left explicit tokens
    title:
      heuristic.labels.length > 0 || heuristic.assignee || heuristic.dueDate
        ? llmResult.title || heuristic.title
        : heuristic.title,
  };

  return merged;
}

/** Returns true if an LLM API key is configured. */
export function hasLlmApiKey(): boolean {
  return detectProvider() !== null;
}
