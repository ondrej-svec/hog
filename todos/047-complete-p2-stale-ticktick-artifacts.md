---
status: pending
priority: p2
issue_id: "047"
tags: [code-review, cleanup]
dependencies: []
---

# Stale TickTick Artifacts After Removal Phase

## Problem Statement
3 files still contain TickTick references after the removal phase. These leave misleading UI text, dead code, and an incomplete removal in the codebase.

## Findings
- **File:** `src/board/components/help-overlay.tsx` line 38
- **Evidence:** `"Pick issue (assign + TickTick)"` — wrong help text after TickTick removal
- **Impact:** Users see incorrect description of the pick action

- **File:** `src/board/components/overlay-renderer.tsx` line 55
- **Evidence:** `"github" | "ticktick" | "mixed"` — dead union arm
- **Impact:** Dead code; dead union arm is unreachable and misleading

- **File:** `src/board/components/bulk-action-menu.tsx` lines 14, 24, 32
- **Evidence:** dead `"ticktick"` branch with unreachable menu items
- **Impact:** Dead code; unreachable menu items pollute the component

- **File:** `src/board/constants.ts` line 6
- **Evidence:** JSDoc mentions TickTick
- **Impact:** Misleading documentation

## Proposed Solutions
### Option A: Remove All TickTick References (Recommended)
Remove all `"ticktick"` union arms, update help text to `"Pick issue (assign to self)"`, clean JSDoc in constants.ts. The `multiSelectType` union can be simplified to `"github"` only or inlined entirely.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] `grep -ri ticktick src/` returns zero results
- [ ] Help overlay shows correct pick description: `"Pick issue (assign to self)"`
- [ ] `multiSelectType` is `"github"` only (or inlined)

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
