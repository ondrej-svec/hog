# 024: CLI Code Simplifications (P3 - Nice-to-Have)

**Status:** Pending
**Priority:** P3 (Nice-to-Have)
**Issue ID:** 024
**Tags:** code-review, quality, simplification
**Created:** 2026-02-19

---

## Problem Statement

The CLI code contains several opportunities for simplification and refactoring:

1. **parseFrontMatter** in `src/cli.ts` is a 65-line YAML parser with Biome complexity ignores, duplicating existing libraries
2. **Status rendering** in `src/board/components/action-log.tsx` repeats statusPrefix/statusColor lookups instead of using a unified object
3. **Options interfaces** (IssueShowOptions, IssueMoveOptions, IssueCommentOptions) are structurally identical single-field interfaces that could be merged
4. **--dry-run on hog issue show** is meaningless for read-only operations and should be removed

These create maintenance burden and reduce code clarity without functional value.

---

## Findings

### 1. parseFrontMatter Complexity
- **Location:** `src/cli.ts` (~65 lines)
- **Current approach:** Hand-rolled YAML parser with regex-based delimiter detection
- **Issue:** Biome complexity warning → requires `// biome-ignore` comment; harder to maintain and test
- **Existing solutions:** `js-yaml` (1.8M weekly downloads) or Zod-based structured parsing

### 2. Status Display Duplication
- **Location:** `src/board/components/action-log.tsx`
- **Current approach:** Separate lookups for `statusPrefix` (strings) and `statusColor` (ink colors)
- **Issue:** Status-to-display-format mapping scattered; hard to update consistently
- **Ideal:** Single `STATUS_DISPLAY` object keyed by status string

### 3. Identical Options Interfaces
- **Location:** `src/cli.ts`
- **Current:**
  ```typescript
  interface IssueShowOptions { dryRun?: boolean; }
  interface IssueMoveOptions { dryRun?: boolean; }
  interface IssueCommentOptions { dryRun?: boolean; }
  ```
- **Issue:** Redundant type definitions; unclear they are intentionally identical
- **Solution:** Single `DryRunOptions` interface or generic `CommandOptions`

### 4. Meaningless --dry-run on Read Operations
- **Location:** `hog issue show` command definition
- **Issue:** Show is read-only; dry-run has no semantic meaning
- **Impact:** Confuses users; adds unnecessary option handling code

---

## Proposed Solutions

### Option A: Light-touch Refactoring (Recommended for P3)
1. Keep `parseFrontMatter` but extract it to `src/util/parse-frontmatter.ts` with better tests
2. Create `src/board/constants/status-display.ts` with unified `STATUS_DISPLAY` object
3. Merge options interfaces into single `DryRunOptions` type
4. Remove `--dry-run` from `hog issue show` command definition
5. Estimated effort: 2–3 hours

### Option B: Full-featured Refactoring
1. Replace `parseFrontMatter` with `js-yaml` or Zod structured parser
2. Refactor all status rendering to use centralized `STATUS_DISPLAY` with helper components
3. Create generic `CommandOptions` base type; extend as needed per command
4. Full removal of dry-run logic from read commands; audit all command signatures
5. Estimated effort: 4–5 hours; higher risk of regressions

---

## Acceptance Criteria

- [ ] `parseFrontMatter` extracted or replaced; no Biome complexity ignores remain
- [ ] `STATUS_DISPLAY` constant created; status rendering in action-log.tsx uses it consistently
- [ ] Options interfaces merged or unified; no duplicate single-field types remain
- [ ] `--dry-run` removed from `hog issue show`; tests updated
- [ ] All existing tests pass; no new coverage gaps
- [ ] Code review approved

---

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Initial findings and options. Ready for prioritization. |

---

## Related Issues

- See also: #026 (action-log.ts module-level counter), #027 (action-log persistence)

## References

- `src/cli.ts` — parseFrontMatter (lines ~XX–XX), command definitions
- `src/board/components/action-log.tsx` — status rendering logic
