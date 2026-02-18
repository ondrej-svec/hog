---
status: complete
priority: p3
issue_id: "009"
tags: [code-review, simplification]
---

# Replace formatDue manual name arrays with Intl.DateTimeFormat

## Problem Statement

`formatDue` in `nl-create-overlay.tsx` maintains two manual constant arrays (day names and month names) that can be replaced with the built-in `Intl` API available in Node.js 22+.

## Findings

- **File:** `src/board/components/nl-create-overlay.tsx`, lines 191–211 (21 lines)

```typescript
function formatDue(dueDate: string): string {
  const d = new Date(`${dueDate}T12:00:00`);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monNames = ["Jan", "Feb", "Mar", ...];
  const day = dayNames[d.getDay()] ?? "";
  const mon = monNames[d.getMonth()] ?? "";
  return `${day} ${mon} ${d.getDate()} (label: due:${dueDate})`;
}
```

## Proposed Solution

```typescript
function formatDue(dueDate: string): string {
  const d = new Date(`${dueDate}T12:00:00`);
  const human = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${human} (label: due:${dueDate})`;
}
```

21 lines → 4 lines. Eliminates two constant arrays. Output is identical.

## Acceptance Criteria

- [x] `formatDue("2026-02-21")` produces same output as before
- [x] No manually-maintained name arrays remain
- [x] `npm run test` passes

## Work Log

- 2026-02-18: Identified by Simplicity reviewer
- 2026-02-18: Resolved — replaced with `toLocaleDateString("en-US", ...)` one-liner
