---
status: pending
priority: p3
issue_id: "012"
tags: [code-review, testing]
---

# No tests for src/ai.ts or src/clipboard.ts (80% coverage threshold at risk)

## Problem Statement

Two new source files have no test coverage:
- `src/ai.ts` (254 lines) — `parseHeuristic`, `extractIssueFields`, `hasLlmApiKey`
- `src/clipboard.ts` (17 lines) — `getClipboardArgs`

The project enforces 80% coverage threshold via `npm run test:coverage`. Adding untested files risks dropping below threshold.

## Findings

Key untested behaviors:
1. `parseHeuristic`: input with only tokens (no title) → returns null
2. `parseHeuristic`: chrono-node year-advance workaround for "Jan 15" parsed after Jan 16
3. `extractIssueFields`: merge strategy — heuristic wins on explicit tokens, LLM on title
4. `extractIssueFields`: LLM fallback when no API key set
5. `getClipboardArgs`: returns correct tool for darwin, win32, WSL, Wayland, X11, headless

## Proposed Solution

Create `src/ai.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { parseHeuristic, extractIssueFields } from "./ai.js";

describe("parseHeuristic", () => {
  it("returns null for empty title after stripping tokens", async () => {
    expect(await parseHeuristic("#bug @me")).toBeNull();
  });

  it("advances year for past dates with forwardDate", async () => {
    const jan16 = new Date("2026-01-16");
    const result = await parseHeuristic("fix bug due Jan 15", jan16);
    expect(result?.dueDate).toBe("2027-01-15"); // year advanced
  });

  it("extracts all tokens", async () => {
    const today = new Date("2026-02-18");
    const result = await parseHeuristic("fix login bug #bug @me due friday", today);
    expect(result?.title).toBe("fix login bug");
    expect(result?.labels).toContain("bug");
    expect(result?.assignee).toBe("me");
    expect(result?.dueDate).toBeTruthy();
  });
});
```

Create `src/clipboard.test.ts` for platform detection.

## Acceptance Criteria

- [ ] `src/ai.test.ts` covers happy path, empty-title null case, chrono year-advance bug workaround
- [ ] `src/clipboard.test.ts` covers darwin, win32, WSL, Wayland, X11, null cases
- [ ] `npm run test:coverage` still passes 80% threshold

## Work Log

- 2026-02-18: Identified by TypeScript reviewer
