import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PIPELINE_ROLES, type PipelineRole, scopeToClaudeMd } from "./roles.js";

/**
 * Generate a role-specific CLAUDE.md file for a worktree.
 *
 * Two modes:
 * - **Skill mode** (toolkit installed): minimal scope-only CLAUDE.md.
 *   The skill's SKILL.md provides the real instructions. The CLAUDE.md
 *   only constrains what the agent can touch.
 * - **Fallback mode** (toolkit not installed): instructional CLAUDE.md
 *   with enough guidance for the agent to do its job without a skill.
 *
 * The Refinery is the final safety net — nothing merges without passing gates.
 */

// ── Scope-only CLAUDE.md (when skills provide instructions) ──

function buildScopeClaudeMd(role: PipelineRole, label: string): string {
  const roleConfig = PIPELINE_ROLES[role];
  return [
    `# ${label}`,
    "",
    "Your primary instructions come from the skill. This file defines your scope.",
    "",
    scopeToClaudeMd(roleConfig.scope),
    "",
  ].join("\n");
}

// ── Fallback CLAUDE.md Templates (when skills are NOT available) ──

const FALLBACK_CLAUDE_MDS: Record<PipelineRole, string> = {
  brainstorm: `# Interactive Session: Brainstorm

## Your Role
You are the human's thinking partner. Help them think clearly about what to build and why, BEFORE any code is written.

## How This Works
1. **Understand first** — Use \`AskUserQuestion\` to ask ONE question at a time.
2. **Explore approaches** — Present 2-3 options with tradeoffs.
3. **Converge on stories** — Write stories to \`docs/stories/{slug}.md\`.
4. **Ship when ready** — Run \`hog pipeline done <featureId>\` when confirmed.

## Output
- Stories: \`docs/stories/{slug}.md\` with STORY-001 IDs and acceptance criteria
- Architecture doc: \`docs/stories/{slug}.architecture.md\` with dependencies, patterns, file structure
`,

  stories: `# Agent Role: Architect

## Your Role
Break feature specifications into testable user stories and write an architecture doc.

## Output
1. Stories: \`docs/stories/{slug}.md\` — user stories with acceptance criteria
2. Architecture doc: \`docs/stories/{slug}.architecture.md\` — dependencies, integration patterns, file structure

## Rules
- Each story MUST have a unique ID (STORY-001, etc.) and clear acceptance criteria
- Architecture doc MUST specify EXACT file paths, dependencies (BINDING), and integration pattern (BINDING)
- Do NOT write any code or tests
`,

  scaffold: `# Agent Role: Project Scaffolder

## Your Role
Prepare the project structure so the test writer can do its work.

## Scope
- Greenfield: create directories, install deps, set up configs
- Brownfield: verify architecture doc matches reality, note discrepancies
- Write \`docs/stories/{slug}.context.md\` for the test writer

## Rules
- Do NOT create source files or test files — only directories and configs
- This should take under 2 minutes
`,

  test: `# Agent Role: Spec Writer (Tracer Bullets)

## Your Role
Write tracer bullet tests — executable specifications that prove the architecture works end-to-end.
When ALL your tests pass, the application is complete and working as designed.

## Inputs
1. Stories file — find in \`docs/stories/\`
2. Architecture doc — find the \`.architecture.md\` file

## Rules
- ALL tests must FAIL (RED state) — they test behavior that doesn't exist yet
- Each test must reference its story ID (STORY-XXX)
- Import and call source functions directly — NEVER read source files as strings
- NEVER use readFileSync+toMatch to verify implementation — this proves a string exists, not that a feature works
- Write conformance tests that verify architecture doc dependencies are imported and used
- Do NOT write implementation code
`,

  impl: `# Agent Role: Implementer

## Your Role
Write REAL, production-quality code to make failing tests pass.

## Inputs (read in order)
1. Failing tests — run the test suite first
2. User stories — in \`docs/stories/\`
3. Architecture doc — the \`.architecture.md\` file is BINDING

## Rules
- The architecture doc is BINDING. Every dependency MUST be imported and used.
- A regex classifier instead of an LLM call is a STUB.
- A hardcoded response instead of a real API call is a STUB.
- Do NOT modify test files
`,

  redteam: `# Agent Role: Red Team

## Your Role
You are adversarial. Find weaknesses and expose them with FAILING tests.
You do NOT fix anything. You only prove things are broken.
Your success = number of FAILING tests. If a test passes, DELETE it — it found no issue.

## Priorities (in order)
1. Architecture conformance — verify every dependency is imported
2. Stub detection — find hardcoded returns, regex classifiers, TODO markers
3. Security — input validation, injection, auth bypass
4. Story completeness — verify every acceptance criterion is implemented

## CRITICAL
- Do NOT edit implementation files
- Do NOT make your tests pass — they MUST fail to prove the issue exists
- If a test passes, the feature works — delete that test

## Rules
- Write NEW failing tests for every issue found
- Do NOT modify implementation code — only expose problems
`,

  merge: `# Agent Role: Merge Gatekeeper

## Your Role
Final quality gate. Nothing merges without your approval.

## Steps
1. Rebase onto main
2. Run FULL test suite — all must pass
3. Run linter — no violations
4. Run security scanner if available
5. Verdict: MERGE or BLOCK (with reasons)

## Rules
- Do NOT fix implementation — REPORT only
- Do NOT modify source or test files
`,

  ship: `# Agent Role: Ship

## Your Role
Post-merge documentation, knowledge capture, and operational readiness.

## Steps
1. Read all phase summaries, architecture doc, test results, redteam findings
2. Write/update README.md — setup, run, configure (merge with existing, don't replace)
3. Write what-changed summary to docs/changelog/
4. Write knowledge docs to docs/solutions/ (patterns, decisions, solved problems)
5. If deployment config exists: write deployment guide
6. Check operational readiness — create .env.example if missing, fill doc gaps
7. If code changes needed (hardcoded secrets, missing health check): report as BLOCKED

## Rules
- Do NOT modify source code in src/
- Do NOT modify test files
- MERGE with existing README.md — never overwrite
- Create .env.example from process.env usage if missing
`,
};

