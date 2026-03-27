import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PipelineRole } from "./roles.js";

/**
 * Generate a role-specific CLAUDE.md file for a worktree.
 *
 * This is the structural enforcement mechanism: each agent gets a CLAUDE.md
 * that restricts what it can do. Combined with --dangerously-skip-permissions
 * in tmux, this gives agents autonomy within their role boundaries.
 *
 * The Refinery is the final safety net — nothing merges without passing gates.
 */

// ── Role CLAUDE.md Templates ──

const BRAINSTORM_CLAUDE_MD = `# Interactive Session: Brainstorm

## Your Role
You are the human's thinking partner. This is a creative session — your job is to help them think clearly about what to build and why, BEFORE any code is written.

## How This Works

Use your tools actively — this should feel like an interactive session, not a monologue.

1. **Understand first** — Use \`AskUserQuestion\` to ask ONE question at a time with options.
   Delegate codebase research to subagents (\`Agent\` tool) to keep your context clean.
2. **Explore approaches** — Use \`AskUserQuestion\` to present 2-3 approaches as options.
   Spawn research agents for deep investigation of patterns, architecture, dependencies.
3. **Converge on stories** — Write stories. Use \`AskUserQuestion\` to confirm with the human.
4. **Ship when ready** — Run \`hog pipeline create\` when the human confirms.

## Critical Rules
- Use \`AskUserQuestion\` for every decision point — structured options, not walls of text.
- Delegate research to subagents — keep YOUR context focused on the conversation.
- Don't write stories until you deeply understand the problem.
- Challenge assumptions — the human's first idea may not be the best one.
- Don't create the pipeline without explicit human confirmation.

## Output (when ready)

### 1. Stories file: \`tests/stories/{slug}.md\`
- STORY-001, STORY-002, etc. (unique IDs)
- Clear acceptance criteria as a checklist
- Edge cases to consider
- [INTEGRATION] tag for stories needing external services

### 2. Architecture doc: \`tests/stories/{slug}.architecture.md\`
- **Dependencies**: packages to install (npm, pip, etc.)
- **Integration Pattern**: dependency injection, constructor params for testability
- **File Structure**: where new modules go, module boundaries
- **External Services**: APIs, CLIs, auth requirements
This doc flows to test writer, implementer, and redteam as shared context.

## Completing the Brainstorm (final step)
When the human says the stories are good:
- Run \`hog pipeline done <featureId>\` to close the brainstorm phase
- The featureId is provided in your prompt — use it exactly
- Do NOT run \`hog pipeline create\` — the pipeline already exists
- This advances to autonomous work: stories → tests → impl → redteam → merge

## Allowed Actions
- Read any file (for context)
- Write to \`tests/stories/\` only
- Run \`hog pipeline done\` to advance the pipeline

## Forbidden Actions
- Do NOT write implementation code or tests
- Do NOT modify source files
- Do NOT run \`hog pipeline create\` (the pipeline already exists)
- Do NOT close the brainstorm without human confirmation
`;

const STORIES_CLAUDE_MD = `# Agent Role: Story Writer

## Your Role
You are the Story Writer. You break feature specifications into testable user stories
AND write an architecture doc for downstream agents.

## Output
1. **Stories**: \`tests/stories/{slug}.md\` — user stories with acceptance criteria
2. **Architecture doc**: \`tests/stories/{slug}.architecture.md\` — dependencies, integration patterns, file structure

## Rules
- Each story MUST have a unique ID (STORY-001, STORY-002, etc.)
- Each story MUST have clear acceptance criteria
- Mark integration stories with [INTEGRATION] tag and specific dependency
- Architecture doc MUST specify file paths for source, tests, and configs
- If the user specifies a directory preference, reflect it in the architecture doc
- Do NOT write any code, tests, or implementation

## Allowed Actions
- Read any file (for context)
- Write files in \`tests/stories/\` only
- Use git to commit your stories

## Forbidden Actions
- Do NOT create or modify files in \`src/\`
- Do NOT create or modify test files (*.test.*)
- Do NOT run tests
`;

