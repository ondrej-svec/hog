---
status: pending
priority: p3
issue_id: "059"
tags: [code-review, architecture]
dependencies: []
---

# Triage Overlay Phases Hardcoded Despite Configurable Architecture

## Problem Statement
`TRIAGE_PHASES` in `src/board/components/triage-overlay.tsx` is hardcoded to `["research", "plan", "review"]` despite the entire system being built around configurable phases. The triage overlay is inconsistent with the configurable-phases architecture on day one.

## Findings
- **File:** `src/board/components/triage-overlay.tsx`
- **Evidence:** `TRIAGE_PHASES` constant defined as a hardcoded array; no reference to workflow config
- **Impact:** Triage overlay is inconsistent with the configurable-phases architecture on day one

## Proposed Solutions
### Option A: Accept phases as a prop (Recommended)
Accept `phases: string[]` as a prop from the parent component, which already has config access.
- **Effort:** Small
- **Risk:** Low

### Option B: Derive from config
Derive phases from `board.workflow?.defaultPhases` within the component by reading config directly.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] Triage overlay uses configured phases, not hardcoded ones

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
