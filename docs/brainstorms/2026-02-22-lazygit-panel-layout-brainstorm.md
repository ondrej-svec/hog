# Brainstorm: lazygit-style multi-panel layout

**Date:** 2026-02-22
**Status:** Ready for planning
**Scope:** Board UX redesign — 5-panel lazygit-inspired layout, TickTick separation

---

## What We're Building

A fundamental rethink of `hog board --live` from a tab-based single-column list to a **5-panel lazygit-inspired TUI**. The board becomes a pure GitHub interface with a clean spatial hierarchy: Repos → Statuses → Issues, with persistent Detail context and a full-width Activity strip at the bottom. TickTick drops to invisible infrastructure.

---

## The Layout

### Wide (≥160 cols) — full 3-column grid

```
┌──────────────┬──────────────────────┬──────────────────────┐
│ [1] Repos    │                      │                      │
│ ▶ org/api   │   [3] Issues         │   [0] Detail         │
│   org/web   │   ▶ #142 Fix auth    │   #142 Fix auth bug  │
│   org/infra │     #143 Logging     │   State: open · @me  │
├──────────────┤     #144 Perf        │   Status: In Prog    │
│ [2] Statuses │                      │   ─────────────────  │
│ ▶ In Prog 6 │                      │   The auth flow is   │
│   Review  4  │                      │   broken when...     │
│   Backlog 2  │                      │                      │
│              │                      │   Comments (3):      │
│              │                      │   @alice: LGTM       │
├──────────────┴──────────────────────┴──────────────────────┤
│ [4] Activity (full width)                                  │
│ 2h @alice commented on #142 — "LGTM"          (org/api)   │
│ 4h @bob opened #145 — "Add dark mode"          (org/web)  │
└────────────────────────────────────────────────────────────┘
 j/k move  p pick  m status  c comment  / search  ? help
```

Column proportions: Left ~20%, Issues ~30%, Detail ~50%

### Medium (100–159 cols) — left col + Issues, Detail hidden

```
┌──────────────┬───────────────────────────────────────────┐
│ [1] Repos    │   [3] Issues (wider)                      │
│ ▶ org/api   │   ▶ #142 Fix auth bug                     │
│   org/web   │     #143 Add logging                      │
├──────────────┤     #144 Perf issue                       │
│ [2] Statuses │                                           │
│ ▶ In Prog 6 │   (Detail: press 0 to open as overlay)    │
│   Review  4  │                                           │
├──────────────┴───────────────────────────────────────────┤
│ [4] Activity (full width)                                │
│ 2h @alice commented on #142                 (org/api)   │
└──────────────────────────────────────────────────────────┘
 j/k move  p pick  m status  / search  0 detail  ? help
```

### Narrow (<100 cols) — fully stacked

```
┌───────────────────────┐
│ [1] Repos             │  ← compact, 2-3 rows
│ ▶ org/api         12  │
├───────────────────────┤
│ [2] Statuses          │  ← compact, 3-4 rows
│ ▶ In Progress     6   │
│   Review          4   │
├───────────────────────┤
│ [3] Issues            │  ← fills remaining height
│ ▶ #142 Fix auth bug   │
│   #143 Add logging    │
├───────────────────────┤
│ [4] Activity          │  ← 3 rows at bottom
│ 2h @alice → #142      │
└───────────────────────┘
 j/k  p  m  /  ? help
```

Detail hidden in narrow mode (press 0 to open as full-screen overlay).

---

## The Five Panels

| Panel | Key | Content | Primary interactions |
|-------|-----|---------|----------------------|
| **Repos** | `1` | Tracked repos with open issue count | `j/k` navigate, `Enter` filter Issues |
| **Statuses** | `2` | Status groups for selected repo + counts | `j/k` navigate, `Enter` filter Issues |
| **Issues** | `3` | Issues filtered by repo+status | `j/k` navigate, all action keys (`p`, `m`, `c`, `a`, `n`, etc.) |
| **Detail** | `0` | Persistent context for selected issue | `j/k` scroll body/comments |
| **Activity** | `4` | Recent events (last 24h, all repos) | `j/k` scroll, `Enter` jump to issue in [3] |

### Hierarchy

Selecting in Repos → updates Statuses → updating selection in Statuses → updates Issues. It's a drill-down: you navigate left-to-right through the hierarchy.

### Focus model

Identical to lazygit: press the panel number to focus it. Focused panel gets a **bright/bold border**; inactive panels are **dimmed**. No Tab-based panel cycling — numbers only.

```
1 → Repos     2 → Statuses     3 → Issues     4 → Activity     0 → Detail
```

`j/k` always navigate the focused panel's list. Global keys (`?`, `q`, `r`, `/`) work regardless of focus.

---

## Navigation flows

### Normal workflow
1. Start in Issues [3] (default focus on launch, last-used repo pre-selected)
2. Press `1` → jump to Repos, select a different repo with `j/k Enter`
3. Focus auto-jumps back to Issues [3] after selecting
4. Press `2` → jump to Statuses, filter to "Review" with `j/k Enter`
5. Focus auto-jumps back to Issues [3]

### Activity → Issue jump
1. Press `4` → focus Activity
2. `j/k` to navigate events
3. `Enter` on an event: Issues [3] filters to that repo + scrolls to that issue, focus jumps to [3], Detail [0] updates

