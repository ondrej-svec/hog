---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, performance, react, biome]
---

# useKeyboard: dead `selectedRepoName` dep + duplicate `nav`/`nav.selectedId`

## Problem Statement

Two dependency array issues in `use-keyboard.ts`:

1. `selectedRepoName` is listed in the `useCallback` deps array but is **never read** inside `handleInput`. Biome flags this. It causes unnecessary callback recreation whenever the selected repo changes.
2. Both `nav` (the full object) and `nav.selectedId` (a property) appear in the deps array. Since `nav` is reconstructed on every render (plain object literal from `useNavigation`), `nav` in deps causes the callback to invalidate on every render — making `nav.selectedId` as a separate dep redundant.

## Findings

- **File:** `src/board/hooks/use-keyboard.ts`, lines 257–278
- `selectedRepoName` at line 271 — unused in the callback body
- `nav` at line 259 + `nav.selectedId` at line 274 — both listed, causing double-invalidation

## Resolution

Removed `selectedRepoName` from:
1. `UseKeyboardOptions` interface
2. Function body destructuring
3. `useCallback` deps array

Also removed `selectedRepoName: selectedItem.repoName` from the `useKeyboard({...})` call in `dashboard.tsx`.

## Acceptance Criteria

- [x] `npm run check` shows no new warnings for `use-keyboard.ts`
- [x] `selectedRepoName` removed from `UseKeyboardOptions` interface
- [x] Keyboard handler no longer recreated on every render tick

## Work Log

- 2026-02-18: Identified by TypeScript reviewer + Performance Oracle + Simplicity reviewer
- 2026-02-18: Fixed — `selectedRepoName` removed from interface, destructuring, deps array, and callsite
