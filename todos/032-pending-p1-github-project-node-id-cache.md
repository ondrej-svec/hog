---
status: pending
priority: p1
issue_id: "032"
tags: [code-review, performance, github, latency, graphql]
dependencies: []
---

# GitHub project node ID re-fetched on every status/date mutation (3 serial GraphQL calls)

## Problem Statement

Every status change and every due-date change executes **3 sequential GraphQL calls**:
1. Find the project item ID for the issue
2. Fetch the project's node ID (by project number) — **this never changes**
3. Run the actual mutation

Step 2 is a static lookup — the project node ID for a given `{owner}/{projectNumber}` is
immutable. Re-fetching it on every mutation adds 300–600ms of latency per operation
and wastes API quota. A single status change takes 900–1800ms of serial network time.

## Findings

**`src/github.ts` lines 530–625 (`updateProjectItemStatusAsync`):**
```typescript
// Step 1 — fetch item ID
const findResult = await runGhJsonAsync<GraphQLResult>([
  "api", "graphql", "-f", `query=${findItemQuery}`, ...
]);

// Step 2 — fetch project node ID (NEVER CHANGES — redundant on every call)
const projectResult = await runGhJsonAsync<GraphQLProjectResult>([
  "api", "graphql", "-f", `query=${projectQuery}`, ...
]);

// Step 3 — mutation
await runGhAsync(["api", "graphql", "-f", `query=${mutation}`, ...]);
```

The same 3-step pattern is duplicated in:
- `updateProjectItemDateAsync` (lines 636–728)
- `updateProjectItemStatus` sync version (lines 430–528)

That is ~300 lines of near-identical code for one algorithm.

Additionally, the 3-step pattern itself could be improved: steps 1 and 2 are independent
and could run in parallel.

## Proposed Solutions

### Option 1: Module-level project ID cache + extract shared helper (Recommended)

```typescript
// Module-level cache — project IDs are immutable
const projectNodeIdCache = new Map<string, string>();

async function getProjectNodeId(
  owner: string,
  projectNumber: number,
): Promise<string | null> {
  const key = `${owner}/${projectNumber}`;
  const cached = projectNodeIdCache.get(key);
  if (cached !== undefined) return cached;

  const result = await runGhJsonAsync<{ data: { organization: { projectV2: { id: string } } } }>([
    "api", "graphql", "-f", `query=...`, ...
  ]);
  const id = result.data?.organization?.projectV2?.id ?? null;
  if (id) projectNodeIdCache.set(key, id);
  return id;
}

// Shared helper used by all three mutators
async function findProjectItem(
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<{ itemId: string; projectId: string } | null> {
  const { owner, repoName } = parseRepo(repo);
  const [itemResult, projectId] = await Promise.all([
    findItemId(owner, repoName, issueNumber, projectNumber),
    getProjectNodeId(owner, projectNumber),
  ]);
  if (!itemResult || !projectId) return null;
  return { itemId: itemResult, projectId };
}
```

Then `updateProjectItemStatusAsync` and `updateProjectItemDateAsync` each become ~15 lines
instead of ~95 lines:
```typescript
export async function updateProjectItemStatusAsync(...): Promise<void> {
  const ctx = await findProjectItem(repo, issueNumber, projectNumber);
  if (!ctx) return;
  await runGhAsync(["api", "graphql", "-f", `query=${statusMutation(ctx, optionId)}`, ...]);
}
```

**Effort:** Medium (requires extracting the shared helpers)
**Risk:** Medium — the core mutation logic is critical; needs careful testing

### Option 2: Cache only, keep duplication

Add the `projectNodeIdCache` Map without extracting the full helper. Eliminates Step 2
latency (one of the 3 serial calls) with minimal refactoring risk.

Expected gain: ~33–50% latency reduction per mutation (one fewer 300–600ms network call).

**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] Project node ID cached after first fetch; subsequent calls skip Step 2
- [ ] Status and date mutations measurably faster (1 or 2 fewer network calls)
- [ ] Existing tests for `updateProjectItemStatusAsync` pass
- [ ] No regression in the board's mutation flow

## Work Log

- 2026-02-21: Identified by Performance Oracle (P1-A, P3-F), TypeScript reviewer (P3-06), Architecture reviewer.