### Detail on medium terminals
On 100–159 col terminals, Detail is hidden. Press `0` to open Detail as a right-side overlay on top of Issues. Press `0` or `Esc` to close.

---

## TickTick Separation

Board = pure GitHub UI. TickTick = invisible sync infrastructure.

**Removed from board:**
- `Tasks` tab gone
- `TaskRow` components gone
- TickTick detail view gone

**Pick workflow (`p` key) unchanged behavior:**
```
ticktick.enabled: true
  p → assign on GitHub + create TickTick task silently
  → toast: "✓ Picked #142 — assigned + synced"

ticktick.enabled: false
  p → assign on GitHub only
  → toast: "✓ Picked #142 — assigned"
```

---

## Hint bar

Context-sensitive — 1 row at the very bottom, changes based on focused panel:

| Focused panel | Hint bar content |
|--------------|-----------------|
| Repos [1] | `j/k move  Enter filter  ? help` |
| Statuses [2] | `j/k move  Enter filter  Esc clear  ? help` |
| Issues [3] | `j/k move  p pick  m status  c comment  / search  n new  ? help` |
| Activity [4] | `j/k scroll  Enter jump-to-issue  r refresh  ? help` |
| Detail [0] | `j/k scroll  Esc close  ? help` |

---

## Keyboard changes from current model

| Current | New |
|---------|-----|
| `1-9` jump to repo tab by index | `1-4` focus panels, `0` focuses/toggles detail |
| `Tab` cycles repo tabs | `Tab` freed (no longer needed — repos/statuses are panels) |
| `s/S` next/prev status sub-tab | No longer needed (statuses are panel [2]) |
| Activity = non-navigable tab | Activity = navigable panel [4] |
| Tasks tab with TickTick rows | Removed entirely |

---

## Architectural changes

| Component | Change |
|-----------|--------|
| `use-panel-focus.ts` | **New** — which panel has focus, panel-specific key routing |
| `PanelLayout` component | **New** — handles 3 breakpoints, renders columns vs stacked |
| `ReposPanel` component | **New** — replaces repo `TabBar` |
| `StatusesPanel` component | **New** — replaces `StatusTabBar` sub-tabs |
| `ActivityPanel` component | **New** — wraps existing activity rendering, adds j/k + Enter-jump |
| `use-keyboard.ts` | **Modified** — routes keys to focused panel |
| `dashboard.tsx` | **Modified** — new layout orchestration, panel focus wiring |
| `use-ui-state.ts` | **Simplified** — no more `tab` mode transitions |
| `TabBar` | **Removed** |
| `StatusTabBar` | **Removed** (or repurposed as StatusesPanel internals) |
| `IssueRow`, `DetailPanel` | **Unchanged** |
| `use-actions.ts`, `use-data.ts` | **Unchanged** |
| Overlay components | **Unchanged** — still render on top of panel layout |

---

## Open Questions

1. **`Tab` key fate** — freed from repo cycling. Options: (a) keep as unused, (b) cycle focus between panels as alternative to number keys, (c) use as shortcut within Issues for something else.

2. **Search scope** — does `/` search apply within the focused panel's list only (current repo+status), or globally across all repos regardless of selection in [1]/[2]?

3. **Default startup state** — on launch, should focus default to Issues [3] showing the first repo, or show all repos' issues combined until the user selects one in [1]?

4. **Repos panel count format** — just total open count (`org/api  12`) or something richer? Status breakdown would be redundant given [2] Statuses panel.

---

## Resolved Decisions

| Decision | Resolution |
|----------|-----------|
| Number of panels | 5 (Repos, Statuses, Issues, Activity, Detail) |
| Panel layout | 3-column grid + bottom Activity strip (wide), 2-column (medium), stacked (narrow) |
| Breakpoints | <100 stacked, 100-159 left+issues, ≥160 full |
| Repos → Issues relationship | Selecting repo filters Issues, auto-returns focus to [3] |
| Statuses panel | First-class panel [2], not sub-tabs inside Issues |
| Panel focus model | Number keys only (1/2/3/4/0), lazygit style |
| Hint bar | Context-sensitive per focused panel |
| Activity interactivity | Navigable (j/k), Enter jumps to issue in [3] |
| Activity → issue jump | Filters [1]+[2], selects issue in [3], focus moves to [3] |
| TickTick in board | Removed entirely from display |
| Pick workflow | Silent TickTick sync if enabled, board shows nothing TickTick |
| Responsive strategy | Automatic breakpoints based on terminal width, no configuration needed |

---

## Success Criteria

- `hog board --live` on ≥160 col terminal shows all 5 panels immediately
- Pressing `1`/`2`/`3`/`4`/`0` visibly changes the focused panel (bright border)
- Selecting a repo in [1] instantly filters Issues [3] and returns focus to [3]
- Selecting a status in [2] instantly filters Issues [3] and returns focus to [3]
- On <100 col terminal, all panels stack and remain usable
- No TickTick rows anywhere in the board
- Activity panel is navigable; Enter jumps to the issue
- Context-sensitive hint bar shows correct shortcuts
- All existing issue actions (pick, comment, status change, create, assign, labels, bulk) work from Issues [3]
- Overlays (create issue, status picker, comment, bulk actions, search) still function identically
