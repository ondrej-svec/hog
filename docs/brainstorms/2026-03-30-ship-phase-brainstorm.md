---
title: "Ship Phase — Post-Merge Documentation, Knowledge Capture & Operational Readiness"
type: brainstorm
date: 2026-03-30
participants: [Ondrej, Claude Opus 4.6]
related:
  - docs/brainstorms/2026-03-30-pipeline-feedback-loops-brainstorm.md
  - docs/plans/2026-03-30-feat-impl-phase-depth-plan.md
---

# Ship Phase — Post-Merge Documentation, Knowledge Capture & Operational Readiness

## Problem Statement

The pipeline ends at merge — code is done, tests pass, but the **human is left with nothing actionable**. No README, no deployment guide, no summary of what was built. Knowledge from the pipeline (decisions, patterns, solved problems) is lost. The next pipeline starts from scratch.

For projects like Quellis (Vercel + Neon + Clerk), this is especially painful: the pipeline produces working code but doesn't tell you how to deploy it, what env vars to set, or what services to configure.

The compound skill exists but is manual — nobody remembers to run it after a pipeline. Ship-notes doesn't exist at all.

## Context

### What exists today
- `/compound` skill — manual knowledge capture (solutions, patterns, CLAUDE.md updates). Works well but is never invoked by the pipeline.
- Merge role — pure quality gate. `canWrite: []`. Cannot produce artifacts.
- No `ship`, `document`, or `readme` role in the pipeline.
- No post-merge hook of any kind.
- The pipeline DAG is now flexible (`Record<string, string>` beadIds) — adding a node is straightforward.

### What doesn't exist
- No automatic README generation
- No deployment guide generation
- No "what changed" summary
- No automatic knowledge capture
- No operational readiness check

## Chosen Approach

**One new pipeline phase: `ship`** — runs after merge passes, as a DAG node. Powered by a skill (`/marvin:ship` or similar). Produces:

1. **README.md** (or updates existing) — how to set up, run, configure. Lives with the code.
2. **Deployment guide** (conditional) — step-by-step: env vars, commands, services. Only generated when the architecture doc has a `## Deployment`/`## Infrastructure` section OR code detection finds Vercel/Docker/Terraform/cloud configs.
3. **What changed summary** — what was built, what tests cover, what redteam found. Per-pipeline-run artifact.
4. **Knowledge docs** — patterns discovered, decisions made, problems solved. Feeds `docs/solutions/` for future pipeline runs.

### Smart trigger for deployment guide

Two signals, either one is sufficient:
- **Explicit:** Architecture doc contains `## Deployment`, `## Infrastructure`, or `## Hosting`
- **Implicit:** Code contains `vercel.json`, `Dockerfile`, `terraform/`, `fly.toml`, `render.yaml`, cloud provider SDK imports

### Feedback loop

Ship is NOT read-only. If it discovers operational readiness gaps (missing `.env.example`, no error boundary on payment webhooks, CORS not configured), it can **flag blockers that loop back to impl**. This makes ship a final quality gate for "can you actually deploy this" — distinct from merge's "does the code work."

## Why This Approach

**Why a DAG node instead of a post-pipeline hook?**
A DAG node gets all the infrastructure: bead state tracking, retry logic, cockpit display, feedback loops. A hook would be second-class — no visibility, no retry, no feedback.

**Why one `ship` phase instead of separate `ship` + `compound`?**
The ship agent reads everything (architecture doc, phase summaries, test results, redteam findings). It has all context for both project docs AND knowledge capture. Splitting adds complexity without improving quality — one agent, one pass.

**Why conditional deployment guide?**
Generating deployment docs for a CLI tool or a library is wasteful. Detection (architecture doc sections + code config files) avoids unnecessary work while catching real deployment needs.

**Why can ship loop back to impl?**
The merge agent checks code quality. Ship checks operational readiness. "Tests pass but you forgot to add STRIPE_SECRET_KEY to .env.example" is a ship-level finding, not a merge-level one. The pipeline shouldn't mark "complete" if you can't actually deploy.

## Key Design Decisions

### Q1: What artifacts does ship produce? — RESOLVED
**Decision:** README.md, deployment guide (conditional), what-changed summary, knowledge docs (compound)
**Rationale:** These are the four things a human needs after a pipeline: how to use it, how to deploy it, what happened, and what was learned.
**Alternatives considered:** Just README (too minimal), full documentation site (too heavy)

### Q2: When does the deployment guide trigger? — RESOLVED
**Decision:** Architecture doc sections (explicit) OR code config detection (implicit). Either signal is sufficient.
**Rationale:** The architecture doc is the human's explicit intent. Code detection catches projects where deployment is implicit (Vercel inferred from Next.js). Both together increase priority.
**Alternatives considered:** Always generate (wasteful), user flag at creation (easy to forget), detect only (misses architecture intent)

### Q3: Can ship block the pipeline? — RESOLVED
**Decision:** Yes — ship can flag operational readiness gaps that loop back to impl.
**Rationale:** "Code works but can't be deployed" is a pipeline failure. Missing .env.example, no CORS config, no health check endpoint — these are real blockers that impl should fix.
**Alternatives considered:** Report-only (pipeline completes with known gaps), TODO section only (human has to remember)

### Q4: Is knowledge capture automatic or manual? — RESOLVED
**Decision:** Automatic — the ship agent captures knowledge as part of its pass. No manual `/compound` needed.
**Rationale:** Nobody remembers to run compound manually. The ship agent already has all context. Automatic capture is the whole point.
**Alternatives considered:** Manual compound after pipeline (status quo — knowledge is lost), separate compound phase (unnecessary complexity)

## Open Questions

1. **Should ship update an existing README or create from scratch?** If README.md already exists, should it merge or replace? Probably merge — existing READMEs may have content the pipeline shouldn't overwrite (contribution guidelines, license).

2. **What's the scope boundary for the deployment guide?** Should it include CI/CD setup? Monitoring? Or just "how to get it running"? Probably just deployment — CI/CD is a separate concern.

3. **Should the ship skill exist in the heart-of-gold-toolkit or be built into hog?** Toolkit makes it reusable and independently usable via `/marvin:ship`. Built-in means no external dependency. Probably toolkit — follows the skills-first pattern.

4. **How does ship interact with the existing `/compound` skill?** Should it invoke `/compound` internally, or duplicate its logic? Probably invoke — reuse the compound skill's output format and search integration.

## Out of Scope

- API documentation (Swagger/OpenAPI) — generated by tools, not agents
- Full documentation sites (Docusaurus, Mintlify) — too heavy for a pipeline phase
- Marketing copy or landing pages
- CI/CD pipeline setup (separate concern from deployment)

## Next Steps

- `/plan` to create an implementation plan from these decisions
- Build the `/marvin:ship` skill in the heart-of-gold-toolkit
- Add `ship` role to hog's `roles.ts`
- Wire into the DAG as post-merge node
- Add detection logic for deployment guide triggers
