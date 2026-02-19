---
title: "hog UX Leap: From Good to Great"
type: feat
status: active
date: 2026-02-19
brainstorm: docs/brainstorms/2026-02-19-hog-ux-leap-brainstorm.md
deepened: 2026-02-19
---

# hog UX Leap: From Good to Great

## Enhancement Summary

**Deepened on:** 2026-02-19
**Research agents:** codebase architecture, fuzzy search algorithms, undo/action log patterns, $EDITOR TUI integration, CLI design patterns

### Key Improvements Discovered

1. **Fuzzy picker should use `fzf-for-js`** — the hand-rolled substring-gap algorithm in the original plan produces poor ranking. `fzf`'s affine-gap scoring with word-boundary bonuses gives vastly better results for issue titles; multi-field search needs separate Fzf instances per field merged by max-weighted score.
2. **`setRawMode(true)` belongs in `finally`** — the existing `comment-input.tsx` and `nl-create-overlay.tsx` have a subtle bug where a `spawnSync` `ENOENT` leaves the terminal in cooked mode. The new `edit-issue-overlay.tsx` must fix this pattern.
3. **Undo thunk must be cleared _before_ execution** — not after success. Clearing after prevents the "double-undo" window but a failed undo still leaves the cleared entry, which is the right UX (don't allow retrying an undo that failed).
4. **Most `ENTER_*` reducers guard on `state.mode !== "normal"`** — the new `overlay:fuzzyPicker` and `overlay:editIssue` follow this same guard; verified against the FSM source.
5. **Overlay keyboard is handled inside the component** — `useKeyboard`'s main `useInput` call is inactive during overlay modes; each overlay must register its own `useInput`.
6. **`VISUAL || EDITOR || "vi"`** (falsy check) is more correct than `??` for detecting empty-string env vars; fix this in `edit-issue-overlay.tsx`.

### New Risks Discovered

| Risk | Mitigation |
|---|---|
| `fzf-for-js` adds a dependency | Accept: the library is well-maintained, ~5KB, TypeScript-native; hand-rolled algo would be worse |
| Arrow keys vs j/k conflict in fuzzy picker | Use `ArrowDown`/`ArrowUp` + `Ctrl-J`/`Ctrl-K` for list nav; `j`/`k` are printable and would append to the query |
| Undo thunk closes over stale issue state | Capture `previousOptionId` synchronously before the await — already in the plan but critical to get right |
| Editor ENOENT leaves terminal in cooked mode | Move `setRawMode(true)` to `finally` in `edit-issue-overlay.tsx` |
| `overlay:help` is `helpVisible` not a UIMode | `HelpOverlay` is gated on the boolean flag; no UIMode entry needed; do not add `overlay:help` as a mode |

---

## Overview

Seven targeted UX improvements that remove the moments where users leave hog and open a browser
instead. Each feature is grounded in either `lazygit`/`gh-dash` inspiration (brainstorm) or direct
codebase analysis of current gaps. The architecture needed for these features is already in place:
`OverlayRenderer`, `use-keyboard`, `ink-instance.ts`, `clipboard.ts`, `ai.ts`, `label-picker.tsx`,
and `nl-create-overlay.tsx` were all built in the previous plan.

---

## Problem Statement

Users leave hog and open the browser for three reasons:

1. **Can't find** the issue they have in mind quickly enough
2. **Can't read it fully** — comments are missing from the detail panel
3. **Can't trust what just happened** — no undo, no action log

Plus two "friction" gaps:
- The status bar shows a **wall of text** with all shortcuts concatenated — impossible to scan
- There is **no full issue editing** without the browser (title, body, labels, assignee all require leaving)

And a platform gap:
- **Agents and scripts can't drive hog mutations** — no CLI counterparts for board actions

---

## Proposed Solution

Four phases, from quick wins to platform completeness:

| Phase | Features | Complexity |
|---|---|---|
| 1 — Quick Wins | `t` toggle, hint bar, comments in detail panel | Low |
| 2 — Core UX | Fuzzy issue picker (`F`) | Medium |
| 3 — Power Features | Action log + undo, full issue edit via `$EDITOR` | High |
| 4 — Platform | CLI parity commands | Medium |

---

## Technical Approach

### Architecture: What Already Exists

The previous plan (`2026-02-18-feat-board-ux-nl-issue-creation-plan.md`) built and shipped the
foundational infrastructure. These are **not** tasks for this plan:

- `src/board/hooks/use-keyboard.ts` — extracted `useInput` handlers with `KeyboardActions` interface
- `src/board/components/overlay-renderer.tsx` — `OverlayRenderer` component, renders the active overlay
- `src/board/ink-instance.ts` — module-level Ink instance ref for `$EDITOR` integration
- `src/clipboard.ts` — cross-platform clipboard utility
- `src/ai.ts` — heuristic + optional LLM extraction
- `src/board/components/label-picker.tsx` — multi-select overlay with async lazy-load pattern
- `src/board/components/nl-create-overlay.tsx` — $EDITOR integration for body editing (canonical pattern)
- `src/board/components/comment-input.tsx` — `ctrl+e` → $EDITOR pattern (canonical pattern)

### Adding a New Overlay (Standard Pattern)

All new overlays follow the same 7-step pattern:

1. Add `"overlay:*"` to `UIMode` union in `use-ui-state.ts` (line 5)
2. Add `ENTER_*` to `UIAction` union and a reducer case in `uiReducer`
3. Add `enter*` callback to `UseUIStateResult` and hook return
4. Add to `canAct`/`isOverlay` helpers as needed
5. Add prop + render branch to `overlay-renderer.tsx`
6. Add keyboard binding in `use-keyboard.ts` `KeyboardActions` interface and `handleInput`
7. Wire callback from `dashboard.tsx` into `useKeyboard()`

> **Critical: Overlay keyboard handling.** `useKeyboard`'s main `useInput` call is inactive when
> `mode` is any overlay. Each new overlay component must register its own `useInput` for internal
> navigation (j/k, Enter, Escape). This is the pattern used by `CommentInput`, `LabelPicker`,
> `StatusPicker`, etc.

> **Critical: `ENTER_*` reducer guards.** Most reducers guard on `state.mode !== "normal"` and
> silently return state otherwise. New overlays that should only open from normal mode follow this.
> The only exception is `ENTER_STATUS` which also accepts `"overlay:bulkAction"` as a source.

> **Critical: `helpVisible` is NOT a UIMode.** `HelpOverlay` is gated on a boolean flag
> (`helpVisible`), not on `mode === "overlay:help"`. `TOGGLE_HELP` flips the flag without
> changing `mode`. Do NOT add `overlay:help` as a UIMode — it is not one at runtime.

### Key Bindings: Conflicts and Resolutions

| Key | Current | This Plan | Resolution |
|---|---|---|---|
| `F` (shift+f) | unbound | Fuzzy picker | Safe — use `F` |
| `f` (lowercase) | `handleEnterFocus` | — | No change |
| `t` | unbound | My issues toggle | Safe |
| `e` | unbound in normal mode | Full issue edit | Safe |
| `u` | `handleUnassign` | Undo last action | **Repurpose**: remove `u`=unassign; undo of an assign action = unassign. Unassign accessible via action log undo. |
| `L` (shift+l) | unbound | Toggle action log | Safe |

> **`u` repurpose rationale:** The action log records every assign/unassign. Pressing `u` to undo the
> last assign is functionally equivalent to the previous `u`=unassign shortcut, but more general and
> composable. The `help-overlay.tsx` SHORTCUTS array must be updated to reflect this.

---

## Implementation Phases

### Phase 1: Quick Wins

**No new UIMode required for `t` toggle or hint bar. `overlay:comments` needed for detail panel.**

---

#### 1.1 My Issues Toggle (`t` key)

**What:** Single-keystroke filter: toggle between all issues ↔ issues assigned to `config.board.assignee`.

**How:**

- Add `useState<boolean>(false)` → `mineOnly` in `Dashboard`
- Filter `allRepos` in `useMemo` (the existing `filteredRepos` memo, alongside `searchQuery`) using:
  ```typescript
  repo.issues.filter(issue =>
    issue.assignees?.some(a => a.login === config.board.assignee)
  )
  ```
  Note: `config.board.assignee` is available in `Dashboard` (already used at line ~907).
- Bind `t` in `use-keyboard.ts` inside `ui.canAct` block — add `handleToggleMine` to `KeyboardActions`
- Show active state in status bar: append `filter: @me` (similar to `searchQuery` display at line ~959)
- Clears on `R` (full refresh resets state) — natural because `mineOnly` is component `useState`

**Files:**
- `src/board/components/dashboard.tsx` — add `mineOnly` state, update `filteredRepos` memo, pass `handleToggleMine` to `useKeyboard`
- `src/board/hooks/use-keyboard.ts` — add `handleToggleMine` to `KeyboardActions`, bind `t`

**Acceptance criteria:**
- [ ] `t` toggles between all issues and issues where `assignees.some(a.login === config.board.assignee)`
- [ ] Status bar shows `filter: @me` when active
- [ ] `t` again clears the filter
- [ ] Filter composes with `/` search (both can be active simultaneously)
- [ ] Works with `searchQuery` — both filters apply to the same `filteredRepos` memo
- [ ] `R` (refresh) clears `mineOnly` (state reset via re-mount)
- [ ] `t` in overlay/search/multiSelect/focus mode: no-op (guarded by `ui.canAct`)

---

#### 1.2 Persistent Context Hint Bar

**What:** Replace the current wall-of-text status bar with a mode-aware 1-line hint showing 4–6 relevant keys for the current mode.

**Current state (line 956–957 of `dashboard.tsx`):**
```
j/k:nav Tab:section Enter:open Space:select /:search p:pick c:comment m:status
a/u:assign s:slack y:copy l:labels n:new I:nlcreate C:collapse f:focus ?:help q:quit
```

**Target state:**
```
normal:      [j/k] nav  [Enter] open  [m] status  [c] comment  [F] find  [t] @me  [?] more
search:      [type] filter  [Enter] confirm  [Esc] clear
multiSelect: [Space] toggle  [Enter] bulk  [Esc] cancel  [2 selected]
focus:       Focus mode — [Esc] exit
overlay:*:   [j/k] nav  [Enter] select  [Esc] cancel
```

**How:**

- Extract the status bar `<Box>` into a `HintBar` component:
  ```
  src/board/components/hint-bar.tsx
  ```
  Props: `uiMode: UIMode`, `multiSelectCount: number`, `searchQuery: string`, `mineOnly: boolean`
- `HintBar` returns a single-row `<Box>` with mode-appropriate hint text
- Also show current mode label badge for non-normal modes: `[MULTI-SELECT]`, `[SEARCH]`, `[FOCUS]`
- `CHROME_ROWS` remains `4` — the hint bar replaces (not adds to) the existing status bar row
- Update `help-overlay.tsx` SHORTCUTS to match current keybindings (add `F`, `t`, `e`, `L`, update `u`)

**Files:**
- `src/board/components/hint-bar.tsx` — new component
- `src/board/components/dashboard.tsx` — replace status bar inline JSX with `<HintBar />`
- `src/board/components/help-overlay.tsx` — update SHORTCUTS to include new keys

**Acceptance criteria:**
- [ ] Normal mode shows 6–8 most common shortcuts (not a wall of all shortcuts)
- [ ] Search mode shows search-specific hints
- [ ] MultiSelect mode shows selection count + selection actions
- [ ] Focus mode shows `Focus mode — [Esc] exit`
- [ ] Overlay modes show `[j/k] nav  [Enter] select  [Esc] cancel`
- [ ] `filter: @me` and `filter: "query"` indicators still appear in the bar
- [ ] Total terminal rows consumed is unchanged (`CHROME_ROWS = 4`)
- [ ] Help overlay SHORTCUTS updated with all current keybindings

---

#### 1.3 Comments in Detail Panel

**What:** Show last 5 comments below the issue body in the detail panel (right pane, visible at width ≥ 120).

**Fetch timing:** Lazy — triggered on explicit `Tab` or `Enter` while the detail panel is visible for the selected issue. Zero `gh` calls while just browsing.

**How:**

Add to `github.ts`:
```typescript
// Async — called lazily from detail panel
export async function fetchIssueCommentsAsync(
  repo: string,
  issueNumber: number,
): Promise<IssueComment[]>
```
Where `IssueComment` is:
```typescript
interface IssueComment {
  readonly body: string;
  readonly author: { readonly login: string };
  readonly createdAt: string;
}
```
Uses `runGhJsonAsync("gh", ["issue", "view", `${issueNumber}`, "--repo", repo, "--json", "comments"])`.

**Caching:** Add a comment cache ref in `Dashboard` (same pattern as `labelCacheRef`):
```typescript
const commentCacheRef = useRef<Record<string, IssueComment[] | "loading" | "error">>({});
```
Key: `${repo}:${issueNumber}`.

**`DetailPanel` extension:** Pass a `fetchComments` callback:
```typescript
fetchComments: (repo: string, issueNumber: number) => void;
commentsState: IssueComment[] | "loading" | "error" | null;
```
`DetailPanel` calls `fetchComments` inside a `useEffect` when the selected issue changes and the panel is visible. The panel renders:

```
─── Comments (3) ─────────────────────
@alice · 2h ago
  Confirmed on staging. The redirect...

@bob · 30m ago
  Fixed in PR #89, awaiting review.
```

Loading state: `fetching comments...` in dimmed text.

**Files:**
- `src/github.ts` — add `fetchIssueCommentsAsync`
- `src/types.ts` — add `IssueComment` interface
- `src/board/components/detail-panel.tsx` — add comments section with lazy load
- `src/board/components/dashboard.tsx` — add `commentCacheRef`, pass `fetchComments` + `commentsState` to `DetailPanel`

**Acceptance criteria:**
- [ ] Detail panel shows comments section when `width >= 120` (same condition as rest of panel)
- [ ] Comments are NOT fetched while browsing — only fetched when panel is visible for the focused issue
- [ ] Loading state shows `fetching comments...` in dimmed text
- [ ] Fetched comments cached in `commentCacheRef` — no re-fetch on re-select of same issue
- [ ] Shows last 5 comments (newest last), formatted as `@author · Xh ago\n  body...`
- [ ] Error state shows `could not load comments` in red
- [ ] Empty comments (0) shows `No comments yet.` in dimmed text
- [ ] Issue with no detail panel visible (narrow terminal): no `gh` call triggered

---

### Phase 2: Fuzzy Issue Picker (`F` key)

**What:** Telescope-style overlay showing all issues across all repos currently in memory. Type to fuzzy-filter. Navigate with arrow keys. `Enter` jumps the board cursor to that issue.

**New UIMode:** `"overlay:fuzzyPicker"`

**New dependency:** `fzf` (npm: `fzf-for-js`) — TypeScript-native port of fzf's affine-gap scoring algorithm. ~5KB, no transitive dependencies. Install: `npm install fzf`.

> **Why `fzf-for-js` over a hand-rolled algorithm:** fzf's algorithm scores consecutive character
> matches higher than scattered matches, and applies word-boundary bonuses (match after `/`, `-`,
> space). This produces dramatically better rankings for issue titles: typing "lgnbug" surfaces
> "Fix login bug" correctly, while a simple substring-gap filter would rank it the same as
> "Refactoring algebra bug fix". The `positions` property also enables match highlighting without
> extra work.

**How:**

**Data:** Uses `buildFlatRows()` data already in memory — zero extra `gh` calls. Extract all `BoardIssue`-type rows from the flat list:
```typescript
const allIssues = flatRows.filter(row => row.type === "issue");
```

**Fuzzy algorithm:** Use separate `Fzf` instances per searchable field, merged by max-weighted score:

```typescript
import { Fzf, type FzfResultItem } from "fzf";

// Build once when issue list changes (useMemo with allIssues as dep)
const fuzzyIndex = useMemo(() => ({
  byTitle: new Fzf(allIssues, { selector: i => i.title, casing: "smart-case" }),
  byRepo:  new Fzf(allIssues, { selector: i => i.repo,  casing: "smart-case" }),
  byNum:   new Fzf(allIssues, { selector: i => `#${i.number}`, casing: "case-insensitive" }),
  byLabel: new Fzf(allIssues, { selector: i => i.labels.join(" "), casing: "smart-case" }),
}), [allIssues]);

