# hog

[![CI](https://github.com/ondrej-svec/hog/actions/workflows/ci.yml/badge.svg)](https://github.com/ondrej-svec/hog/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@ondrej-svec/hog)](https://www.npmjs.com/package/@ondrej-svec/hog)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

**TDD-enforced AI development pipelines.** Structure enables autonomy.

---

## What it does

hog orchestrates AI agents through a 6-phase development pipeline with structural role separation, TDD enforcement, and quality gates. Describe a feature, walk away, come back to tested and reviewed code.

```
brainstorm → stories → tests (RED) → implementation (GREEN) → red team → merge
```

Each phase runs in an isolated git worktree with a role-specific prompt. The test writer can't see the spec. The implementer can only see failing tests. The red team tries to break what was built. No agent marks its own homework.

The pipeline is powered by [Beads](https://github.com/steveyegge/beads) — a local-first, git-backed dependency DAG that gates phase transitions via `bd ready`.

---

## Quick Start

```sh
npm install -g @ondrej-svec/hog
hog init                              # interactive setup
hog pipeline create "Add user auth"   # start your first pipeline
hog cockpit                           # watch it run
```

**Requirements:** [Node.js 22+](https://nodejs.org) and [Beads](https://github.com/steveyegge/beads) (`bd` CLI). Optionally: [GitHub CLI](https://cli.github.com/) for GitHub integration.

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

### RED verification

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

### Keyboard shortcuts

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

## Pipeline Commands

```sh
# Create and manage pipelines
hog pipeline create "Add OAuth login"        # start a pipeline
hog pipeline create --brainstorm-done "..."  # skip brainstorm phase
hog pipeline list                            # show all pipelines
hog pipeline status <featureId>              # detailed status
hog pipeline pause <featureId>               # pause
hog pipeline resume <featureId>              # resume
hog pipeline cancel <featureId>              # cancel and clean up
hog pipeline done <featureId>                # mark phase complete

# Human decisions
hog decisions                                # list pending decisions
hog decisions --resolve <id> --answer "..."  # answer a question

# Beads server
hog beads status                             # Dolt server status
hog beads start                              # start Dolt server
hog beads stop                               # stop Dolt server
```

---

## GitHub Integration (optional)

hog can optionally sync pipeline phase transitions to GitHub Issues:

- **Labels:** Each phase adds a label (e.g., `phase:red`, `phase:green`)
- **Status:** Pipeline phases map to GitHub Projects status columns
- **Comments:** Phase completion posted as issue comments

```sh
hog pipeline create --issue owner/repo#42 "Implement OAuth"  # link to existing issue
hog pipeline create --create-issue "Add search"              # create issue + pipeline
```

Configure in `~/.config/hog/config.json` under each repo's `github` section. GitHub integration requires the [GitHub CLI](https://cli.github.com/) (`gh`).

---

## Configuration

Config: `~/.config/hog/config.json` (schema version 5).

```jsonc
{
  "version": 5,
  "pipeline": {
    "owner": "your-username",
    "maxConcurrentAgents": 3,
    "launchMode": "tmux",           // "auto" | "tmux" | "terminal"
    "tddEnforcement": true,
    "phases": ["brainstorm", "plan", "implement", "review"]
  },
  "repos": [
    {
      "name": "owner/repo",
      "shortName": "repo",
      "localPath": "/path/to/repo",
      "projectNumber": 1,
      "statusFieldId": "PVTSSF_xxx",
      "completionAction": { "type": "closeIssue" }
    }
  ],
  "board": {
    "assignee": "your-username",
    "refreshInterval": 60,
    "backlogLimit": 20
  }
}
```

### Key config sections

| Section | Purpose |
|---------|---------|
| `pipeline` | Agent orchestration: owner, concurrency, TDD, phases, quality gates |
| `repos` | Project directories with optional GitHub integration |
| `board` | Legacy board settings (kept for backward compatibility) |

---

## How it works

1. `hog pipeline create` creates a Beads dependency DAG with 6 phases
2. A background watcher process polls `bd ready` every 10 seconds
3. When a phase's dependencies are satisfied, the Conductor spawns a Claude agent with a role-specific prompt
4. Each agent runs in an isolated git worktree (`--dangerously-skip-permissions`)
5. On completion, the bead is closed and the next phase's dependencies may become satisfied
6. The Refinery merges completed work: rebase → test → quality gates → fast-forward merge

**No GitHub required.** The pipeline runs entirely locally via Beads. GitHub is an optional sync target.

---

## Agent-friendly

Every command supports `--json` for structured output:

```sh
hog pipeline list --json
hog pipeline status feat-123 --json
hog decisions --json
```

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

## Comparison

| | hog | Claude Code | Aider | Devin | Gastown |
|---|---|---|---|---|---|
| Structured pipeline | Yes (6-phase DAG) | No | No | No | Partial |
| TDD enforcement | Yes (RED verification) | No | No | No | No |
| Role separation | Yes (test ≠ impl) | No | No | No | No |
| Adversarial review | Yes (red team phase) | No | No | No | Partial |
| Terminal-first | Yes | Yes | Yes | No | No |
| Zero-config | Yes (`hog init`) | Yes | Yes | Yes | No |
| Beads DAG | Yes | No | No | No | Yes |

---

## Requirements

- **Node.js 22+**
- **Beads** (`bd` CLI) — for pipeline DAG management
- **GitHub CLI** (`gh`) — optional, for GitHub integration
- **tmux** — optional, for agent session attachment
- **OpenRouter API key** — optional, for AI-enhanced features

---

## License

MIT
