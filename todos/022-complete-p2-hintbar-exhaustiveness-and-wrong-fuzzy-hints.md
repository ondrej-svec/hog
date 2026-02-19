---
status: pending
priority: p2
issue_id: "022"
tags: [code-review, ux, hint-bar, fuzzy-picker]
dependencies: []
---

# HintBar uses string.startsWith bypassing TypeScript exhaustiveness; wrong hints for fuzzy picker

## Problem Statement

Two related issues in `src/board/components/hint-bar.tsx`:

**Issue A — `startsWith("overlay:")` bypasses discriminated union exhaustiveness:**
```typescript
if (uiMode.startsWith("overlay:")) {
  return <Text color="gray">j/k:nav Enter:select Esc:cancel</Text>;
}
```
`UIMode` is a discriminated string union. Using `startsWith` means TypeScript won't warn if a new `overlay:` mode needs different hint text. This has already caused Issue B.

**Issue B — Wrong hints for fuzzy picker:**
The fuzzy picker uses `ArrowDown/ArrowUp` and `Ctrl-J/Ctrl-K` for list navigation (not `j/k`). But the generic overlay hint says `j/k:nav`. The fuzzy picker component already displays its own internal navigation hints, but the hint bar is showing contradictory information.

## Findings

- `src/board/components/hint-bar.tsx:46`: `uiMode.startsWith("overlay:")` — generic match
- `src/board/components/fuzzy-picker.tsx:111-122`: uses `key.downArrow`, `key.upArrow`, `key.ctrl && input === "j"`, `key.ctrl && input === "k"` — NOT bare j/k
- The hint bar shows `j/k:nav Enter:select Esc:cancel` for `overlay:fuzzyPicker` — the `j/k` part is wrong for fuzzy picker
- `UIMode` currently has 13 members; as the union grows, startsWith matches become harder to audit

## Proposed Solutions

### Option 1: Add overlay:fuzzyPicker specific case in hint bar

```typescript
if (uiMode === "overlay:fuzzyPicker") {
  return <Text color="gray">type to search  ↑/↓:nav  Ctrl-J/K:nav  Enter:jump  Esc:cancel</Text>;
}
if (uiMode.startsWith("overlay:")) {
  return <Text color="gray">j/k:nav  Enter:select  Esc:cancel</Text>;
}
```

**Pros:** Correct hints for fuzzy picker, minimal change
**Effort:** 10 minutes
**Risk:** None

### Option 2: Switch on all overlay modes explicitly

Replace `startsWith` with explicit cases for each overlay mode, each with mode-appropriate hints. TypeScript exhaustiveness checking will catch new modes.

**Pros:** Compiler-enforced accuracy
**Cons:** More verbose, must be updated for each new overlay
**Effort:** 30 minutes
**Risk:** Low

## Acceptance Criteria

- [ ] Fuzzy picker overlay shows correct navigation hints (arrows/Ctrl-J/K, not j/k)
- [ ] No regression in other overlay mode hints
- [ ] `npm run check` passes

## Work Log

- 2026-02-19: Identified by TypeScript reviewer and pattern-recognition-specialist.