// Search on each keystroke (useMemo with query as dep)
const results = useMemo(() => {
  if (!query) return allIssues.slice(0, 20);  // empty query: show first 20
  const WEIGHTS = { title: 1.0, repo: 0.6, num: 2.0, label: 0.5 };
  const scoreMap = new Map<number, { item: Issue; score: number }>();
  function upsert(hits: FzfResultItem<Issue>[], w: number) {
    for (const h of hits) {
      const s = h.score * w;
      const e = scoreMap.get(h.item.number);
      if (!e || s > e.score) scoreMap.set(h.item.number, { item: h.item, score: s });
    }
  }
  upsert(fuzzyIndex.byTitle.find(query), WEIGHTS.title);
  upsert(fuzzyIndex.byRepo.find(query),  WEIGHTS.repo);
  upsert(fuzzyIndex.byNum.find(query),   WEIGHTS.num);
  upsert(fuzzyIndex.byLabel.find(query), WEIGHTS.label);
  return [...scoreMap.values()].sort((a, b) => b.score - a.score).map(e => e.item);
}, [fuzzyIndex, query]);
```

**Performance:** Index builds in `useMemo` tied to `allIssues` — rebuilds only on data refresh, not on each keystroke. `fzf.find()` over 500 items takes < 1ms. Only render visible rows (12–15) for Ink performance.

**Keyboard navigation:** Arrow keys and Ctrl-J/K for list navigation — **not j/k** (j and k are printable and would be appended to the query). Reset cursor to 0 on every query change.

```typescript
// Inside FuzzyPicker component's useInput:
if (key.downArrow || (key.ctrl && input === "j")) setCursor(c => Math.min(c+1, results.length-1))
if (key.upArrow   || (key.ctrl && input === "k")) setCursor(c => Math.max(c-1, 0))
if (key.return)  onSelect(results[cursor])
if (key.escape)  onClose()
// All other keys handled by TextInput component
```

**Scroll-follow pattern:**
```typescript
const VISIBLE = Math.min(process.stdout.rows - 4, 15);
setScrollOffset(prev => keepCursorVisible(newCursor, prev, VISIBLE));

