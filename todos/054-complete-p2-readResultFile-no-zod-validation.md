---
status: pending
priority: p2
issue_id: "054"
tags: [code-review, typescript, pattern]
dependencies: []
---

# readResultFile Uses Direct Cast Instead of Zod Validation

## Problem Statement
`readResultFile` in `src/board/spawn-agent.ts` parses result files using `JSON.parse(...) as AgentResultFile` — a direct type cast with no schema validation. This is inconsistent with every other file-read in the codebase, which uses Zod `safeParse`.

## Findings
- **File:** `src/board/spawn-agent.ts` line 310
- **Evidence:** `JSON.parse(raw) as AgentResultFile` — direct cast, no Zod schema validation
- **Impact:** Corrupt, manually edited, or malformed result files pass through the type boundary without any validation, causing downstream failures with confusing error messages rather than a clean undefined return. Inconsistent with the established codebase pattern.

## Proposed Solutions
### Option A: Add Zod Schema and Use safeParse (Recommended)
Define a Zod schema for `AgentResultFile` and validate before returning:
```typescript
const AGENT_RESULT_FILE_SCHEMA = z.object({
  issueNumber: z.number(),
  repoName: z.string(),
  summary: z.string().optional(),
  // ... remaining fields
});

function readResultFile(filePath: string): AgentResultFile | undefined {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = AGENT_RESULT_FILE_SCHEMA.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
```
Malformed files return `undefined` cleanly, consistent with the rest of the codebase.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] Result file reading uses Zod `safeParse` with an explicit schema
- [ ] Malformed or invalid result files return `undefined` instead of a partial object
- [ ] Pattern is consistent with other file-read operations in the codebase

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