/**
 * Write a role-specific CLAUDE.md to a worktree directory.
 *
 * @param usingSkill — true when the toolkit skill is available and will
 *   provide instructions via SKILL.md. The CLAUDE.md becomes scope-only.
 */
export function writeRoleClaudeMd(
  worktreePath: string,
  role: PipelineRole,
  variables?: { storiesPath?: string; archPath?: string },
  usingSkill = false,
): void {
  const roleConfig = PIPELINE_ROLES[role];
  let content: string;

  if (usingSkill) {
    // Skill provides instructions — CLAUDE.md is scope-only
    content = buildScopeClaudeMd(role, roleConfig.label);
  } else {
    // No skill — CLAUDE.md provides guidance + scope
    content = FALLBACK_CLAUDE_MDS[role];
    content += `\n${scopeToClaudeMd(roleConfig.scope)}\n`;
  }

  // Inject paths if provided — agents need to know WHERE to create files
  if (variables?.storiesPath || variables?.archPath) {
    const pathSection = [
      "",
      "## File Paths (from pipeline config)",
      variables.storiesPath ? `- Stories: \`${variables.storiesPath}\`` : "",
      variables.archPath ? `- Architecture doc: \`${variables.archPath}\`` : "",
      "- **Read the architecture doc's ## File Structure section for where to create source and test files**",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    content += pathSection;
  }

  const filePath = join(worktreePath, "CLAUDE.md");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, { encoding: "utf-8" });
}

/**
 * Build the Claude Code launch args for a pipeline agent in tmux.
 *
 * Uses --dangerously-skip-permissions for autonomy (the Refinery is the safety net).
 * The role-specific CLAUDE.md provides behavioral guardrails.
 */
export function buildAgentLaunchArgs(prompt: string, extraArgs: readonly string[] = []): string[] {
  return [
    ...extraArgs,
    "--dangerously-skip-permissions",
    "-p",
    prompt,
    "--output-format",
    "stream-json",
  ];
}

/**
 * Build a tmux session name for a pipeline agent.
 */
export function buildTmuxSessionName(featureId: string, role: PipelineRole): string {
  return `hog-${featureId}-${role}`;
}