function keepCursorVisible(cursor: number, offset: number, visible: number): number {
  if (cursor < offset) return cursor;
  if (cursor >= offset + visible) return cursor - visible + 1;
  return offset;
}
```

**Match highlighting:** `fzf-for-js` returns matched character positions via `result.positions`. Use to render matched chars in a distinct color without extra computation.

**Row format:**
```
repo/name · #42 · Fix login bug · [bug] [priority:high] · @alice
```

**Component:** `src/board/components/fuzzy-picker.tsx`
- `TextInput` for the query (same as `SearchBar` pattern — `@inkjs/ui TextInput`)
- Filtered + sorted results list (max 20 shown, VISIBLE rows rendered)
- Arrow + Ctrl-J/K internal navigation with its own `useInput`
- `Enter`: calls `onSelect(issueId)` → `Dashboard` calls `nav.select(issueId)` and exits the overlay
- `Escape`: returns to normal mode

**State machine addition:**
```
normal
  │ F (shift+f)
  ▼
overlay:fuzzyPicker
  │ Enter → nav.select(id) → normal
  │ Escape → normal
```

**Files:**
- `src/board/hooks/use-ui-state.ts` — add `overlay:fuzzyPicker` mode, `ENTER_FUZZY_PICKER` action
- `src/board/hooks/use-keyboard.ts` — add `handleEnterFuzzyPicker` to `KeyboardActions`, bind `F`
- `src/board/components/fuzzy-picker.tsx` — new component
- `src/board/components/overlay-renderer.tsx` — add `fuzzyPickerProps` and render branch
- `src/board/components/dashboard.tsx` — wire `handleEnterFuzzyPicker`, pass `allIssues` + `onSelect`
- `src/board/components/hint-bar.tsx` — add `overlay:fuzzyPicker` hint
- `package.json` — add `fzf` dependency

**Acceptance criteria:**
- [ ] `F` opens the fuzzy picker from normal mode
- [ ] `F` in overlay/search/multiSelect/focus: no-op (guarded by `ui.canAct`)
- [ ] Picker shows all issues across all repos currently loaded — no extra `gh` calls
- [ ] Typing filters using `fzf-for-js` on title + repo + number + labels, weighted by field
- [ ] Results ranked by match quality; `#123` queries surface exact issue number first
- [ ] `fuzzyIndex` built in `useMemo` tied to `allIssues` (not query) — no index rebuild on keystroke
- [ ] Only visible rows rendered (12–15); cursor scrolls to follow selection
- [ ] Arrow keys / Ctrl-J/K navigate the results list (not j/k — those are query input)
- [ ] `Enter` on a result: board cursor jumps to that issue, picker closes
- [ ] `Escape`: picker closes, returns to normal mode, board cursor unchanged
- [ ] Cursor resets to 0 on every query change
- [ ] Row format: `repo/name · #N · title · [label1] [label2] · @assignee`
- [ ] Empty query: show first 20 issues (unsorted)
- [ ] No results: show `No issues match "<query>"`

