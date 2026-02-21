---
status: pending
priority: p3
issue_id: "042"
tags: [code-review, architecture, scroll, config, ticktick]
dependencies: []
---

# Architecture P3: scroll mutation during render, ticktickError not surfaced, config migration side effects

## Problem Statement

Three lower-priority architectural issues that don't cause visible bugs today but create
maintenance hazards.

## Findings

**A — scrollRef mutation during render body (dashboard.tsx lines 664–682):**
```typescript
// Directly inside the render function — not in a hook or effect
const selectedRowIdx = flatRows.findIndex((r) => r.navId === nav.selectedId);
if (selectedRowIdx >= 0) {
  if (selectedRowIdx < scrollRef.current) {
    scrollRef.current = selectedRowIdx;        // ← mutation during render
  }
}
```
React's concurrent mode allows render functions to be invoked multiple times. Ref
mutations during render are technically allowed but create implicit ordering dependencies
within the render body. The scroll logic is also untestable in isolation.

**B — ticktickError not surfaced in board UI (dashboard.tsx):**
`DashboardData.ticktickError` is populated when TickTick fails to respond. The board
shows per-repo GitHub errors as inline messages, but `ticktickError` is never checked.
When TickTick is down, the tasks section silently shows nothing with no indication of why.

**C — loadFullConfig auto-saves during a read operation (config.ts lines 109–127):**
```typescript
export function loadFullConfig(): HogConfig {
  const raw = loadRawConfig();
  if (version < 3) {
    const migrated = migrateConfig(raw);
    saveFullConfig(migrated);   // ← write side effect in a read function
    return migrated;
  }
  // ...
}
```
If the config directory is read-only (network filesystem, restricted environment), or if
two processes call `loadFullConfig` simultaneously, this write side effect causes unexpected
failures. It also violates command-query separation.

## Proposed Solutions

**Fix A: Extract scroll into useScrollOffset hook**
```typescript
function useScrollOffset(
  selectedRowIdx: number,
  totalRows: number,
  viewportHeight: number,
): number {
  const scrollRef = useRef(0);
  // compute new offset from params (pure, no render-time mutation)
  const newOffset = computeOffset(selectedRowIdx, viewportHeight, scrollRef.current);
  scrollRef.current = newOffset;
  return newOffset;
}
```
This makes the logic testable and removes the implicit ordering dependency from the Dashboard render body.

**Fix B: Surface ticktickError as a toast or section warning**
```typescript
// In useData or dashboard.tsx — after data loads:
useEffect(() => {
  if (data?.ticktickError) {
    toast.error(`TickTick sync failed: ${data.ticktickError}`);
  }
}, [data?.ticktickError]);
```

**Fix C: Separate migration from load**
```typescript
// Make loadFullConfig a pure read — no writes
export function loadFullConfig(): HogConfig | { needsMigration: true; raw: unknown } { ... }

// Explicit migration step called at startup (e.g., in cli.ts or init flow)
export function migrateConfigIfNeeded(): void {
  const result = loadFullConfig();
  if ('needsMigration' in result) saveFullConfig(migrateConfig(result.raw));
}
```

**Effort:** Small (B), Medium (A, C)
**Risk:** Low

## Acceptance Criteria

- [ ] `ticktickError` displayed as a toast or section warning when TickTick fails
- [ ] Scroll offset computation extracted to a named helper (testable)
- [ ] `npm run ci` passes

## Work Log

- 2026-02-21: Identified by Architecture reviewer (R7, R8, R9).
