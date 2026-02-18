---
title: "Board UX Improvements & Natural Language Issue Creation"
type: feat
status: completed
date: 2026-02-18
---

# Board UX Improvements & Natural Language Issue Creation

## Enhancement Summary

**Deepened on:** 2026-02-18
**Sections enhanced:** 8
**Research agents used:** framework-docs-researcher (Ink + chrono-node), best-practices-researcher (NL parsing + LLM), best-practices-researcher (clipboard + $EDITOR), security-sentinel, julik-frontend-races-reviewer, architecture-strategist, kieran-typescript-reviewer, code-simplicity-reviewer, performance-oracle, spec-flow-analyzer, pattern-recognition-specialist

### Key Improvements Discovered

1. **Critical race condition**: `ctrl+e` + TextInput dual-handler fires simultaneously — must transition to an `"editing"` sub-state (unmounting `TextInput`) before calling `spawnSync`, otherwise both `useInput` handlers fire at once.
2. **Event loop block**: `gh label list` via `execFileSync` on the React render thread blocks for 200–800ms+ — must use `execFileAsync` (promisified) with a loading spinner in `LabelPicker`.
3. **Security**: LLM prompt injection via user text — wrap user content in XML delimiters; keep user text in USER message role, never interpolated into SYSTEM prompt.
4. **Architecture signal**: `dashboard.tsx` is ~1272 lines and will exceed 1500 with new overlays — extract `OverlayRenderer` component and `use-keyboard` hook before adding new overlays.
5. **Simplification wins**: Replace `subState: "input" | "parsing" | "preview"` with two booleans (`isParsing`, `parsed`); remove `[e]` edit-from-preview loop (Escape + retype is equivalent).
6. **Clipboard**: `xsel` preferred over `xclip` (xclip has a known pipe-hang bug); add Wayland detection (`WAYLAND_DISPLAY`) before X11; WSL detection must check both `WSL_DISTRO_NAME` and `WSL_INTEROP`.
7. **`$EDITOR`**: `VISUAL ?? EDITOR ?? "vi"` priority (not just `EDITOR`); store Ink instance in a module-level ref; use `mkdtempSync` for temp files (not predictable timestamp paths).
8. **chrono-node**: `forwardDate` has known bug #240 (doesn't advance year) — add year post-check; prefer `parse()` over `parseDate()` for full-match verification.

### New Considerations Discovered

- `AbortController` for LLM fetch must live in `useRef`, not component-local variable — React re-renders lose the reference.
- `noUncheckedIndexedAccess` TSC flag requires explicit `!== undefined` guards in token-loop code.
- Orphaned labels (labels on an issue that no longer exist in the repo) need explicit handling in `LabelPicker`.
- `ConfirmPrompt` cancel for terminal status: must embed confirmation in `StatusPicker` local state, not as a separate global overlay.
- API keys must never appear in error messages; sanitize with `Bearer [REDACTED]` replacement pattern.

---

## Overview

Two complementary sets of improvements to make the `hog` board a faster daily driver:

1. **UX gaps** — fill the remaining holes in the board's editing workflow: default expanded sections, label management, multi-line comments, cross-platform clipboard, and allowing issues to be marked as Done directly from the board.
2. **Natural language issue creation** — type a free-form sentence to create an issue, with optional LLM-powered extraction via OpenRouter (or Anthropic as a fallback) and a heuristic parser that works without any API key.

The brainstorm `2026-02-15-hog-board-command-center-brainstorm.md` explicitly deferred "AI-powered issue summaries" — this plan picks that up as issue _creation_, which is the natural entry point for AI assistance.

---

## Problem Statement

After the Phase 1–3 command center work, several high-friction gaps remain:

- **Board starts collapsed every launch.** The user must manually expand every section before doing any work. Collapse state is lost on every session restart.
- **No label management.** Labels are display-only — the board's primary prioritization signal (`priority:*`) cannot be set from within the board.
- **Comments are single-line.** Writing a longer status update requires leaving the terminal.
- **`y` (copy link) breaks on Linux.** Hard-coded `pbcopy` silently fails outside macOS.
- **Cannot mark issues Done.** The status picker deliberately excludes terminal statuses, forcing users to open the browser for the most common board action.
- **Issue creation requires remembering syntax.** The existing `n` form is fine for titled issues but requires context-switching to write a title, then come back to add labels/assignee separately.

---

## Proposed Solution

### Part 1: UX Fixes (five targeted changes)

#### 1.1 Default Expanded Sections