---

### Phase 3: Power Features

#### 3.1 Action Log + Undo

**What:** Collapsible bottom-left pane showing the last 5 mutations. `u` undoes the last reversible action.

**Key design decisions (from brainstorm):**
- Pane toggled with `L` (shift+l); collapsed by default; auto-expands on error
- Only status changes and assign/unassign are undoable (comments and creates are not)
- `u` repurposed from `handleUnassign` to `handleUndo`

**Data model:**
```typescript
interface ActionLogEntry {
  readonly id: string;           // nanoid
  readonly description: string;  // "✓ #42 moved → In Progress"
  readonly status: "success" | "error" | "pending";
  readonly ago: number;          // Date.now() timestamp for relative display
  readonly undo?: () => Promise<void>;  // undefined = not undoable
  readonly retry?: () => void;          // only on error entries with a retry action
}
```

**New hook:** `src/board/hooks/use-action-log.ts`
```typescript
useActionLog(toast: ToastAPI, refresh: () => void) → {
  entries: ActionLogEntry[];
  pushEntry: (entry: ActionLogEntry) => void;
  undoLast: () => Promise<void>;
  hasUndoable: boolean;
}
```

> **Critical implementation details from research:**
>
> 1. **Capture inverse synchronously before the async mutation.** The `previousOptionId` must be
>    read from the issue object _before_ any await. The undo thunk closes over this captured value.
>
> 2. **Push entry only on mutation success.** A failed mutation gets an error entry (no undo thunk).
>    Do not push a success entry with an undo thunk before knowing the mutation succeeded.
>
> 3. **Clear undo thunk _before_ execution** (not after). This prevents double-undo during the
>    async window. If the undo itself fails, the thunk is already cleared — user sees the error
>    toast and must handle the state manually (a `refresh()` call corrects optimistic state).
>
> 4. **`entriesRef` pattern required.** `undoLast` must read current entries without having them
>    as a `useCallback` dependency (that would cause keyboard binding instability). Use the
>    same stable-ref pattern as `use-actions.ts` (`configRef`, `reposRef`, etc.).
>
> 5. **Auto-expand via `useEffect` in Dashboard** watching the `entries` array:
>    ```typescript
>    useEffect(() => {
>      const last = entries[entries.length - 1];
>      if (last?.status === "error") setLogVisible(true);
>    }, [entries]);
>    ```
>    This avoids threading an `onError` callback through `use-actions.ts`.
>
> 6. **Linear undo only.** No branching, no redo. GitHub issues have multiple concurrent editors;
>    a branching history would reference state that no longer exists on the server.

