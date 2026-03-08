---
status: pending
priority: p3
issue_id: 012
tags: [code-review, architecture]
dependencies: [003, 004]
---

# Reduce OverlayRendererProps Surface Area

## Problem Statement

The overlay rendering section of dashboard.tsx passes ~94 properties through props. This makes the component interface unwieldy and hard to reason about. A command/context pattern would reduce prop drilling.

**Flagged by:** architecture-strategist

## Findings

- Overlay components receive massive props objects
- Many props are action callbacks that could go through a dispatch/context
- Related to dashboard extraction (003, 004) — should be done after those

## Proposed Solutions

### Option 1: React Context for shared dashboard state
- Create DashboardContext with state + dispatch
- Overlays consume context instead of receiving 94 props
- **Pros:** Eliminates prop drilling
- **Cons:** Context indirection
- **Effort:** Medium-Large
- **Risk:** Medium (large refactor surface)

### Option 2: Command pattern for actions
- Actions as a command map passed via single prop
- **Pros:** Single prop replaces many callbacks
- **Cons:** Less type-safe
- **Effort:** Medium
- **Risk:** Low

## Acceptance Criteria

- [ ] Overlay components don't receive 94+ individual props
- [ ] Clear, typed interface for overlay→dashboard communication

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-08 | Created from code review | Should follow dashboard extraction |