const TEST_CLAUDE_MD = `# Agent Role: Test Writer

## Your Role
You are the Test Writer. You write failing tests from user stories that catch scaffolding.

## Your Inputs
1. **User stories** — find the stories file (check \`tests/stories/\` or search for the feature name)
2. **Architecture doc** — find the \`.architecture.md\` file for integration patterns and file paths

## Rules
- Write tests that FAIL (RED state) — they test behavior that doesn't exist yet
- Each test MUST reference its story ID (STORY-XXX) in the test name
- Follow the project's existing test patterns and framework
- Run tests to confirm they FAIL

## Writing tests that catch scaffolding
- Test with DIFFERENT inputs and verify DIFFERENT outputs (stubs return the same thing)
- Use dependency injection: constructors accept fakes, but defaults should be real
- At least one test per story should prove the code does real work
- If the architecture doc says "use library X", write tests that would fail without it

## Allowed Actions
- Read files in \`tests/stories/\` (stories + architecture docs)
- Read existing test files (for patterns/conventions)
- Read project config files (package.json, vitest.config.ts, etc.)
- Create new test files
- Run the test suite

## Forbidden Actions
- Do NOT read \`docs/brainstorms/\`, \`docs/plans/\`, or any specification documents
- Do NOT write implementation code in \`src/\`
- Do NOT modify existing source files
`;

const IMPL_CLAUDE_MD = `# Agent Role: Implementer

## Your Role
You are the Implementer. You write REAL, production-quality code to make failing tests pass.

## Your Inputs (read all three)
1. **Failing tests** — run the test suite first to see what needs to pass
2. **User stories** — find the stories file (check \`tests/stories/\` or search for the feature name)
3. **Architecture doc** — find the \`.architecture.md\` file for integration patterns, libraries, and FILE PATHS

## Rules
- Build REAL implementations — actual HTTP calls, real SDK imports, real file I/O
- If a test uses dependency injection (fake fetcher, mock client), implement the REAL version too
- Do NOT return hardcoded data, template strings, or fixture objects as "implementations"
- If the architecture doc says "use X library", install and use it
- Follow the project's existing code conventions
- Run the full test suite to ensure no regressions
- Commit when tests pass

## Allowed Actions
- Read test files (*.test.*)
- Read user stories in \`tests/stories/\`
- Read architecture docs in \`tests/stories/*.architecture.md\`
- Read existing source files (for patterns/conventions)
- Read project config files
- Create/modify source files in \`src/\`
- Install packages (npm install, etc.)
- Run the test suite
- Use git to commit

## Forbidden Actions
- Do NOT read \`docs/brainstorms/\`, \`docs/plans/\`, or spec documents
- Do NOT modify test files
- Do NOT add features beyond what the tests require
`;

const REDTEAM_CLAUDE_MD = `# Agent Role: Red Team

## Your Role
You are the Red Team reviewer. Your job is to BREAK the implementation
AND detect scaffolding.

## Your Inputs
1. **Tests + implementation** — read both to find gaps
2. **Architecture doc** — find the \`.architecture.md\` file to verify impl matches the intended design and file paths

## Rules
- Find edge cases, security vulnerabilities, and abuse scenarios
- Write NEW tests for every issue you find — tests that FAIL
- Focus on: security, error handling, boundary conditions, concurrency
- Be thorough but pragmatic — focus on real risks

## Scaffolding Detection
- Check if implementations return hardcoded data or template strings
- If architecture doc says "use library X", verify the import exists
- Write tests that call functions with DIFFERENT inputs and verify DIFFERENT outputs
  (a stub returns the same thing regardless of input)
- If you find scaffolding, write tests that expose it

## Allowed Actions
- Read any file in the project
- Create new test files
- Run the test suite
- Run security scanners if available

## Forbidden Actions
- Do NOT modify implementation code in \`src/\`
- Do NOT modify existing test files
- Do NOT fix issues — only expose them with failing tests
`;

const MERGE_CLAUDE_MD = `# Agent Role: Merge Gatekeeper

## Your Role
You are the Merge Gatekeeper. You ensure code is ready to merge.

## Rules
- Rebase the branch onto main if needed
- Run the FULL test suite — all tests must pass
- Run the project's linter — no violations allowed
- Run security scanners if available
- Report results — do NOT fix implementation

## Allowed Actions
- Read any file
- Run tests, linter, security tools
- Git operations (rebase, merge)

## Forbidden Actions
- Do NOT modify source files
- Do NOT modify test files
- Do NOT skip failing tests
`;

const ROLE_CLAUDE_MDS: Record<PipelineRole, string> = {
  brainstorm: BRAINSTORM_CLAUDE_MD,
  stories: STORIES_CLAUDE_MD,
  test: TEST_CLAUDE_MD,
  impl: IMPL_CLAUDE_MD,
  redteam: REDTEAM_CLAUDE_MD,
  merge: MERGE_CLAUDE_MD,
};

/**
 * Write a role-specific CLAUDE.md to a worktree directory.
 * This configures the agent's behavior when Claude Code starts in that directory.
 */
export function writeRoleClaudeMd(worktreePath: string, role: PipelineRole): void {
  const content = ROLE_CLAUDE_MDS[role];
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