**`undoLast` implementation pattern:**
```typescript
const undoLast = useCallback(async () => {
  const undoable = [...entriesRef.current].reverse().find(e => e.undo);
  if (!undoable?.undo) { toast.info("Nothing to undo"); return; }
  const thunk = undoable.undo;
  // Clear BEFORE execution to prevent double-undo window
  setEntries(prev => prev.map(e => e.id === undoable.id ? { ...e, undo: undefined } : e));
  const t = toast.loading(`Undoing: ${undoable.description}`);
  try {
    await thunk();
    t.resolve(`Undone: ${undoable.description}`);
  } catch (err) {
    t.reject(`Undo failed: ${err instanceof Error ? err.message : String(err)}`);
    refresh(); // Force re-fetch to replace stale optimistic state
  }
}, [toast, refresh]);
```

**Integration with `use-actions.ts`:**

For each undoable action, capture the inverse before executing:

```typescript
// In handleStatusChange — before mutation:
const previousOptionId = ctx.statusOptions.find(
  o => o.name === ctx.issue.projectStatus
)?.id;

const undoThunk = previousOptionId ? async () => {
  mutateData(data => optimisticSetStatus(data, repoName, issue.number, statusOptions, previousOptionId));
  await updateProjectItemStatusAsync(repoName, issue.number, {
    projectNumber: repoConfig.projectNumber,
    statusFieldId: repoConfig.statusFieldId,
    optionId: previousOptionId,
  });
} : undefined;

// Push AFTER mutation succeeds:
.then(() => {
  pushEntry({ id: nanoid(), description: `#${n} → ${newStatusName}`,
    status: "success", ago: Date.now(), undo: undoThunk });
})
.catch(() => {
  pushEntry({ id: nanoid(), description: `#${n} status change failed`,
    status: "error", ago: Date.now() });
  refresh();
});
```

**Action log UI — what to show:**
```
─── Action Log (L: close) ──────────
✓ #42 → In Progress    2s ago  [u: undo]
✓ #37 assigned         1m ago
✓ comment on #50       3m ago
✗ create failed        5m ago  [r: retry]
```

- Only the **most recent undoable entry** shows `[u: undo]` — others are history context only
- Error entries with retry show `[r: retry]`
- Timestamps are relative ("2s ago", "1m ago", "2h ago"); update every 5s while pane is open

**Viewport adjustment:**

The log pane height must be subtracted from `viewportHeight`. When visible: `logPaneRows = 4` (header + 3 visible entries). Add to the `CHROME_ROWS` calculation area in `Dashboard`:
```typescript
const logPaneRows = logVisible ? 4 : 0;
const viewportHeight = Math.max(5, termSize.rows - CHROME_ROWS - overlayBarRows - toastRows - logPaneRows);
```

**Files:**
- `src/board/hooks/use-action-log.ts` — new hook
- `src/board/hooks/use-actions.ts` — add `pushEntry` param; capture + pass undo thunks for status + assign
- `src/board/hooks/use-keyboard.ts` — remove `u`=unassign, add `u`=handleUndo, add `L`=handleToggleLog
- `src/board/components/action-log.tsx` — new component
- `src/board/components/dashboard.tsx` — wire `useActionLog`, `logVisible` state, viewport adjustment, auto-expand `useEffect`
- `src/board/components/help-overlay.tsx` — update `u` description, add `L`
- `src/board/components/hint-bar.tsx` — add `u` for undo when log has undoable entries

**Acceptance criteria:**
- [ ] `L` toggles the action log pane; collapsed by default
- [ ] Pane auto-expands when a `status: "error"` entry is pushed
- [ ] Pane shows last 5 entries with `✓`/`✗`/`⋯` prefix, description, and `Xs ago` timestamp
- [ ] `u` undoes the last reversible entry (status change or assign/unassign)
- [ ] `u` with no undoable entry: toast "Nothing to undo"
- [ ] Undo thunk cleared before execution (not after); prevents double-undo
- [ ] Undo of status change: optimistic update + API call + toast `#42 moved back → Todo`
- [ ] Undo of assign: calls `gh issue edit --remove-assignee @me` + optimistic update
- [ ] Undo failure: error toast + `refresh()` to revert optimistic state
- [ ] Comments, creates, picks: appear in log but marked not-undoable (no undo thunk)
- [ ] Failed action: error entry auto-expands the log pane
- [ ] `viewportHeight` shrinks by 4 when log is visible
- [ ] Timestamps update every 5s while pane is open (relative format)
- [ ] `u` is removed from standalone unassign (old behavior gone)
- [ ] All existing tests pass

---

#### 3.2 Full Issue Edit via `$EDITOR` (`e` key)

**What:** Press `e` on any GitHub issue. Opens `$EDITOR` with a structured YAML front matter + markdown body. On save, hog applies all changed fields via `gh issue edit` calls.

**Editor file format:**
```yaml
# --- HOG ISSUE EDIT ---
# Editing: owner/repo#42
# Available status: Todo, In Progress, In Review, Done
# Available labels: bug, enhancement, priority:high, priority:low
# ─────────────────────────────────────────────────────────────
title: Fix login redirect bug
status: In Progress
labels:
  - bug
  - priority:high
assignee: alice
---

When a user logs in with SSO, the redirect URL is not preserved.
Steps to reproduce: ...
```

