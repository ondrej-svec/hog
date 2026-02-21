---
status: pending
priority: p2
issue_id: "037"
tags: [code-review, performance, react, ink, rendering]
dependencies: []
---

# Performance: 10-second tick re-renders entire Dashboard + findIndex in render body

## Problem Statement

Two related performance issues cause unnecessary re-render work on every keypress and
every 10-second tick:

1. A `setInterval` in `Dashboard` fires every 10 seconds solely to update the "Updated X min ago"
   header text, but triggers a full re-render of the entire Dashboard component tree.
2. `flatRows.findIndex()` runs as an O(n) linear scan inside the render body on every render,
   including the 10-second ticks.

## Findings

**A — 10-second tick in Dashboard (dashboard.tsx lines 432–436):**
```typescript
const [, setTick] = useState(0);
useEffect(() => {
  const id = setInterval(() => setTick((t) => t + 1), 10_000);
  return () => clearInterval(id);
}, []);
```
This state update lives in `Dashboard` itself, so every tick cascades down through:
`OverlayRenderer`, `RowRenderer` (×N rows), `DetailPanel`, `HintBar`, `ToastContainer`, `ActionLog`.
The only thing that actually changes is a color calculation in the header (`refreshAgeColor`).

**B — `flatRows.findIndex` in render body (dashboard.tsx line 665):**
```typescript
// Runs on EVERY render — ticks, toasts, keystrokes, overlay changes
const selectedRowIdx = flatRows.findIndex((r) => r.navId === nav.selectedId);
```
With 100 rows, this is 100 iterations per render. At 10 keypresses/second that's
1000 iterations/second for a scan that could be O(1).

**C — buildNavItems + buildFlatRows both recompute resolveStatusGroups+groupByStatus:**
Both functions (in separate `useMemo` blocks) call `resolveStatusGroups` and `groupByStatus`
independently. This doubles the grouping computation on every data refresh.

## Proposed Solutions

### Fix A: Isolate tick state into a tiny child component

```typescript
function RefreshAge({ lastRefresh }: { lastRefresh: Date | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  if (!lastRefresh) return null;
  return <Text color={refreshAgeColor(lastRefresh)}>Updated {timeAgo(lastRefresh)}</Text>;
}
```

The 10-second re-render is then confined to this single lightweight component.
Remove the `setTick` state from `Dashboard`.

**Effort:** Small | **Risk:** Low

### Fix B: Wrap findIndex in useMemo

```typescript
const selectedRowIdx = useMemo(
  () => flatRows.findIndex((r) => r.navId === nav.selectedId),
  [flatRows, nav.selectedId],
);
```

One line change, prevents O(n) scan on every unrelated re-render (toast dismissals, etc.).

**Effort:** Very small | **Risk:** Zero

### Fix C: Shared grouping useMemo

Extract the common grouping into a single `useMemo` and pass its results into both
`buildNavItems` and `buildFlatRows`. Halves grouping CPU on data-refresh renders.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] 10-second tick no longer triggers full Dashboard re-render (isolated to `RefreshAge`)
- [ ] `flatRows.findIndex` is wrapped in `useMemo`
- [ ] Board renders visually correctly (header still updates, selection still tracked)
- [ ] `npm run test` passes (update `dashboard.test.tsx` if needed)

## Work Log

- 2026-02-21: Identified by Performance Oracle (P2-C, P2-D, P2-A, P3-B).
