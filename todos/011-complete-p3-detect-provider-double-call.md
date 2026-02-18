---
status: pending
priority: p3
issue_id: "011"
tags: [code-review, simplification]
---

# ai.ts: detectProvider called twice (in extractIssueFields and inside callLLM)

## Problem Statement

`extractIssueFields` calls `detectProvider()` at line 224 to decide whether to call `callLLM`. Then `callLLM` calls `detectProvider()` again internally at line 102. The result is always identical (env vars don't change mid-execution). This is a double call with no benefit.

## Findings

- **File:** `src/ai.ts`, lines 102–103 and 224

## Proposed Solution

Pass `providerConfig` into `callLLM` instead of having it re-detect:

```typescript
async function callLLM(
  userText: string,
  validLabels: string[],
  today: Date,
  providerConfig: { provider: "openrouter" | "anthropic"; apiKey: string },
): Promise<LLMResult | null> {
  // remove the detectProvider() call at the top
  const { provider, apiKey } = providerConfig;
  // ...rest unchanged
}

// In extractIssueFields:
const providerConfig = detectProvider();
if (!providerConfig) return heuristic;
const llmResult = await callLLM(input, options.validLabels ?? [], today, providerConfig);
```

This also makes `callLLM` a purer function, easier to test.

## Acceptance Criteria

- [ ] `detectProvider` called once per `extractIssueFields` invocation
- [ ] `callLLM` signature updated
- [ ] `npm run test` passes

## Work Log

- 2026-02-18: Identified by Simplicity reviewer