**Flow:**
1. `e` pressed on a GitHub issue → enter `overlay:editIssue` mode
2. Fetch current issue fields + available labels (`fetchRepoLabelsAsync` — already cached) + available status options (`fetchProjectStatusOptions`)
3. Write temp file to `mkdtempSync(join(tmpdir(), "hog-edit-"))` using filename `issue-{number}.md` (some editors show the filename in the title bar; `.md` triggers YAML syntax highlighting in nvim/VS Code)
4. Suspend Ink, launch `$EDITOR` using `VISUAL || EDITOR || "vi"` (falsy check, not `??`, to handle `VISUAL=""`)
5. **Check `spawnSync` result**: treat non-zero exit code OR non-null signal as cancel (editor crashed)
6. On editor exit: parse the YAML header + body using line-by-line parser (no new dependency)
7. **Zero-changes detection**: diff parsed front matter + body against original values. If identical, toast "No changes made" — do NOT reopen, do NOT make gh calls.
8. **Validation:** if title is empty OR status not in options → **reopen editor** with error comments injected at top of the _preserved user content_: `# ERROR: status "Donee" not found → valid: Todo, In Progress, Done`
9. On valid save with changes: apply changed fields via separate sequential `gh` calls with individual try/catch per field:
   - Title changed → `gh issue edit --title`
   - Body changed → `gh issue edit --body`
   - Status changed → `updateProjectItemStatusAsync`
   - Labels changed → `handleLabelChange` pattern (add/remove separately)
   - Assignee changed → `gh issue edit --add-assignee / --remove-assignee`
10. Toast confirms changed fields (`#42: title, status updated`); individual error toasts per failed field
11. Action log records the edit as non-undoable
12. Cleanup: `rmSync(tmpDir, { recursive: true, force: true })` in `finally`

**Critical implementation notes:**

> **`setRawMode(true)` must be in `finally`, not `try`.** The existing `comment-input.tsx`
> and `nl-create-overlay.tsx` have a bug: if `spawnSync` throws (e.g., `ENOENT` for missing
> editor binary), `setRawMode(true)` is never called. `edit-issue-overlay.tsx` must fix this:
> ```typescript
> try {
>   getInkInstance()?.clear();
>   setRawMode(false);
>   // ... reopen loop ...
> } finally {
>   setRawMode(true);  // Always restore — not just happy path
>   onResumeRef.current?.();
>   try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
>   setEditing(false);
> }
> ```

> **Use falsy check for editor env var:**
> ```typescript
> const editorEnv = process.env["VISUAL"] || process.env["EDITOR"] || "vi";
> ```
> `??` would select an empty `VISUAL=""` and produce no editor command.

> **Check `spawnSync` result:**
> ```typescript
> const result = spawnSync(cmd, [...extraArgs, tmpFile], { stdio: "inherit" });
> if (result.status !== 0 || result.signal !== null || result.error) {
>   // Editor crashed or killed — treat as cancel, break reopen loop
>   break;
> }
> ```

> **Reopen loop preserves user content.** On validation failure, do NOT rewrite the file with
> the original seed. Inject error comment lines at the top of the _user's current content_:
> ```typescript
> const errorBlock = errors.map(e => `# ERROR: ${e}`).join("\n") + "\n";
> writeFileSync(tmpFile, errorBlock + currentContent);
> ```

> **Apply strategy: sequential with individual try/catch.** Apply all changed fields in sequence.
> Do NOT abort the whole edit if one field fails — apply what you can, report failures individually.

**YAML parsing:** Line-by-line parser (no new dependency). The format is entirely hog-authored:
- Strip `#`-prefixed lines (comments) before parsing
- Split on the first bare `---` line after line 0 to separate front matter from body
- Handle only the specific keys: `title`, `status`, `labels` (list with `  - item`), `assignee`
- Zod validates the parsed result post-parse

**`$EDITOR` pattern:** Implement in a `useEffect` with a `while(true)` reopen loop — same structure as `comment-input.tsx` lines 44–103 and `nl-create-overlay.tsx` lines 115–155.

**New UIMode:** `"overlay:editIssue"` — transparent overlay (no rendered component while editor is open; Ink is suspended). `EditIssueOverlay` mounts, runs the entire editor flow in a `useEffect`, and calls `onComplete`/`onCancel` when done.

**Files:**
- `src/board/hooks/use-ui-state.ts` — add `overlay:editIssue` mode
- `src/board/hooks/use-actions.ts` — add `handleEditIssue` (orchestrates the full flow)
- `src/board/hooks/use-keyboard.ts` — add `handleEnterEditIssue` to `KeyboardActions`, bind `e`
- `src/board/components/edit-issue-overlay.tsx` — new component (mounts, runs useEffect, suspends Ink)
- `src/board/components/overlay-renderer.tsx` — add `editIssueProps` branch
- `src/board/components/dashboard.tsx` — wire `handleEnterEditIssue`
- `src/board/components/help-overlay.tsx` — add `e: Edit issue`
- `src/github.ts` — add `editIssueTitleAsync`, `editIssueBodyAsync`, `editIssueAssigneeAsync` (or extend existing pattern)

**Acceptance criteria:**
- [ ] `e` on a GitHub issue opens `$EDITOR` with structured YAML front matter
- [ ] `e` on a TickTick task: no-op with toast "Edit not supported for TickTick tasks"
- [ ] `e` on a section header: no-op
- [ ] Injected comments show available status options and available labels (fetched from cache if available)
- [ ] `VISUAL || EDITOR || "vi"` (falsy check, not `??`)
- [ ] Multi-word editors (`code --wait`) work — editor string split on spaces
- [ ] Non-zero `spawnSync` exit or signal: treat as cancel (editor crashed)
- [ ] Zero-changes detection: if all fields unchanged, toast "No changes made", no gh calls
- [ ] Empty title after save: editor reopens with error at top of preserved content
- [ ] Invalid status after save: editor reopens with `# ERROR: status "X" not found → valid: ...`
- [ ] On valid save with changes: each changed field triggers its `gh` call; unchanged fields skipped
- [ ] Apply strategy: sequential per field, individual try/catch; partial success is OK
- [ ] `setRawMode(true)` in `finally` (not just happy path)
- [ ] Temp directory `hog-edit-*`, file `issue-{number}.md`, cleaned in `finally`
- [ ] Auto-refresh paused before editor launch, resumed in `finally`
- [ ] Toast summarizes changed fields: `#42: title, status updated`
- [ ] Failed field: individual error toast, other fields still applied
- [ ] Action log records the edit (non-undoable)

