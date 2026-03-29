# hog

[![CI](https://github.com/ondrej-svec/hog/actions/workflows/ci.yml/badge.svg)](https://github.com/ondrej-svec/hog/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@ondrej-svec/hog)](https://www.npmjs.com/package/@ondrej-svec/hog)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

**The Rails of agent-assisted development.** One right way. Convention over configuration. `hog init` and go.

hog orchestrates AI agents through a TDD-enforced development pipeline with structural role separation, adversarial review, and quality gates. Describe a feature, walk away, come back to tested and reviewed code.

```
brainstorm → stories → tests (RED) → implementation (GREEN) → red team → merge
```

No agent marks its own homework. The test writer can't see the spec. The implementer can only see failing tests. The red team tries to break what was built. Structure enables autonomy.

---

## Quick Start

```sh
npm install -g @ondrej-svec/hog
hog init                              # interactive setup
hog pipeline create "Add user auth"   # start your first pipeline
hog cockpit                           # watch it run
```

**Requirements:** [Node.js 22+](https://nodejs.org) and [Beads](https://github.com/steveyegge/beads) (`bd` CLI). Optionally: [GitHub CLI](https://cli.github.com/) for issue sync, [tmux](https://github.com/tmux/tmux) for agent session attachment.

---

## How It Works

1. `hog pipeline create` creates a [Beads](https://github.com/steveyegge/beads) dependency DAG with 6 phases
2. The `hogd` daemon polls `bd ready` and spawns role-separated Claude agents as phases unblock
3. Each agent runs in an isolated git worktree with a role-specific prompt and restricted context
4. On completion, the bead closes and downstream phases become ready
5. The Refinery merges completed work: rebase → test → quality gates → fast-forward merge

**No GitHub required.** The pipeline runs entirely locally via Beads. GitHub is an optional sync target.

---

## The 6 Phases

| Phase | Role | What it does | Constraint |
|-------|------|-------------|------------|
| **Brainstorm** | Human + AI | Interactive exploration of the problem space | Only phase with human involvement |
| **Stories** | Autonomous | Writes testable user stories with acceptance criteria | Cannot write code |
| **Tests** | Autonomous | Writes tests that FAIL (RED state) | Cannot read the spec — only stories |
| **Implementation** | Autonomous | Writes minimum code to make tests pass (GREEN) | Cannot read stories — only failing tests |
| **Red Team** | Adversarial | Writes new failing tests for edge cases and security | Cannot modify implementation |
| **Merge** | Autonomous | Rebases, runs full suite, lints, security scan | Cannot fix — only reports |

**Key insight:** The test writer and implementer have different context windows. The implementer can only see failing tests, not the original spec. This prevents the most common AI coding failure mode — writing tests that pass by construction.

### RED Verification

Before the implementation agent spawns, hog verifies tests are actually failing:

```
verifyRedState(projectDir)
  → runs test suite
  → if tests PASS → reopens test phase (tests were testing existing code, not new behavior)
  → if tests FAIL → proceed to implementation
```

---

## Cockpit TUI

`hog cockpit` opens a terminal dashboard showing pipeline status:

```
▶ ◐ Add user auth    ████░░░░ 50%    ┌─────────────────────────────┐
  ✓ Search feature    ████████ 100%   │ brainstorm ✓ → stories ✓   │
  ⚠ Rate limiting     ██░░░░░░ 17%   │ → tests ✓ → impl ● →       │
                                       │ redteam ○ → merge ○        │
  Agents (1)                           │                             │
  impl · Read · 3m                     │ ⚠ DECISION NEEDED          │
                                       │ Should auth use OAuth?      │
1 pipeline · 1 agent                   │ [1] OAuth  [2] API keys    │
```

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
│  Refinery · Quality Gates · Policies│
├─────────────────────────────────────┤
│  Beads Layer                        │
│  DAG task memory · bd CLI · Dolt    │
└─────────────────────────────────────┘
```

- **Human layer**: where you interact — cockpit TUI, CLI commands, GitHub (optional)
- **Hog Engine**: the opinionated orchestration layer — role separation, TDD enforcement, quality gates, batched human interaction
- **Beads layer**: local-first, git-backed DAG that gates phase transitions

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

**Toolchain:** TypeScript (strict), [Biome](https://biomejs.dev/) for lint/format, [tsup](https://tsup.egoist.dev/) for bundling, [Vitest](https://vitest.dev/) for tests. 80% coverage threshold.

---

## Requirements

- **Node.js 22+**
- **Beads** (`bd` CLI) — DAG-based task management
- **GitHub CLI** (`gh`) — optional, for issue sync
- **tmux** — optional, for agent session attachment

---

## License

MIT
