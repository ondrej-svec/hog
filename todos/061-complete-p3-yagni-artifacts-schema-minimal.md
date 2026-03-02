---
status: pending
priority: p3
issue_id: "061"
tags: [code-review, yagni]
dependencies: []
---

# YAGNI: Speculative Features in workflow-template.ts

## Problem Statement
Three speculative features in `src/workflow-template.ts` have no consumers and add unnecessary code surface: `AgentResultFile.artifacts` is always written as `[]` and never read; `$schema` field references a JSON Schema that does not exist; `minimal` built-in template is identical in behavior to having no workflow config at all.

## Findings
- **File:** `src/workflow-template.ts`
- **Evidence:** `artifacts` field always set to `[]`, never read anywhere; `$schema` URL resolves to nothing; `minimal` template adds no value over absence of config
- **Impact:** Unnecessary code surface, cognitive overhead for contributors

## Proposed Solutions
### Option A: Remove all three (Recommended)
Delete `artifacts` from `AgentResultFile`, remove `$schema` from the template schema, and remove `minimal` from `BUILTIN_TEMPLATES`. Add them back only when actually needed.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] `artifacts` field removed from `AgentResultFile`
- [ ] `$schema` field removed from template schema
- [ ] `minimal` template removed from `BUILTIN_TEMPLATES`

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-03-01 | Created | Code review PR #50 |