Change `use-navigation.ts` initial state from all-collapsed to all-expanded. Both repo-level headers and status-group sub-headers start expanded. The **Activity section** remains collapsed by default (it's noise for most views).

Collapsed state already persists across refreshes via `isFirstLoad` logic — this change only affects the very first mount.

Add a **"collapse all"** shortcut: `C` (shift+c) resets `collapsedSections` to all-collapsed as a quick recovery for boards with many repos.

Show **item counts on collapsed headers**: `▶ In Progress (4)` — computed in `buildFlatRows` and passed to the `SectionHeader`/`SubHeader` row type.

> **Note (Pattern Recognition):** Before implementing item counts, verify whether `buildFlatRows` already computes them — the architecture review suggests this may already be in place. Check `dashboard.tsx` `buildFlatRows` function first.

#### 1.2 Label Picker

New key `l` on an issue opens a `LabelPicker` overlay (`overlay:label` in the state machine). Labels are **fetched lazily** via `gh label list --repo {repo} --json name,color` on first `l` press, then cached in a `Record<string, LabelOption[]>` ref for the session (not `Map` — idiomatic React state, consistent with codebase conventions).

Behavior:
- Pre-selects labels already applied to the issue (toggle-style)
- Multi-select: navigate with `j`/`k`, toggle with `Space`
- `Enter` confirms: runs `gh issue edit --add-label` for newly selected, `--remove-label` for deselected
- `Escape` cancels with no changes
- If `gh label list` fails: show toast error "Could not fetch labels: {error}" and stay in normal mode
- **Orphaned labels** (issue has a label that no longer exists in the repo): show as `(orphaned)` with dim rendering, pre-selected but flagged

Also fix the dead `labels` parameter in `CreateIssueForm`: add a label selection step to the existing `n` creation form (after title, before submit) using the same lazy-fetched label cache.

> **Trigger point (Spec Flow):** In `CreateIssueForm`, trigger the label fetch when the user _reaches_ the label step (not on overlay open). Show a spinner while fetching.

#### 1.3 Multi-line Comments via `$EDITOR`

`ctrl+e` inside the comment overlay (`overlay:comment`) launches `$EDITOR` (falls back to `vi` if unset). Use `VISUAL ?? EDITOR ?? "vi"` priority order.

Implementation steps:
1. `ctrl+e` transitions comment overlay to an `"editing"` sub-state — this unmounts `TextInput` so its internal `useInput` no longer fires.
2. In a `useEffect` triggered by the `"editing"` sub-state:
   - Create a secure temp directory: `mkdtempSync(join(tmpdir(), "hog-comment-"))` → write `comment.md` inside it
   - Call `inkInstance.clear()` (module-level ref) + `process.stdin.pause()`
   - Use `useStdin().setRawMode(false)` — **not** `process.stdin.setRawMode(false)` directly (Ink owns stdin)
   - `spawnSync(cmd, [...extraArgs, tmpFile], { stdio: "inherit" })` — split editor string on spaces to handle `code --wait`
   - In `finally`: `useStdin().setRawMode(true)` + `process.stdin.resume()`
3. Read temp file; if empty → cancel with toast "Comment cancelled (empty)"; if content → pre-fill the `TextInput` in the comment overlay, return to `"input"` sub-state
4. Delete temp dir in `finally` (always, even on error)

Auto-refresh must be paused before launching `$EDITOR` and resumed after. Expose `pauseAutoRefresh()`/`resumeAutoRefresh()` from `useData` hook.

> **Critical (Julik — Race Condition):** The dual-handler problem: when `ctrl+e` is pressed, both `CommentInput`'s `useInput` and `@inkjs/ui TextInput`'s internal `useInput` fire simultaneously. The fix is to transition to `"editing"` state _first_ (which unmounts `TextInput`), then launch the editor in a `useEffect`. Never call `spawnSync` directly inside a `useInput` handler while `TextInput` is still mounted.

#### 1.4 Cross-Platform Clipboard

Replace the `pbcopy` hard-code with a utility function `getClipboardArgs(): readonly string[] | null`:

```
darwin                → ["pbcopy"]
win32                 → ["clip"]
WSL_DISTRO_NAME env   → ["clip.exe"]    (check before Wayland/X11)
WSL_INTEROP env       → ["clip.exe"]    (root-user WSL compat — both vars needed)
WAYLAND_DISPLAY env   → ["wl-copy"]     (check before DISPLAY)
DISPLAY env           → ["xsel", "--clipboard", "--input"]   (NOT xclip — pipe-hang bug)
fallback              → null (show toast with URL text)
```

Detection order matters: **WSL → Wayland → X11 → macOS/Windows → null**.

If command returns a non-zero exit code, fall through to toast with URL.

Use `spawnSync` with `stdio: ["pipe", "pipe", "pipe"]` and `input:` option (not piped shell process).

> **Critical (Best Practices):** Do NOT use `xclip` on Linux — it has a known pipe-hang bug when the clipboard manager is unavailable. Use `xsel --clipboard --input` instead. `wl-copy` is the correct Wayland tool (not `xclip -selection clipboard`).

> **WSL detection (Best Practices):** Check BOTH `WSL_DISTRO_NAME` and `WSL_INTEROP` env vars. `WSL_DISTRO_NAME` is only set for the default user; `WSL_INTEROP` is always set for all users including root.

#### 1.5 Terminal Status Selection in StatusPicker

Remove the terminal status filter from `selectedRepoStatusOptions`. Show terminal statuses with a **yellow "(Done)" suffix** in the picker. When a terminal status is selected:

1. If the repo has `completionAction: { type: "closeIssue" }` configured, show an **inline confirm step within `StatusPicker`** (not a new global overlay): `"This will also close the issue on GitHub. Continue? [y/n]"` before executing.
2. Otherwise proceed directly (optimistic update + GraphQL status mutation + `triggerCompletionActionAsync`).

Same change applies to the bulk status picker (bulk action menu passes `selectedRepoStatusOptions` — fix both).

> **Spec Flow gap:** The cancel path from the inline confirm must return to the status picker (item still highlighted), not to normal mode. Implement the confirm as `StatusPicker` local state (`confirmingTerminal: boolean`), not as a separate global `UIMode`.

> **Enter key repeat guard (Julik):** Add `submittedRef.current` guard in `StatusPicker` to prevent double-submission on Enter key held down (same pattern as other pickers in the codebase).

---

### Part 2: Natural Language Issue Creation

New key: `I` (shift+i) opens `overlay:createNl`. Coexists with `n` (the simple form).

> **Naming (Pattern Recognition):** Use `overlay:createNl` (not `overlay:nlCreate`) — consistent with the `overlay:confirmPick` naming pattern (verb-first). Action: `ENTER_CREATE_NL`; hook method: `enterCreateNl`.

> **Guard (Spec Flow):** If `config.repos` is empty, pressing `I` should show a toast "No repos configured — run hog init" and not open the overlay.

#### User Flow

```
[I pressed]
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ ✨ What do you need to do?                           │
│ > fix login bug on mobile #bug #priority:high @me   │
│   due friday                                        │
│                                                     │
│ Tip: #label  @user  due <date>                      │
└─────────────────────────────────────────────────────┘
    │ [Enter]
    ▼
  Parse (heuristic → LLM if key configured)
    │
    ▼
[Loading: "Parsing..." spinner if LLM in-flight]
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ ✨ Creating Issue                                    │
│                                                     │
│  Title:    Fix login bug on mobile                  │
│  Repo:     myorg/myapp                              │
│  Labels:   bug, priority:high                       │
│  Assignee: @me                                      │
│  Due:      Fri Feb 20 (label: due:2026-02-20)       │
│                                                     │
│ [Enter] Create   [Escape] Cancel                    │
└─────────────────────────────────────────────────────┘
    │
    ├─[Enter]──→ gh issue create + apply due label → toast + refresh
    └─[Escape]─→ cancel, return to normal
```

> **Simplification (Code Simplicity):** Remove the `[e]` edit-from-preview loop. Escape + retype achieves the same result with less code and no re-parse UX to design around. The preview already shows the raw input — users can just Escape and re-type with corrections. This eliminates the "re-parse on edit" complexity (heuristic vs LLM on edit loop) entirely.

> **Spec Flow gap:** If `gh issue create` fails in the preview state (network error, auth error), the overlay should stay open and show the error inline. Do NOT close the overlay on failure — user may want to retry or copy the title out.

#### Heuristic Parser (always runs, no API key needed)

Parse the input string:
- `#word` → label (lowercased, matched against cached label list if available)
- `@me` or `@username` → assignee
- `due <expression>` → date (parsed with `chrono-node`, using today + `forwardDate: true`)
- Everything else after stripping tokens → title

Labels not found in the repo's label list: shown in preview with `(not found)` warning but allowed to proceed — `gh issue create` will produce the error.

> **Edge case (Spec Flow):** If stripping all tokens leaves an empty title (e.g., input `#bug @me`), show inline error "Title is required" and stay in input state. Do not proceed to preview.

> **Security (Sentinel):** User-typed `#tokens` must be validated against the repo label allowlist before passing to `gh issue create --label`. Never pass raw user input to `gh` as label names without first stripping shell-unsafe characters and checking against the fetched list.

#### LLM Parser (optional, layered on top)

Configured via env vars only:
- `OPENROUTER_API_KEY` → use OpenRouter (`https://openrouter.ai/api/v1/chat/completions`)
- `ANTHROPIC_API_KEY` → use Anthropic directly (`https://api.anthropic.com/v1/messages`)
- Env vars take precedence; if both set, OpenRouter wins

> **Simplification (Code Simplicity):** Remove `provider` field from AI config — detect provider from which key is present. This eliminates a user-facing config decision that has only one sensible answer per key type. No `ai.json` or auth.json `ai` key needed for MVP — env vars only.

API call (OpenRouter, fetch-based, no SDK — matches existing `api.ts` pattern):

```typescript
// src/ai.ts  (consider domain-named like api.ts, auth.ts rather than ai-extract.ts)
POST https://openrouter.ai/api/v1/chat/completions
model: "google/gemini-2.5-flash"
response_format: { type: "json_schema", json_schema: { name: "issue", schema: { ... } } }
max_tokens: 256
temperature: 0

System: "Extract GitHub issue fields. Today is {YYYY-MM-DD}. Return JSON with: title (string), labels (string[]), due_date (YYYY-MM-DD|null), assignee (string|null)."
User:   "<input>{userText}</input>\n<valid_labels>{labelList}</valid_labels>"
```

> **Security (Sentinel — Prompt Injection):** User text MUST be in the USER message, not interpolated into the SYSTEM prompt. Wrap user text in XML delimiters (`<input>...</input>`) to prevent prompt injection. Do NOT use template literals to insert user text directly into system instructions.

> **Best Practice (LLM):** Use `response_format: { type: "json_schema" }` (not `"json_object"`) — enforces schema compliance at the API level, eliminates manual field validation for missing/extra keys.

> **TypeScript (Julik/Kieran):** Use `AbortSignal.timeout(5_000)` directly (do NOT use `AbortSignal.any()` — there is a known Node.js GC bug #57736 with that API). The `AbortController` or signal must be stored in a `useRef` if used across React renders, not as a component-local variable.

LLM result is merged with heuristic result: **heuristic wins on explicitly-marked tokens** (`#`, `@`, `due`); LLM wins only on ambiguous title cleanup. Merge logic is ~5 lines:

```typescript
const result = { ...llmResult, ...heuristicResult }; // heuristic always wins on explicit tokens
```

Error handling:
- Timeout (5s): fall back to heuristic result silently
- Non-2xx response: fall back to heuristic + show toast "AI parsing unavailable, used keyword matching"
- Malformed JSON / schema mismatch: fall back to heuristic

> **Security (Sentinel):** API keys must NEVER appear in error messages. Before logging or toasting any fetch error, sanitize the Authorization header value: replace `Bearer sk-...` with `Bearer [REDACTED]`.

#### State Machine Simplification

> **Simplification (Code Simplicity):** Replace `subState: "input" | "parsing" | "preview"` union with two plain booleans in `NlCreateOverlay` component state:
> ```typescript
> const [isParsing, setIsParsing] = useState(false);
> const [parsed, setParsed] = useState<ParsedIssue | null>(null);
> ```
> - `!isParsing && parsed === null` → input view
> - `isParsing` → spinner view
> - `!isParsing && parsed !== null` → preview view
>
> This is simpler, avoids an intermediate state union, and is easier to read.

#### Due Date → GitHub mapping

GitHub issues have no native due date field. The parsed date is applied as a label: `due:{YYYY-MM-DD}`. This is consistent with the existing `priority:*` label convention. Shown in preview as "Due: Fri Feb 20 (label: due:2026-02-20)".

#### Repo Selection

Defaults to the repo of the currently focused issue. If focused on a header, TickTick task, or activity row: defaults to the first repo in `config.repos`. Can be changed in the preview panel (new `r` key in preview mode cycles through repos).

---

## Technical Approach

### Files to Change

| File | Change |
|---|---|
| `src/board/hooks/use-navigation.ts` | Change initial `collapsedSections` to `new Set()` (expand by default); add `COLLAPSE_ALL` action |
| `src/board/hooks/use-ui-state.ts` | Add `overlay:label` and `overlay:createNl` modes; add `ENTER_LABEL`, `ENTER_CREATE_NL` actions |
| `src/board/hooks/use-actions.ts` | Add `handleLabelChange`, update `handleCreateIssue` to accept labels from form |
| `src/board/hooks/use-data.ts` | Expose `pauseAutoRefresh()`/`resumeAutoRefresh()` for $EDITOR suspend |
| `src/board/components/dashboard.tsx` | Wire `l` and `I` keys; pass item counts to header rows; fix `selectedRepoStatusOptions` filter; extract `OverlayRenderer` and `use-keyboard` hook |
| `src/board/components/create-issue-form.tsx` | Add labels step; wire `labels` to `onSubmit` |
| `src/board/components/comment-input.tsx` | Add `ctrl+e` handler for `$EDITOR` launch; manage `"editing"` sub-state |
| `src/board/components/status-picker.tsx` | Show terminal statuses with yellow suffix; add inline confirm step as local state |
| `src/board/components/label-picker.tsx` | New component — multi-select overlay, async label fetch with loading state |
| `src/board/components/nl-create-overlay.tsx` | New component — NL input + preview |
| `src/board/ink-instance.ts` | New module — exports module-level `inkInstance` ref for `$EDITOR` integration |
| `src/clipboard.ts` | New utility — `getClipboardArgs(): readonly string[] \| null` |
| `src/ai.ts` | New module — `extractIssueFields()` (heuristic + optional LLM) |
| `src/github.ts` | Add `fetchRepoLabelsAsync(repo)` — async promisified variant, NOT `execFileSync` |

> **Architecture (Strategist):** Before adding new overlays, extract `OverlayRenderer` (renders whichever overlay is active based on `uiMode`) and `use-keyboard` (all `useInput` handlers) from `dashboard.tsx`. This prevents the file from exceeding 1500 lines and makes new overlay additions one-liners.

### New Dependencies

| Package | Why |
|---|---|
| `chrono-node` | Natural language date parsing ("next friday", "end of month") |

No new dependencies for LLM — uses native `fetch` (Node 22+, already in use by `api.ts`).
No Anthropic SDK — direct API call via fetch keeps the bundle minimal and avoids SDK version drift.

> **Performance (Oracle):** Dynamically import `chrono-node` inside `NlCreateOverlay` (not at module top level). It loads only when the user opens the NL overlay, keeping startup time clean.

### Architecture: `overlay:label` State Machine

```
normal
  │ l (on issue)
  ▼
overlay:label
  │ Enter (confirm selection)
  │ Escape (cancel)
  ▼
normal
```

`ENTER_LABEL` allowed from `normal` only (matches pattern of `ENTER_COMMENT`).
`canAct` guard in `dashboard.tsx` means `l` is already blocked in search/multiSelect/focus/overlay modes.

### Architecture: `overlay:createNl` State Machine

```
normal
  │ I (shift+i)
  ▼
overlay:createNl (NlCreateOverlay component manages internal state)
  │ isParsing=false, parsed=null → input view
  │ isParsing=true              → spinner view
  │ isParsing=false, parsed≠null → preview view
  │ Enter (on preview) → create → normal
  │ Escape (any state) → normal
```

Implemented as a single `overlay:createNl` UIMode with `isParsing` + `parsed` booleans local to `NlCreateOverlay` (not in the global state machine). This avoids bloating the global UIMode union with transient states.

---

## Implementation Phases

### Phase 0: Architecture Prep (recommended first)

**Deliverables:**
- Extract `OverlayRenderer` component from `dashboard.tsx`
- Extract `use-keyboard` hook from `dashboard.tsx`
- `src/board/ink-instance.ts` module-level instance ref

**Why first:** `dashboard.tsx` is ~1272 lines. Adding Phase 1–4 overlays without extraction will push it past 1500 lines and make the file hard to review. The extraction is backward-compatible (behavior unchanged).

**Files:** `dashboard.tsx` (refactor only), `ink-instance.ts` (new)

**Acceptance criteria:**
- [ ] All existing tests pass after extraction
- [ ] `dashboard.tsx` reduced to <900 lines
- [ ] `OverlayRenderer` renders the correct overlay for each `uiMode`
- [ ] `use-keyboard` contains all `useInput` handlers

### Phase 1: UX Fixes (no new dependencies)

**Deliverables:**
- Default expanded sections with `C` collapse-all shortcut
- Item counts on collapsed headers
- Cross-platform clipboard
- Terminal status selection (with inline confirm)
- Activity section stays collapsed by default

**Files:** `use-navigation.ts`, `dashboard.tsx`, `clipboard.ts`, `status-picker.tsx`

**Acceptance criteria:**
- [ ] Board opens fully expanded on fresh `hog board --live` launch
- [ ] Activity section starts collapsed (explicit exception)
- [ ] `C` collapses all sections
- [ ] Collapsed headers show `▶ In Progress (4)` format
- [ ] `y` copies to clipboard on macOS, Linux (xsel), WSL (clip.exe via both `WSL_DISTRO_NAME` and `WSL_INTEROP`), Wayland (wl-copy), Windows (clip)
- [ ] When clipboard unavailable: toast shows the URL text directly
- [ ] Terminal statuses appear in status picker with yellow "(Done)" suffix
- [ ] Selecting a terminal status with `closeIssue` completionAction shows inline confirm before executing
- [ ] Cancelling the confirm returns to status picker (not normal mode)
- [ ] `StatusPicker` has Enter-repeat guard (`submittedRef.current`)
- [ ] All existing tests pass

### Phase 2: Label Picker + Create Form Labels

**Deliverables:**
- `l` key opens LabelPicker overlay
- Pre-selects existing labels; toggle-to-add/remove
- Orphaned labels shown as `(orphaned)`
- `gh label list` fetch async, cached per-session per-repo in `Record<string, LabelOption[]>`
- `CreateIssueForm` has a labels step
- `handleCreateIssue` actually passes labels to `gh issue create`

**Files:** `use-ui-state.ts`, `use-actions.ts`, `label-picker.tsx`, `create-issue-form.tsx`, `github.ts`, `dashboard.tsx`

**Acceptance criteria:**
- [ ] `l` on an issue opens label picker with loading state while fetching
- [ ] Label fetch is async (`fetchRepoLabelsAsync`) — no event loop blocking
- [ ] Labels already on the issue are pre-selected
- [ ] Orphaned labels show as `(orphaned)`, pre-selected, dimmed
- [ ] Selecting/deselecting and pressing `Enter` applies `--add-label`/`--remove-label` calls
- [ ] `Escape` cancels with no changes and shows no toast
- [ ] Empty label list (no labels in repo): shows "No labels in this repo" message
- [ ] `gh label list` failure: shows error toast, overlay closes
- [ ] `n` create form includes a labels step (fetch triggered when reaching that step)
- [ ] Created issue has the selected labels
- [ ] `l` pressed on header/subheader/task: no-op (not wired)
- [ ] Coverage threshold maintained (≥80%)

### Phase 3: Multi-line Comments ($EDITOR)

**Deliverables:**
- `ctrl+e` in comment overlay transitions to `"editing"` sub-state before launching `$EDITOR`
- `useData` exposes `pauseAutoRefresh()`/`resumeAutoRefresh()`
- Secure temp file handling
- Ink stdin restore in `finally`

**Files:** `comment-input.tsx`, `use-data.ts`, `ink-instance.ts`

**Acceptance criteria:**
- [ ] `ctrl+e` in comment overlay opens `$EDITOR` (uses `VISUAL ?? EDITOR ?? "vi"`)
- [ ] Multi-argument editors (`code --wait`) work correctly (split on spaces)
- [ ] `TextInput` is unmounted before `spawnSync` is called (no dual-handler fire)
- [ ] Raw mode restored via `useStdin().setRawMode(true)` in `finally` (not just happy path)
- [ ] Auto-refresh paused before editor launch, resumed after
- [ ] Writing content in editor and saving pre-fills the TextInput
- [ ] Empty editor save shows toast "Comment cancelled (empty)"
- [ ] Temp directory created via `mkdtempSync`, deleted in `finally`
- [ ] TUI renders correctly after returning from editor
- [ ] `ctrl+e` before any text is typed: opens editor with empty file

### Phase 4: Natural Language Issue Creation

**Deliverables:**
- `chrono-node` dependency added (dynamically imported)
- `src/ai.ts` with heuristic + optional LLM extraction
- `overlay:createNl` mode in state machine
- `NlCreateOverlay` component with `isParsing`/`parsed` boolean state
- Env-var-only AI key detection (no `ai.json`)
- Prompt injection defense

**Files:** `use-ui-state.ts`, `dashboard.tsx`, `nl-create-overlay.tsx`, `ai.ts`, `github.ts` (add `fetchRepoLabelsAsync`)

**Acceptance criteria:**
- [ ] `I` opens NL input overlay
- [ ] `I` with empty `config.repos`: toast "No repos configured — run hog init", no overlay
- [ ] Heuristic parser extracts `#label`, `@user`, `due <date>`, title from input
- [ ] Empty title after stripping tokens: inline "Title is required" error, stays in input
- [ ] `due friday` → resolves to the upcoming Friday's ISO date
- [ ] chrono-node `forwardDate` year post-check applied (bug #240)
- [ ] `due <expression>` that fails to parse: shown as `(unrecognized date)` in preview, not applied
- [ ] User `#label` tokens validated against fetched label allowlist before passing to `gh`
- [ ] Preview shows: Title, Repo, Labels (with "not found" warning), Assignee, Due (with label note)
- [ ] `Enter` on preview creates the issue, applies due label if date was parsed
- [ ] `gh issue create` failure: overlay stays open, error shown inline (not closed)
- [ ] `Escape` in any sub-state cancels and returns to normal
- [ ] **Without API key:** heuristic-only, no visible difference, no error
- [ ] **With `OPENROUTER_API_KEY`:** LLM extraction runs, "Parsing..." spinner shown during call
- [ ] LLM prompt uses XML delimiters; user text in USER role only
- [ ] **LLM timeout (5s):** silently falls back to heuristic result (uses `AbortSignal.timeout(5_000)`)
- [ ] **LLM error (non-2xx):** toast "AI parsing unavailable, used keyword matching", heuristic result used
- [ ] API key never appears in error messages or toasts
- [ ] `I` pressed on header/task/activity: uses default repo (first in config)
- [ ] `I` pressed while in search/multiSelect/overlay: no-op (guarded by `canAct`)
- [ ] Unit tests for `ai.ts`: heuristic parser and LLM response normalization
- [ ] Coverage threshold maintained

---

## TypeScript Implementation Notes

### `getClipboardArgs` return type

```typescript
// src/clipboard.ts
export function getClipboardArgs(): readonly string[] | null {
  if (process.platform === "darwin") return ["pbcopy"] as const;
  if (process.platform === "win32") return ["clip"] as const;
  if (process.env["WSL_DISTRO_NAME"] ?? process.env["WSL_INTEROP"])
    return ["clip.exe"] as const;
  if (process.env["WAYLAND_DISPLAY"]) return ["wl-copy"] as const;
  if (process.env["DISPLAY"]) return ["xsel", "--clipboard", "--input"] as const;
  return null;
}
```

### `dueDate` discriminated union

```typescript
// Avoid: Date | null (ambiguous — was it parsed? was it rejected?)
// Use: discriminated union
type DueDate =
  | { parsed: true; value: Date; label: string }   // "due:2026-02-21"
  | { parsed: false; raw: string };                  // "(unrecognized date)"
```

### LLM response type

```typescript
// Minimal structural type (no SDK needed)
interface LlmChoice {
  message: { content: string | null };
}
interface LlmResponse {
  choices: LlmChoice[];
}

// Access safely
const content = (data as LlmResponse).choices[0]?.message.content ?? null;
```

### `noUncheckedIndexedAccess` guard pattern

```typescript
// Token loop — array access returns `string | undefined` with noUncheckedIndexedAccess
for (let i = 0; i < tokens.length; i++) {
  const token = tokens[i];
  if (token === undefined) continue;  // required guard
  // ... process token
}
```

### `AbortSignal.timeout` (not `AbortSignal.any`)

```typescript
// CORRECT: use timeout directly
const response = await fetch(url, {
  signal: AbortSignal.timeout(5_000),
  // ...
});

// WRONG: AbortSignal.any() has Node.js GC bug #57736
// const ac = new AbortController();
// const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(5_000)]);
```

### `useRef` for async state

```typescript
// In NlCreateOverlay — the abort controller must survive re-renders
const abortRef = useRef<AbortController | null>(null);

// In useEffect cleanup
useEffect(() => {
  return () => { abortRef.current?.abort(); };
}, []);
```

---

## chrono-node Implementation Notes

### `forwardDate` year bug (#240) post-check

```typescript
import { parseDate, parse } from "chrono-node";

function parseDueDate(text: string, now: Date): Date | null {
  const results = parse(text, now, { forwardDate: true });
  if (results.length === 0) return null;

  // Verify full match — reject partial matches (e.g., "ah" parses as time offset)
  const result = results[0];
  if (!result) return null;

  let date = result.date();

  // Bug #240: forwardDate may not advance year — post-check
  if (date.getTime() < now.getTime()) {
    date = new Date(date);
    date.setFullYear(date.getFullYear() + 1);
  }

  // Reject past dates (sanity check)
  if (date.getTime() < now.getTime() - 60_000) return null;

  return date;
}
```

### False positive rejection

Common false positives: "asap", "soon", "ah" (parses as time offset). Prefer `parse()` over `parseDate()` to verify the full match text is a recognizable date expression.

---

## Alternative Approaches Considered

### NL: Using Anthropic SDK (not native fetch)

Rejected. The project uses native `fetch` throughout (`api.ts`). Adding the Anthropic SDK adds ~1MB to the bundle and couples the version. OpenRouter's OpenAI-compatible API works perfectly with a plain `fetch` call. If the user has an Anthropic API key (not OpenRouter), we call `https://api.anthropic.com/v1/messages` directly with the appropriate headers.

### NL: Replacing `n` with `I`

Rejected. The `n` form is faster for power users who know exactly what title they want. `I` is for free-form thinking. Both serve different modes of working.

### NL: Server-side parsing (local LLM / Ollama)

Deferred. The user base uses macOS laptops; installing Ollama is a separate setup step. OpenRouter handles the LLM API routing without requiring a local model.

### NL: `[e]` edit-from-preview loop

Rejected (per simplicity review). Escape + retype achieves the same outcome without the complexity of a re-parse decision (heuristic vs LLM on second parse) and state management for "original raw string". The preview shows the raw input already.

### Labels: Eager fetch on board load

Rejected. Labels are rarely needed every session. Fetching 10 repos × `gh label list` on startup adds unnecessary latency and network calls. Lazy fetch with session caching is a better trade-off.

### Labels: `Map<string, LabelOption[]>` for cache

Rejected (per simplicity review). `Record<string, LabelOption[]>` is idiomatic React state and consistent with the rest of the codebase. `Map` requires special handling with `useState` and has no benefit here.

### AI config: `ai.json` or `auth.json` `ai` key

Deferred for MVP. Provider is fully determinable from which env var is present (`OPENROUTER_API_KEY` vs `ANTHROPIC_API_KEY`). Adding a config key adds user-facing complexity with no current benefit. Can be revisited if per-project model configuration is needed.

### Due date: GitHub Project target date field (not label)

Noted as a future improvement. The existing `targetDate` field from `fetchProjectEnrichment` shows dates set via the GitHub Project board. Setting it requires a GraphQL mutation (`updateProjectV2ItemFieldValue` with a `DateValue`). This is architecturally sound but adds complexity to Phase 4. Using a `due:YYYY-MM-DD` label as MVP is simpler, consistent with the `priority:*` convention, and can be upgraded later.

---

## Dependencies & Prerequisites

- Phase 0 is optional but strongly recommended before Phase 2+
- Phase 1 is self-contained — no blockers
- Phase 2 requires Phase 1 (new UIMode additions; label cache reused in Phase 4)
- Phase 3 requires no other phases (but benefits from Phase 0 ink-instance extraction)
- Phase 4 requires Phase 2 (label cache from `fetchRepoLabelsAsync` is reused for heuristic label validation)

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `$EDITOR` + Ink raw mode corruption | Medium | High | Use `useStdin().setRawMode()` not direct stdin; restore in `finally`; prototype in isolation first; test with vim, nano, code |
| `ctrl+e` dual-handler (TextInput + CommentInput) | High | High | Transition to "editing" sub-state first; launch editor in useEffect after TextInput unmount |
| Event loop block from label fetch | High | Medium | `fetchRepoLabelsAsync` only; show loading spinner; never use `execFileSync` in React render |
| LLM prompt injection | Medium | Medium | XML delimiter wrapping; user text in USER role only |
| LLM latency makes NL create feel slow | Medium | Medium | 5s timeout + immediate heuristic fallback shown in preview |
| `dashboard.tsx` exceeds maintainable size | High | Medium | Phase 0 extraction before adding new overlays |
| OpenRouter model availability changes | Low | Low | Model string is a config-level constant; easy to update |
| Terminal status confirm prompt adds friction | Low | Low | Only appears when `completionAction: closeIssue` is configured |
| `chrono-node` year bug / false positives | Medium | Low | Post-check for past dates; `parse()` not `parseDate()`; null → `(unrecognized date)` in preview |
| API key leakage in error messages | Low | High | Sanitize all error messages with `Bearer [REDACTED]` replacement |

---

## Acceptance Criteria (Summary)

### Functional

- [ ] Board starts expanded; Activity section starts collapsed
- [ ] `C` collapses all sections
- [ ] Collapsed headers show item count
- [ ] `l` opens label picker; can add and remove labels; orphaned labels shown
- [ ] `CreateIssueForm` passes selected labels to `gh issue create`
- [ ] `ctrl+e` in comment mode opens `$EDITOR` (`VISUAL ?? EDITOR ?? "vi"`)
- [ ] `y` works on macOS, Linux (xsel), Wayland (wl-copy), WSL (clip.exe), Windows (clip)
- [ ] Terminal statuses visible in StatusPicker with inline confirmation guard
- [ ] `I` key opens NL create overlay
- [ ] Heuristic parser extracts labels, assignee, date, title without API key
- [ ] LLM extraction runs when `OPENROUTER_API_KEY` is set; degrades gracefully on error
- [ ] Empty title detection in NL input
- [ ] `gh issue create` failure keeps overlay open for retry

### Non-Functional

- [ ] No synchronous `gh` calls on render thread (all label fetches async)
- [ ] `chrono-node` is the only new production dependency (dynamically imported)
- [ ] No Anthropic SDK added (pure fetch)
- [ ] All LLM calls use `AbortSignal.timeout(5_000)` (not `AbortSignal.any()`)
- [ ] API keys never logged or output to console (sanitized in error messages)
- [ ] 80% coverage threshold maintained across all phases
- [ ] `dashboard.tsx` stays under 1000 lines (via Phase 0 extraction)
- [ ] Prompt injection defense: user text in USER role with XML delimiters

---

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-02-15-hog-board-command-center-brainstorm.md` (deferred AI features)
- State machine: `src/board/hooks/use-ui-state.ts`
- Actions: `src/board/hooks/use-actions.ts`
- Navigation: `src/board/hooks/use-navigation.ts`
- GitHub wrapper: `src/github.ts`
- Auth config: `src/config.ts` (AuthData interface)
- TickTick HTTP client (fetch pattern to follow): `src/api.ts`
- Existing create form: `src/board/components/create-issue-form.tsx`
- Dead `labels` param: `src/board/hooks/use-actions.ts:321-326`
- Terminal status filter: `src/board/components/dashboard.tsx:756`
- Existing `assignIssueAsync` (async `gh` pattern to follow): `src/github.ts`

### External

- OpenRouter Chat API: `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible)
- chrono-node: `https://github.com/wanasit/chrono`
- chrono-node bug #240 (forwardDate year): `https://github.com/wanasit/chrono/issues/240`
- Ink useInput: `https://github.com/vadimdemedes/ink#useinput`
- Ink useStdin (raw mode): `https://github.com/vadimdemedes/ink#usestdin`
- Node.js AbortSignal.any GC bug #57736: `https://github.com/nodejs/node/issues/57736`
- xclip pipe-hang issue: well-documented Linux clipboard bug; use `xsel` instead