---

### Phase 4: CLI Parity Commands

**What:** Non-interactive CLI counterparts for every board mutation. Agents, scripts, and shell aliases work without running the board.

**Where:** All new subcommands are added to the existing `issueCommand` in `src/cli.ts` (lines 733–802). The existing `issue create` is the pattern to follow.

**Issue ref format:** `owner/repo#number` (e.g., `myorg/myapp#42`). Reuse `parseIssueRef` from `src/pick.ts`.

**New commands:**

```
hog issue show <owner/repo#N>
hog issue move <owner/repo#N> <status>
hog issue assign <owner/repo#N> [--user <username>]
hog issue unassign <owner/repo#N> [--user <username>]
hog issue comment <owner/repo#N> <text>
hog issue edit <owner/repo#N> [--title <title>] [--body <body>] [--label <label>] [--remove-label <label>] [--assignee <user>] [--remove-assignee <user>]
hog issue label <owner/repo#N> <label> [--remove]
```

All commands:
- Support `--json` global flag (existing)
- Output via `printSuccess()` / `jsonOut()` from `output.ts`
- Respect `--dry-run` flag (new global option): print what would happen, make no mutations

**`--dry-run` implementation:**
```typescript
if (opts.dryRun) {
  console.log(`[dry-run] Would move ${issueRef} → "${status}"`);
  return;
}
```
Print to stdout (not stderr); format matches what `sync run --dry-run` does in the existing codebase.

**Existing `gh` wrappers to reuse:**
- `assignIssueAsync(repo, issueNumber)` — `github.ts` line ~100
- `updateProjectItemStatusAsync(repo, issueNumber, projectConfig)` — `github.ts` line ~448 (resolve status name → `optionId` via `fetchProjectStatusOptions` at line ~277)
- `execFileAsync("gh", ["issue", "comment", ...])` — pattern from `use-actions.ts`
- `execFileAsync("gh", ["issue", "edit", ...])` — pattern from `use-actions.ts`

**`hog issue move` requires config:** `statusFieldId` and `projectNumber` come from `config.repos`. If the repo is not in `config.repos`, print error: `Repo owner/repo is not configured in hog. Run hog init to add it.`

**Error message conventions** (following the existing `printSuccess`/`console.error`/`process.exit(1)` pattern):
- Unconfigured repo → actionable: `Repo owner/repo is not configured. Run: hog init`
- Invalid status → list valid ones: `Invalid status "Donee". Valid: Todo, In Progress, In Review, Done`
- `gh` CLI not found → `GitHub CLI (gh) not found. Install: https://cli.github.com`

**Files:**
- `src/cli.ts` — add 7 new subcommands to `issueCommand`
- `src/github.ts` — add `unassignIssueAsync`, `fetchIssueAsync` (for `show`), `addLabelAsync`, `removeLabelAsync` if not already present
- `src/pick.ts` — no changes (reuse `parseIssueRef`)

**Acceptance criteria:**
- [ ] `hog issue show owner/repo#42` prints the issue title, status, labels, assignee, body
- [ ] `hog issue show --json owner/repo#42` prints full JSON
- [ ] `hog issue move owner/repo#42 "In Review"` moves the issue status
- [ ] `hog issue move` with unconfigured repo: actionable error message + exit 1
- [ ] `hog issue move` with invalid status name: error listing valid statuses + exit 1
- [ ] `hog issue assign owner/repo#42` assigns `config.board.assignee`
- [ ] `hog issue assign --user alice owner/repo#42` assigns a specific user
- [ ] `hog issue unassign owner/repo#42` removes `config.board.assignee`
- [ ] `hog issue comment owner/repo#42 "text"` adds a comment
- [ ] `hog issue edit owner/repo#42 --title "New title"` updates only the title
- [ ] `hog issue edit` with multiple flags applies all changes in one or more `gh` calls
- [ ] `hog issue label owner/repo#42 bug` adds the label
- [ ] `hog issue label --remove owner/repo#42 bug` removes the label
- [ ] All commands support `--json` flag
- [ ] All commands support `--dry-run` flag (print intent to stdout, no mutation)
- [ ] All commands exit 0 on success, exit 1 on error (with actionable message to stderr)

---

## Alternative Approaches Considered

### Fuzzy picker: Enhance `/` search instead of a new overlay

Rejected (per brainstorm key decision). Two different mental models: `/` filters the visible board
in-place; `F` is "go to a specific thing I have in mind." Both serve daily use and should coexist.

### Fuzzy picker: Hand-rolled substring-gap algorithm

Rejected in favour of `fzf-for-js` after research. Hand-rolled gap algorithms produce poor ranking
— they treat all matching positions equally, while fzf's affine-gap scoring rewards word boundaries
and consecutive matches. The quality difference is significant for 2–5 char queries against issue
titles. `fzf-for-js` is 5KB, TypeScript-native, and maintained.

### Action log: reuse `use-toast.ts`

Considered. Toasts are ephemeral (auto-dismiss), action log is persistent and scrollable. Different
enough to warrant a separate `use-action-log.ts` hook with a different data model. They can share
the `ActionLogEntry` type structure but not the queue behavior.

### Comments: eager fetch on issue selection

Rejected. If the user is browsing 20 issues quickly, that's 20 `gh issue view` calls — significant
latency and noise in the terminal. Lazy fetch on explicit `Tab`/`Enter` in the detail panel is a
better trade-off.

### Full issue edit: inline field editing (one field at a time)

Considered. A multi-step overlay with individual field inputs would be more discoverable. Rejected
in favor of `$EDITOR` because: (a) developers trust their editor and have it configured with YAML
syntax highlighting, (b) editing multiple fields in one editor session is faster, (c) the `$EDITOR`
pattern is already proven and implemented in the codebase.

### CLI parity: Accept TickTick operations

Explicitly out of scope per brainstorm key decision. TickTick is being de-emphasized as optional.
GitHub is the primary surface. TickTick CLI operations can be added later if demand exists.

---

## Acceptance Criteria (Summary)

