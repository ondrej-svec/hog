---
date: 2026-03-01
topic: workflow-conductor
---

# Hog as Workflow Conductor

## What We're Building

Transform hog from a display dashboard into an **air traffic control system** for development and creative work. The core insight: developers' project state is scattered across 5 disconnected places (GitHub, local files, terminal windows, their head, todo apps). Hog becomes the central nervous system that makes the invisible visible, automates the administrative burden, and reduces the activation energy for starting and finishing work.

The system has three roles:
1. **Perceive** — know the state of all issues, artifacts, and agent sessions
2. **Suggest** — surface what's next, nudge on stale work, offer help finishing
3. **Act** — launch agents, update GitHub status, track sessions, schedule background work

## Why This Approach

We evaluated three system architectures:
- **Derive state from artifacts** — elegant but can't track agent sessions
- **Hog-managed state file** — rich but creates a parallel universe that drifts from reality
- **GitHub as source + local enrichment** (chosen) — shared truth visible to teammates and CI, with local enrichment for agent sessions and artifact tracking. Hog already reads GitHub Project status fields and has configurable status mappings.

We evaluated three agent interaction models:
- **Fire-and-forget** — too opaque for creative phases like brainstorming
- **Agent SDK integration** — too coupled, turns the cockpit into the engine
- **Streaming monitor with session capture** (chosen) — ambient awareness of running agents via `claude -p --output-format stream-json`, plus session ID capture for interactive resumption via `claude --resume <id>`. Low coupling, graceful degradation to fire-and-forget.

## Key Decisions

### 1. GitHub is the source of truth for issue lifecycle

GitHub Project status fields ARE the lifecycle phases. Hog reads them (already does), and now also auto-updates them based on detected events:
- Branch created → move to In Progress
- PR opened → move to Review
- PR merged → move to Done

Local enrichment file (`~/.config/hog/enrichment.json`) tracks what GitHub can't: active agent sessions, artifact paths, phase timing history.

### 2. Phases are configurable per repo, not hardcoded

Code repos get a suggested sequence: `brainstorm → plan → implement → review → compound`. Creative repos (blog, writing) can be free-form or define their own sequences. The system suggests but never blocks — phases are capabilities, not gates.

```json
{
  "repos": [{
    "name": "owner/code-repo",
    "workflow": {
      "mode": "suggested",
      "phases": ["brainstorm", "plan", "implement", "review", "compound"]
    }
  }, {
    "name": "owner/blog",
    "workflow": {
      "mode": "freeform",
      "phases": ["outline", "draft", "edit", "publish"]
    }
  }]
}
```

### 3. Interactive phases vs background phases

Not all phases should run autonomously. The division:

| Phase | Mode | Rationale |
|-------|------|-----------|
| Brainstorm | Interactive only | This IS the human-AI collaboration. The creative joy. |
| Plan | Either | Can run from brainstorm doc autonomously, or interactively for complex work. |
| Research | Background | Gathering context BEFORE interactive brainstorming. Perfect for overnight. |
| Implement | Either | Background for well-planned work. Interactive for complex/creative. |
| Review | Background preferred | Agent reads code, runs tests, produces report. Human reviews report. |
| Compound | Background always | Documenting solutions needs no human interaction. |

### 4. Helping people START work (reducing activation energy)

Two complementary mechanisms:

**Daily nudges**: When the board opens, subtle indicators on issues that have been Ready for too long. "Quick brainstorm?" suggestions that lower the first step from "implement this feature" to "have a 5-minute chat about this." Leverages Kahneman's endowment effect — once you've invested 5 minutes, you own the idea.

**Weekly batch triage**: A `hog workflow triage` command that surfaces all Ready/stale issues across repos. You select which ones to advance, and background agents do the overnight work (research, planning, review — NOT brainstorming, which needs you). Monday morning: context-rich artifacts waiting for your creative engagement.

### 5. Helping people FINISH work (three-layer system)

**Layer 1 — Visibility (always on)**: Age indicators on issues. Color coding: healthy (<7d), attention (7-14d), stale (14d+). Configurable thresholds. The board doesn't judge, but it doesn't hide reality either.

**Layer 2 — Periodic nudges**: Once-daily pulse on board open showing aging issues. Dismissable/snoozeable. Session-end prompts: "BTW #38 has been in progress 31 days — still relevant?" Not nagging, just honest.

