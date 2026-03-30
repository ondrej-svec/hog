# hog

[![CI](https://github.com/ondrej-svec/hog/actions/workflows/ci.yml/badge.svg)](https://github.com/ondrej-svec/hog/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@ondrej-svec/hog)](https://www.npmjs.com/package/@ondrej-svec/hog)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/@ondrej-svec/hog)](https://nodejs.org)

**The Rails of agent-assisted development.** One right way. Convention over configuration. `hog init` and go.

## What is hog?

AI agents write code. They also write tests that pass by construction, skip edge cases, and mark their own homework. The feedback loop collapses.

hog enforces a TDD-locked pipeline where no agent can see what the previous one wrote:

- The **test writer** gets the spec. It cannot read the codebase.
- The **implementer** gets failing tests. It cannot read the spec.
- The **red team** gets the implementation. It tries to break it.
- The **ship agent** produces docs, verifies operational readiness, and captures knowledge.

The result is code where tests were written adversarially, not collaboratively.

```
brainstorm → stories → tests (RED) → impl (GREEN) → red team → merge → ship
```

One command starts the pipeline. The cockpit TUI watches it run. You come back to tested, reviewed, documented code.

---

## Requirements

| Dependency | Required | Purpose |
|------------|----------|---------|
| [Node.js 22+](https://nodejs.org) | Yes | Runtime |
| [Claude Code](https://claude.ai/code) | Yes | AI agent runtime |
| [Beads](https://github.com/steveyegge/beads) (`bd` CLI) | Yes | DAG-based phase gating |
| [GitHub CLI](https://cli.github.com/) (`gh`) | No | Issue sync |
| [tmux](https://github.com/tmux/tmux) | No | Agent session attachment |

## Quick Start

```sh
npm install -g @ondrej-svec/hog
hog init                              # interactive setup (installs Beads, checks deps)
hog pipeline create "Add user auth"   # start your first pipeline
hog cockpit                           # watch it run
```

<details>
<summary><strong>Recommended: Heart of Gold Toolkit</strong> (Claude Code plugins)</summary>

hog works best with the [Heart of Gold toolkit](https://github.com/ondrej-svec/heart-of-gold-toolkit) — Claude Code plugins that provide skill-based pipeline intelligence with Stop hooks, knowledge directories, and quality enforcement.

```sh
# Install the toolkit marketplace
claude plugin install heart-of-gold-toolkit

# Enable the pipeline plugins in Claude Code settings (~/.claude/settings.json)
# Add to "enabledPlugins":
#   "marvin@heart-of-gold-toolkit": true,
#   "deep-thought@heart-of-gold-toolkit": true
```

**Without the toolkit:** hog falls back to bundled prompts. The pipeline still runs, but you lose Stop hooks (machine-enforced RED state, architecture verification), knowledge directories, and skill-specific quality gates.

| Plugin | Skills | Purpose |
|--------|--------|---------|
| **marvin** | `scaffold`, `test-writer`, `work`, `redteam`, `review`, `ship` | Execution: TDD test writing, implementation, adversarial review, merge gating, shipping |
| **deep-thought** | `brainstorm`, `architect`, `plan`, `review`, `think`, `investigate` | Thinking: problem exploration, architecture design, strategic planning |

Each skill works standalone (`/marvin:test-writer`) AND in pipeline mode (hog passes context via env vars).

</details>

---

## The 8 Phases

| Phase | Role | Skill | What it does | Structural constraint (enforced) |
|-------|------|-------|-------------|----------------------------------|
| **Brainstorm** | Human + AI | `deep-thought:brainstorm` | Interactive exploration of the problem space | Only phase with human involvement |
| **Architect** | Autonomous | `deep-thought:architect` | Writes user stories + architecture doc (ADRs, dependencies, file structure) | Cannot write code |
| **Scaffold** | Autonomous | `marvin:scaffold` | Creates dirs, installs deps, sets up tooling | Cannot create source or test files |
| **Tests** | Autonomous | `marvin:test-writer` | Writes tests that FAIL (RED state) — behavioral + conformance | Cannot read the spec — only stories |
| **Implementation** | Autonomous | `marvin:work` | Makes tests pass with REAL implementations — architecture doc is BINDING | Cannot modify tests |
| **Red Team** | Adversarial | `marvin:redteam` | Writes new failing tests exposing architecture violations, stubs, security issues | Cannot modify implementation |
| **Merge** | Autonomous | `marvin:review` | Runs full suite, linter, security scan — MERGE or BLOCK verdict | Cannot fix — only reports |
| **Ship** | Autonomous | `marvin:ship` | README, changelog, deployment guide, knowledge docs, operational readiness | Cannot modify source or tests |

**Key insight:** The test writer and implementer have different context windows. The implementer can only see failing tests, not the original spec. This prevents the most common AI coding failure mode — writing tests that pass by construction.

### RED Verification

Before the implementation agent spawns, hog verifies tests are actually failing:

```
verifyRedState(projectDir)
  → runs test suite
  → if tests PASS → reopens test phase (tests were testing existing code, not new behavior)
  → if tests FAIL → proceed to implementation
```

### Retry Loops

Quality gates automatically loop agents back when issues are found:

- **Red team** finds failing tests → reopens impl (+ merge + ship)
- **Merge** blocks → reopens impl (+ merge + ship)
- **Ship** finds operational gaps (hardcoded secrets, missing health check) → reopens impl (+ redteam + merge + ship)

Each gate has a retry limit before escalating to the human.

---

## How It Works

1. `hog pipeline create` creates a [Beads](https://github.com/steveyegge/beads) dependency DAG with 8 phases
2. The `hogd` daemon polls `bd ready` and spawns role-separated Claude agents as phases unblock
3. Each agent runs in an isolated git worktree with a role-specific prompt and restricted context
4. On completion, the bead closes and downstream phases become ready
5. The Refinery merges completed work: rebase → test → quality gates → fast-forward merge
6. The ship phase produces documentation and verifies operational readiness

**No GitHub required.** The pipeline runs entirely locally via Beads. GitHub is an optional sync target.

---

## Cockpit TUI

`hog cockpit` opens a terminal dashboard showing pipeline status:

```
┌─ Add user authentication ─────────────────────────────────┐
│ brainstorm ◐ → stories · → scaffold · → tests · →        │
│ impl · → redteam · → merge · → ship ·                    │
│                                                           │
│ Brainstorm session should be open — press Z to reopen     │
├─ Activity ────────────────────────────────────────────────┤
│ No activity yet                                           │
│                                                           │
└───────────────────────────────────────────────────────────┘
 gates: ○ lint ○ typecheck ○ security ○ mutation ○ suite
P:new  j/k:nav  Z:brainstorm  x:pause  d:cancel  l:log  ?:help  q:quit
```

With multiple pipelines, a list panel appears on the left with progress bars. Decisions show inline with numbered options (`1-9` to answer).

| Key | Action |
|-----|--------|
| `P` | Start new pipeline |
| `j` / `k` | Navigate pipelines |
| `1-9` | Answer pending decision |
| `x` | Pause / resume |
| `d` | Cancel pipeline |
| `Z` | Open brainstorm session (tmux) |
| `l` | Open pipeline log (tmux) |
| `?` | Help |
| `q` | Quit |

---

## Commands

### Pipelines

```sh
hog pipeline create "Add OAuth login"        # start a pipeline
hog pipeline create --brainstorm-done "..."   # skip brainstorm phase
hog pipeline list                             # show all pipelines
hog pipeline status <featureId>               # detailed status + DAG
hog pipeline pause <featureId>                # pause
hog pipeline resume <featureId>               # resume
hog pipeline done <featureId>                 # advance to next phase
hog pipeline cancel <featureId>               # cancel and clean up
hog pipeline review <featureId>               # structured summary + decision log
hog pipeline watch <featureId>                # stream live events from daemon
hog pipeline replay <featureId>               # replay a recorded run
hog pipeline compare <id1> <id2>              # side-by-side run comparison
```

### Human Decisions

Agents batch questions for humans instead of blocking. Resolve them in bulk:

```sh
hog decisions                                 # list pending decisions
hog decisions --resolve <id> --answer "..."   # answer a question
```

### Quality Policies

Declarative quality gates as YAML in `.hog/policies/`:

```sh
hog policy list                               # show active policies
hog policy add typescript                     # install a language preset
hog policy check                              # run all policies CI-style
hog policy remove <name>                      # remove a policy
```

### Daemon

The `hogd` daemon owns all pipeline state. CLI and cockpit are thin IPC clients:

```sh
hog daemon start                              # start background daemon
hog daemon start --foreground                 # keep in terminal
hog daemon stop                               # stop daemon
hog daemon logs                               # show event log
hog daemon logs --follow                      # tail event log
```

### Beads

```sh
hog beads status                              # Dolt server status
hog beads start                               # start Dolt server
hog beads stop                                # stop Dolt server
```

### Other

```sh
hog init                                      # interactive setup wizard
hog cockpit                                   # pipeline monitoring TUI
hog demo                                      # simulated pipeline (no external deps)
hog launch owner/repo#42                      # open Claude session for a GitHub issue
```

Every command supports `--json` for structured output.

---

## Configuration

Config: `~/.config/hog/config.json` (schema version 5).

```jsonc
{
  "version": 5,
  "pipeline": {
    "owner": "your-username",
    "maxConcurrentAgents": 3,
    "launchMode": "tmux",              // "auto" | "tmux" | "terminal"
    "worker": "claude",                // "claude" | "codex" | "custom"
    "tddEnforcement": true,
    "models": {                        // per-phase model routing
      "brainstorm": "opus",
      "test": "sonnet",
      "impl": "sonnet",
      "redteam": "opus"               // different model prevents mode collapse
    },
    "qualityGates": {
      "linting": true,
      "security": true,
      "abusePatterns": true,
      "mutationThreshold": 70
    },
    "budget": {
      "perPipeline": 50.00,
      "perPhase": 15.00
    }
  },
  "repos": [
    {
      "name": "owner/repo",
      "shortName": "repo",
      "localPath": "/path/to/repo"
    }
  ]
}
```

### Key config options

| Option | Purpose |
|--------|---------|
| `pipeline.worker` | AI backend adapter: `claude`, `codex`, or `custom` |
| `pipeline.models` | Per-phase model routing (use different models for adversarial roles) |
| `pipeline.tddEnforcement` | RED state verification before implementation (default: true) |
| `pipeline.qualityGates` | Linting, security scanning, abuse pattern detection, mutation threshold |
| `pipeline.budget` | Spend limits per pipeline and per phase |
| `pipeline.permissionMode` | Claude Code permission mode: `auto`, `acceptEdits`, `bypassPermissions` |
| `repos[]` | Project directories with optional GitHub integration |

---

## GitHub Integration (optional)

hog can sync pipeline phase transitions to GitHub Issues:

- **Labels:** Each phase adds a label (e.g., `phase:red`, `phase:green`)
- **Comments:** Phase completion posted as issue comments
- **Completion:** Issue closed or labeled when pipeline finishes

```sh
hog pipeline create --issue owner/repo#42 "Implement OAuth"  # link to existing issue
hog pipeline create --create-issue "Add search"              # create issue + pipeline
```

GitHub integration requires the [GitHub CLI](https://cli.github.com/) (`gh`).

---

## Architecture

Three-layer stack:

```
┌─────────────────────────────────────┐
│  Human Layer                        │
│  GitHub Issues · CLI · Cockpit TUI  │
├─────────────────────────────────────┤
│  Hog Engine (hogd)                  │
│  Conductor · Agent Manager ·        │
│  Refinery · Quality Gates · Retry   │
│  Engine · Ship Detection            │
├─────────────────────────────────────┤
│  Beads Layer                        │
│  DAG task memory · bd CLI · Dolt    │
└─────────────────────────────────────┘
```

The daemon/client split means the cockpit, CLI, and future integrations all read the same consistent state. All pipeline state lives in Beads (a local Dolt database), so pipelines survive CLI restarts and the audit trail is queryable. The retry engine handles feedback loops declaratively — each quality gate specifies which phases to reopen and how many beads to decrement, rather than embedding retry logic inline.

---

## Troubleshooting

**`hog cockpit` shows no pipelines**
Make sure the daemon is running: `hog daemon start`. Check `hog daemon logs` for errors.

**`bd: command not found`**
Beads is a required dependency. Install from [github.com/steveyegge/beads](https://github.com/steveyegge/beads). Run `hog init` to verify setup.

**Agent stuck / pipeline not advancing**
Run `hog pipeline status <id>` to see the current phase and any pending decisions. Check `hog daemon logs --follow` for gate failures or retry loops.

**Config schema error on upgrade**
Run `hog init` to re-run the setup wizard. Your existing pipelines are unaffected.

**Pipeline blocked on a decision**
Check `hog decisions` for pending questions, or use the cockpit (`1-9` keys to answer inline).

---

## Contributing

```sh
git clone https://github.com/ondrej-svec/hog
cd hog
npm install
npm run dev -- cockpit              # run from source
npm run test                        # vitest
npm run ci                          # typecheck + lint + tests
```

**Architecture:** Engine in `src/engine/` (Conductor, Refinery, quality gates, retry engine, ship detection). Daemon in `src/daemon/`. TUI cockpit in `src/board/` (Ink/React).

**Commits:** [Conventional commits](https://www.conventionalcommits.org/) — release-please generates changelogs automatically.

**Tests:** Every PR needs tests. 80% coverage threshold enforced. Tests live alongside source as `*.test.ts`. Integration tests use `*.integration.test.ts`.

**Toolchain:** TypeScript (strict), [Biome](https://biomejs.dev/) for lint/format, [tsup](https://tsup.egoist.dev/) for bundling, [Vitest](https://vitest.dev/) for tests.

---

## License

MIT
