---
status: pending
priority: p1
issue_id: "028"
tags: [code-review, typescript, type-safety]
dependencies: []
---

# TypeScript unsound type casts and unguarded index access

## Problem Statement

Three related unsound TypeScript patterns that bypass the strict-mode guarantees
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`):

1. `undefined as T` in `api.ts` — lies to the compiler about the return type
2. Unguarded `split("/")` destructuring in `github.ts` — four sites crash if no `/` present
3. `as unknown as Record<string, unknown>` in `cli.ts` — suppresses valid type errors

## Findings

**A — `undefined as T` in api.ts:35**
```typescript
if (!text) return undefined as T;
```
Methods like `listTasks()` promise `Promise<Task[]>` but may silently return `undefined`.
Callers that skip a null-check will crash at runtime.

**B — Unguarded `split("/")` in github.ts**
```typescript
// Lines 218, 271, 535, 642
const [owner, repoName] = repo.split("/");
```
With `noUncheckedIndexedAccess`, `owner` and `repoName` are `string | undefined`.
All four call sites pass them directly into GraphQL template strings without guards.
If `repo` ever lacks a `/` separator (e.g., a config migration edge case), this crashes silently.

**C — Double cast in cli.ts:197,272**
```typescript
task: created as unknown as Record<string, unknown>
```
`Task` is a plain interface fully assignable to `Record<string, unknown>`. The double cast
hides the fact the types should be aligned. `printSuccess` should accept the data type properly.

## Proposed Solutions

### Option 1: Fix each site minimally (Recommended)

**For A:** Change `private async request<T>()` to return `Promise<T | null>` (or `Promise<T | undefined>`) and update return type annotations. For `completeTask`/`deleteTask` which are `void`, the cast is already fine — only data-returning methods need fixing.

**For B:** Add a shared `parseRepo()` helper:
```typescript
function parseRepo(repo: string): { owner: string; repoName: string } {
  const slash = repo.indexOf("/");
  if (slash === -1) throw new Error(`Invalid repo: ${repo}`);
  return { owner: repo.slice(0, slash), repoName: repo.slice(slash + 1) };
}
```
Replace the four destructuring sites.

**For C:** Change `printSuccess` signature to accept `unknown` instead of `Record<string, unknown>`, or just widen the specific call sites:
```typescript
// Remove the double cast — printSuccess already handles this
printSuccess(`Created: ${created.title}`, { task: created });
```

**Effort:** Small
**Risk:** Low — these are compile-time fixes; the runtime behavior is unchanged

### Option 2: Suppress with biome-ignore (Not Recommended)

Add `// biome-ignore` comments. This papers over the issues without fixing them.

## Acceptance Criteria

- [ ] `api.ts` `request<T>` no longer uses `undefined as T` — return type is nullable or throws
- [ ] `github.ts` split("/") sites guarded against missing separator
- [ ] `cli.ts` `as unknown as Record<string, unknown>` casts removed
- [ ] `npm run ci` passes (typecheck + check + tests)

## Work Log

- 2026-02-21: Identified by TypeScript reviewer (P1-01, P1-03, P1-04).