**Layer 3 — Completion assistance (on demand)**: "Want me to check what's left on #38?" Background agent reads the plan, checks git branch state, diffs against main, reports: "70% complete. 2 tests failing. Remaining: error handling + docs." The activation energy for the last mile drops because the scope becomes clear.

### 6. The board becomes the cockpit

New UI elements:
- **Phase indicators** on each issue (what phase, how long)
- **Agent activity panel** showing running/completed background agents with streaming status
- **`[W]` key** opens a workflow menu on any issue (phase-specific launches)
- **`[r]` key** resumes the last agent session for an issue interactively
- **Nudge bar** with gentle suggestions for stale/ready issues

### 7. Multi-perspective design principles

| Thinker | Principle Applied |
|---------|------------------|
| Kahneman | Lower activation energy for starting. Endowment effect: 5-min brainstorm creates ownership. Fight planning fallacy by showing actual phase durations. |
| Cal Newport | Automate shallow work (status updates, issue admin). Protect deep work (brainstorming, creating). Batch decision-making (weekly triage). |
| Seth Godin | Reduce resistance to shipping. Every phase produces a small, shippable artifact. Make finishing feel trivial by breaking it down. |
| Neil Gaiman | Support non-linear creative flow. Free-form phases for creative repos. Session resumption means you can wander and find your way back. |
| Kim Scott | The board tells uncomfortable truths about stale issues — without judgment. Review phases surface real problems, not sycophantic praise. |
| Kate O'Neill | Every automation serves a measurable human goal. Track phase durations for process self-awareness. |
| Martin Fowler | Small, incremental, reversible steps. Each phase produces a standalone artifact. Abandoning a workflow at any point wastes nothing. |
| Hashimoto | Parallel agents during idle time. While you implement #42, agents research #45. "If I'm coding, an agent should be planning." |
| Amodei | Background agents get minimal permissions (read + write-to-docs). They cannot push, create PRs, or modify issue state. The human approves all visible actions. |
| Diamandis | Think 6 D's: this is being digitized now, will be deceptive (looks like a simple board), then disruptive (the board starts doing work for you). |
| Aaron Dignan | Don't over-process. The system adapts to how people work. Suggested sequences, not enforced pipelines. Trust the user. |

### 8. Semi-custom phases

Built-in phases (brainstorm, plan, implement, review, compound, research) have special behavior: artifact detection, status mapping, smart defaults. Users can define additional custom phases that are named prompt templates with a mode (interactive/background). This gives smart defaults for common phases + full extensibility for unique workflows.

### 9. Smart scheduling for concurrent agents

When multiple background agents run simultaneously, hog uses smart scheduling: considers system resources, API rate limits, and phase priority. Urgent reviews run before speculative research. Prevents wasted work and resource exhaustion.

### 10. Configurable notifications

Default: board toasts + agent panel updates. Optionally enable macOS/Linux native OS notifications, sound, or webhook (for Slack/Discord integration). Users choose their notification style in config.

### 11. Remove TickTick — unify on GitHub

Remove the TickTick integration entirely. Use GitHub Issues for everything, including personal todos (via personal repos like "bobo"). This dramatically simplifies the architecture: one source of truth, one API, one sync system. The existing TickTick OAuth flow, API client, and sync state can all be removed.

### 12. Personal enrichment, not team state

Enrichment data (agent sessions, phase timing, workflow state) lives in `~/.config/hog/` and is purely personal. The shared contract is GitHub status. Hog is a personal cockpit, not a team dashboard.

### 13. Shareable workflow templates from day one

Design the config format so workflow templates (phase definitions, prompts, sequences) are clean, self-contained, and publishable. A workflow template is a JSON file that can be shared, imported, and composed. Even before building a marketplace, the format is ready for organic sharing — copy-paste a config snippet and it works.

## Resolved Questions

All six original open questions were resolved through collaborative dialogue:

1. Custom phases → **Semi-custom** (built-in phases have special behavior, users can add custom named phases)
2. Concurrency → **Smart scheduling** (resource-aware, priority-based)
3. Team visibility → **Personal only** (GitHub status is the shared contract)
4. TickTick → **Remove entirely** (unify on GitHub for everything)
5. Notifications → **Configurable** (board default, optional OS/sound/webhook)
6. Sharing → **Yes, from the start** (design exportable format, organic sharing before platform)

## Next Steps

→ `/workflows:plan` for implementation details and phased delivery roadmap
