---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, security, type-safety]
---

# LLM response: unsafe as-cast + unvalidated due_date format

## Problem Statement

Two issues in `src/ai.ts`:

1. **Unsafe array cast** (lines 172, 178): LLM response arrays are typed with `as` without an `Array.isArray` guard. If the API returns an unexpected shape, the cast silently succeeds at the type level but may produce wrong values.

2. **Unvalidated `due_date`** (line 192): The LLM-returned `due_date` string is accepted verbatim. A misbehaving model could return an invalid date string, which would be appended as `due:<garbage>` and passed to `gh --label`, causing an API error.

## Findings

- **File:** `src/ai.ts`, lines 172–178, 192
- OpenRouter path: `json["choices"] as { message?: { content?: string } }[] | undefined` — no `Array.isArray` check
- Anthropic path: `json["content"] as { type: string; text?: string }[] | undefined` — same issue
- `due_date` at line 192: accepted if `typeof r["due_date"] === "string"` — any string passes

**Security reviewer:** Medium severity for prompt injection via `</input>` break-out (see related finding below). Low severity for `due_date` format — causes API error not injection.

## Proposed Solutions

### Fix 1 — Array.isArray guards before casting

OpenRouter:
```typescript
const choicesRaw = json["choices"];
if (!Array.isArray(choicesRaw)) return null;
const firstChoice = choicesRaw[0] as { message?: { content?: string } } | undefined;
const content = firstChoice?.message?.content;
if (!content) return null;
```

Anthropic:
```typescript
const contentRaw = json["content"];
if (!Array.isArray(contentRaw)) return null;
const firstItem = contentRaw[0] as { type: string; text?: string } | undefined;
const text = firstItem?.text;
if (!text) return null;
```

### Fix 2 — Validate due_date format

```typescript
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
due_date: typeof r["due_date"] === "string" && ISO_DATE_RE.test(r["due_date"])
  ? r["due_date"]
  : null,
```

### Fix 3 — Escape </input> in user message (Security, Low priority)

```typescript
const escapedText = userText.replace(/<\/input>/gi, "< /input>");
const userContent = `<input>${escapedText}</input>\n<valid_labels>${validLabels.join(",")}</valid_labels>`;
```

(Low urgency — single-user CLI, no third-party attack surface)

## Recommended Action

Implement all three fixes. Fix 1 and 2 are small and safe. Fix 3 is a defence-in-depth measure.

## Acceptance Criteria

- [ ] `Array.isArray` checks before casting LLM response arrays
- [ ] `due_date` format validated with ISO_DATE_RE before accepting
- [ ] `</input>` escape applied to user text before LLM call
- [ ] `npm run test` passes

## Work Log

- 2026-02-18: Identified by Security reviewer + TypeScript reviewer