### Functional

- [ ] `t` filters board to my issues; `t` again clears
- [ ] Hint bar is mode-aware and shows ≤8 relevant shortcuts (not a wall of text)
- [ ] Comments section in detail panel with lazy fetch on `Tab`/`Enter`
- [ ] `F` opens fuzzy picker over all in-memory issues using `fzf-for-js`
- [ ] Fuzzy picker navigation: arrow keys / Ctrl-J/K (not j/k); `Enter` jumps cursor to issue
- [ ] Action log pane (`L`) shows last 5 mutations with status
- [ ] `u` undoes last reversible action (status change, assign)
- [ ] `e` opens `$EDITOR` with YAML front matter; validation and reopen on error
- [ ] All 7 CLI parity commands work with `--json` and `--dry-run`

### Non-Functional

- [ ] Zero extra `gh` calls for fuzzy picker (uses in-memory data)
- [ ] `fzf` index built in `useMemo` tied to `allIssues` — not rebuilt on each keystroke
- [ ] Comments fetch is lazy and cached per issue
- [ ] `VISUAL || EDITOR || "vi"` (falsy check) for editor detection
- [ ] `setRawMode(true)` in `finally` for all `$EDITOR` flows (including `edit-issue-overlay.tsx`)
- [ ] `spawnSync` result checked for non-zero exit AND signal
- [ ] Undo thunk cleared before execution (prevents double-undo)
- [ ] `u` repurposed from unassign → undo; `help-overlay.tsx` updated
- [ ] `CHROME_ROWS` and `viewportHeight` account for log pane when visible
- [ ] 80% coverage threshold maintained across all phases
- [ ] All new CLI commands exit 0/1 with actionable error messages

---

## Dependencies & Prerequisites

- Phase 1 is self-contained — no blockers, no new dependencies
- Phase 2 requires Phase 1 hint bar (for `overlay:fuzzyPicker` mode hint); adds `fzf` dependency
- Phase 3.1 (action log) should be done before Phase 3.2 (edit) — edit entries go into the log
- Phase 3.2 (edit) benefits from Phase 1 label cache (labels already fetched)
- Phase 4 is self-contained — no blockers from board phases

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `$EDITOR` + Ink stdin not restored on ENOENT | Medium | High | Move `setRawMode(true)` to `finally` — existing pattern has this bug; fix in `edit-issue-overlay.tsx` |
| `spawnSync` signal kill leaves cooked terminal | Low | High | Check `result.signal !== null` as well as `result.status !== 0` |
| Action log undo captures stale state | Medium | Medium | Capture undo thunk at mutation time (closure over pre-mutation values); push entry only on success |
| Double-undo during async window | Low | Medium | Clear thunk before execution (not after); if undo fails, thunk is gone — user sees error toast |
| Fuzzy picker performance with 200+ issues | Low | Low | `fzf.find()` < 1ms for 500 items; `useMemo` prevents index rebuild on keystroke; render only visible rows |
| Arrow vs j/k conflict in fuzzy picker | Medium | Medium | Use `ArrowDown`/`ArrowUp` + `Ctrl-J`/`Ctrl-K`; `j`/`k` are printable and would append to query |
| YAML parse error from user-edited front matter | Medium | Low | Line-by-line parser; error injected at top of preserved content; reopen loop |
| `hog issue move` with complex status options | Medium | Medium | Always validate against `fetchProjectStatusOptions` before mutating |
| `u` repurpose breaks user muscle memory | Low | Low | Update help overlay, README, and add a transition toast on first undo |
| Viewport height wrong when log pane visible | Low | Medium | Subtract `logPaneRows` in same `viewportHeight` calculation; unit test the math |
| `fzf-for-js` dependency introduces bundle risk | Low | Low | Library is 5KB, zero transitive deps, TypeScript-native; ESM-compatible with tsup |
| `VISUAL=""` falls through to blank editor command | Low | Medium | Use falsy check (`||`) not nullish coalescing (`??`) when reading editor env vars |

---

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-02-19-hog-ux-leap-brainstorm.md`
- Previous plan: `docs/plans/2026-02-18-feat-board-ux-nl-issue-creation-plan.md`
- State machine: `src/board/hooks/use-ui-state.ts`
- Keyboard handler: `src/board/hooks/use-keyboard.ts`
- Overlay renderer: `src/board/components/overlay-renderer.tsx`
- Existing `$EDITOR` pattern: `src/board/components/comment-input.tsx` (lines 44–103)
- Existing `$EDITOR` pattern (body): `src/board/components/nl-create-overlay.tsx` (lines 115–155)
- Lazy fetch pattern: `src/board/components/label-picker.tsx` (lines 33–57)
- Stable ref pattern: `src/board/hooks/use-actions.ts` (lines 153–158)
- `findIssueContext` helper: `src/board/hooks/use-actions.ts` (lines 69–87)
- GitHub wrapper: `src/github.ts`
- CLI command structure: `src/cli.ts` (lines 733–802, `issueCommand`)
- Issue ref parsing: `src/pick.ts` (`parseIssueRef`)
- Toast hook: `src/board/hooks/use-toast.ts` (model for action log queue)
- Detail panel: `src/board/components/detail-panel.tsx`
- Help overlay shortcuts: `src/board/components/help-overlay.tsx` (lines 9–49)

### External Research

- `fzf-for-js` — TypeScript port of fzf algorithm: affine-gap scoring, word-boundary bonuses, `positions` for match highlighting
- lazygit undo model — linear, reads external ground truth, transparent about non-undoable actions
- fzf UX conventions — arrow keys for list navigation, reset cursor on query change, scroll-follow
- telescope.nvim — multi-field search via separate scorer instances per field
- `$EDITOR` integration — `VISUAL || EDITOR || fallback`, split on spaces for multi-word editors, `spawnSync` result checking

### Related Work

- lazygit (37k ★) — action log / command log as "trust-building" UX pattern; linear undo
- gh-dash — fuzzy filtering approach
- taskwarrior — urgency scoring (deferred, see brainstorm)
