---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, bug, react]
---

# LabelPicker: infinite fetch loop on persistent error

## Problem Statement

`LabelPicker`'s `useEffect` includes `labels` in its dependency array. On the error path, `labels` remains `null` and the component stays mounted (the `onError` callback only shows a toast). On the next render, `labels === null` is still true, triggering another fetch attempt. This creates an infinite fetch → error → toast → refetch loop when `gh label list` consistently fails.

## Findings

- **File:** `src/board/components/label-picker.tsx`, lines 33–46
- **Dependency array:** `[repo, labels, labelCache, onError]`
- **Problem:** `labels` starts as `null`, `onError` fires but does not unmount the overlay, so `labels` stays `null` → effect re-fires → infinite loop.

```typescript
useEffect(() => {
  if (labels !== null) return;  // won't stop loop — labels stays null on error
  setLoading(true);
  fetchRepoLabelsAsync(repo)
    .then((fetched) => {
      labelCache[repo] = fetched;
      setLabels(fetched);
      setLoading(false);
    })
    .catch(() => {
      setLoading(false);
      onError(`Could not fetch labels for ${repo}`);
      // labels stays null → effect re-fires on next render
    });
}, [repo, labels, labelCache, onError]);
```

## Proposed Solutions

### Option A — Remove `labels` from deps, add fetch-attempted guard (Recommended)

```typescript
const [fetchAttempted, setFetchAttempted] = useState(false);

useEffect(() => {
  if (labels !== null || fetchAttempted) return;
  setFetchAttempted(true);
  setLoading(true);
  let canceled = false;
  fetchRepoLabelsAsync(repo)
    .then((fetched) => {
      if (canceled) return;
      labelCache[repo] = fetched;
      setLabels(fetched);
      setLoading(false);
    })
    .catch(() => {
      if (canceled) return;
      setLoading(false);
      onError(`Could not fetch labels for ${repo}`);
    });
  return () => { canceled = true; };
}, [repo, fetchAttempted, labelCache, onError]);
```

**Pros:** Breaks the loop; adds cancellation token for unmount safety.
**Effort:** Small. **Risk:** Low.

### Option B — Have `onError` always close the overlay

If `onError` reliably unmounts the overlay, the loop never starts. But this is a tighter coupling between the error handler and overlay lifecycle.

**Pros:** Simpler `LabelPicker` code.
**Cons:** Requires callers to always close on error; not enforced by types.
**Effort:** Small. **Risk:** Low (but fragile contract).

## Recommended Action

Option A.

## Acceptance Criteria

- [ ] If `fetchRepoLabelsAsync` fails, no repeated calls are made
- [ ] Component unmount during fetch does not cause state update on unmounted component
- [ ] `npm run test` passes

## Work Log

- 2026-02-18: Identified by Performance Oracle
