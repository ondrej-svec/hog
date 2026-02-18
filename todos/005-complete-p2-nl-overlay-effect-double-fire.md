---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, react, performance]
---

# NlCreateOverlay: useEffect deps allow double-LLM-call during parse

## Problem Statement

The `useEffect` that drives NL parsing has `selectedRepo`, `labelCache`, and `onLlmFallback` in its deps. Since `labelCache` is a mutable object mutated in place (not replaced by reference), its dep entry is misleading — changes to it won't trigger a re-run. But `onLlmFallback` is a function that may not be stable, and if the parent re-renders while `isParsing === true` and passes a new function reference for `onLlmFallback`, the effect re-fires and calls `extractIssueFields` a second time — potentially triggering two LLM calls concurrently.

## Findings

- **File:** `src/board/components/nl-create-overlay.tsx`, line 106
- **Dependency array:** `[isParsing, input, selectedRepo, labelCache, onLlmFallback]`
- Intent is: "fire once when `isParsing` flips to `true`"
- Problem: unstable `onLlmFallback` can cause double-fire while still parsing

## Proposed Solutions

### Option A — Capture context at submit time via ref (Recommended)

```typescript
const parseParamsRef = useRef<{
  validLabels: string[];
  onLlmFallback: ((msg: string) => void) | undefined;
} | null>(null);

const handleInputSubmit = useCallback((text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return;
  const validLabels = selectedRepo
    ? (labelCache[selectedRepo.name] ?? []).map((l) => l.name)
    : [];
  parseParamsRef.current = { validLabels, onLlmFallback };
  setInput(trimmed);
  setParseError(null);
  setIsParsing(true);
}, [selectedRepo, labelCache, onLlmFallback]);

useEffect(() => {
  if (!isParsing || !parseParamsRef.current) return;
  const { validLabels, onLlmFallback: fallback } = parseParamsRef.current;
  extractIssueFields(input, { validLabels, onLlmFallback: fallback })
    .then(...)
}, [isParsing, input]);  // only isParsing and input needed
```

**Pros:** Eliminates spurious re-fires; aligns with "fire once on flag" pattern.
**Effort:** Medium. **Risk:** Low.

### Option B — Memoize `onLlmFallback` at the call site

Wrap the callback in `useCallback` in `dashboard.tsx` to stabilize the reference. The effect still has the conceptual issue but the practical bug doesn't manifest.

**Pros:** Minimal change.
**Cons:** Fragile — any future caller that doesn't memoize can reintroduce the bug.
**Effort:** Small. **Risk:** Low but brittle.

## Recommended Action

Option A — capture context at submit time.

## Acceptance Criteria

- [x] `extractIssueFields` is called at most once per user input submission
- [x] LLM API is not called twice for a single input
- [x] `npm run test` passes

## Work Log

- 2026-02-18: Identified by TypeScript reviewer + Performance Oracle
- 2026-02-18: Resolved — implemented Option A with `parseParamsRef`; useEffect deps reduced to `[isParsing, onLlmFallback]`
