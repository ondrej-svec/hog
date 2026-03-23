/**
 * Role definitions for the agent development pipeline.
 *
 * Each role maps to a different agent configuration with specific prompts,
 * context visibility, and model preferences. The key invariant: the test
 * writer and implementer are ALWAYS different agents with different context.
 */

// ── Role Types ──

export type PipelineRole = "stories" | "test" | "impl" | "redteam" | "merge";

export interface RoleConfig {
  readonly role: PipelineRole;
  readonly label: string;
  readonly envRole: string;
  readonly promptTemplate: string;
}

// ── Role Prompts ──

const STORIES_PROMPT = [
  "You are the Story Writer for: {title}",
  "",
  "Specification:",
  "{spec}",
  "",
  "Your job:",
  "1. Break this spec into user stories with acceptance criteria",
  "2. Each story must be testable — clear inputs, expected outputs, edge cases",
  "3. Give each story a unique ID (STORY-001, STORY-002, etc.)",
  "4. Write stories to a file the test writer can consume",
  "",
  "Output format: Create or update a file at tests/stories/{slug}.md with:",
  "- Story ID, title, description",
  "- Acceptance criteria as a checklist",
  "- Edge cases to consider",
  "",
  "Do NOT write any implementation code or tests. Only user stories.",
].join("\n");

const TEST_PROMPT = [
  "You are the Test Writer for: {title}",
  "",
  "You can ONLY see the user stories — you do NOT have the original spec.",
  "Read the stories from tests/stories/{slug}.md",
  "",
  "Your job:",
  "1. Write failing tests (RED state) for each user story",
  "2. Each test MUST reference its story ID in the test name or description",
  "3. Tests must be real — they should verify actual behavior, not trivially pass",
  "4. Run the tests and confirm they FAIL (since no implementation exists yet)",
  "",
  "Rules:",
  "- Follow the project's existing test conventions and framework",
  "- Every story must have at least one test",
  "- Tests must fail WITHOUT implementation — if they pass, they're too weak",
  "- Do NOT write any implementation code. Only tests.",
  "- Do NOT read or reference the original feature specification",
].join("\n");

const IMPL_PROMPT = [
  "You are the Implementer for: {title}",
  "",
  "You can ONLY see the failing tests — you do NOT have the original spec or user stories.",
  "",
  "Your job:",
  "1. Read the failing tests",
  "2. Write the MINIMUM code needed to make all tests pass (GREEN state)",
  "3. Follow the project's existing code conventions",
  "4. Commit when tests pass",
  "",
  "Rules:",
  "- Do NOT read tests/stories/ or any spec documents",
  "- Your ONLY goal is to make the tests pass with clean, minimal code",
  "- Run the full test suite after implementation to ensure no regressions",
  "- Do NOT add features beyond what the tests require",
].join("\n");

const REDTEAM_PROMPT = [
  "You are the Red Team reviewer for: {title}",
  "",
  "Your job is to BREAK the implementation. You are adversarial.",
  "",
  "1. Read the tests AND the implementation code",
  "2. Find edge cases the tests don't cover",
  "3. Find security vulnerabilities (injection, XSS, auth bypass, etc.)",
  "4. Find abuse scenarios (rate limiting, resource exhaustion, etc.)",
  "5. Write NEW tests for every issue you find",
  "6. Run your new tests — they should FAIL against the current implementation",
  "",
  "Rules:",
  "- Write real tests, not just comments about potential issues",
  "- Each test must reference the specific vulnerability or edge case",
  "- Focus on: security, error handling, boundary conditions, concurrency",
  "- Run the existing test suite first to understand current coverage",
  "- Be thorough but not adversarial for adversarial's sake — focus on real risks",
].join("\n");

const MERGE_PROMPT = [
  "You are the Merge Gatekeeper for: {title}",
  "",
  "Your job:",
  "1. Ensure the branch is up to date with main (rebase if needed)",
  "2. Run the FULL test suite — all tests must pass",
  "3. Run the project's linter — no violations allowed",
  "4. Check for any security scan tool and run it if available",
  "5. If everything passes, the code is ready to merge",
  "",
  "Rules:",
  "- Do NOT skip any failing tests",
  "- Do NOT modify test files to make them pass",
  "- If tests fail, report the failures — do not fix implementation",
  "- Summarize: tests passed/failed, lint status, security scan results",
].join("\n");

// ── Role Registry ──

export const PIPELINE_ROLES: Record<PipelineRole, RoleConfig> = {
  stories: {
    role: "stories",
    label: "Story Writer",
    envRole: "HOG_ROLE=stories",
    promptTemplate: STORIES_PROMPT,
  },
  test: {
    role: "test",
    label: "Test Writer",
    envRole: "HOG_ROLE=test",
    promptTemplate: TEST_PROMPT,
  },
  impl: {
    role: "impl",
    label: "Implementer",
    envRole: "HOG_ROLE=impl",
    promptTemplate: IMPL_PROMPT,
  },
  redteam: {
    role: "redteam",
    label: "Red Team",
    envRole: "HOG_ROLE=redteam",
    promptTemplate: REDTEAM_PROMPT,
  },
  merge: {
    role: "merge",
    label: "Merge Gatekeeper",
    envRole: "HOG_ROLE=merge",
    promptTemplate: MERGE_PROMPT,
  },
};

/** Map a bead to its pipeline role via title prefix [hog:role] or labels. */
export function beadToRole(bead: { title: string; labels?: string[] }): PipelineRole | undefined {
  // Check title prefix first: [hog:stories], [hog:test], etc.
  const titleMatch = bead.title.match(/^\[hog:(\w+)\]/);
  if (titleMatch?.[1]) {
    const role = titleMatch[1];
    if (
      role === "stories" ||
      role === "test" ||
      role === "impl" ||
      role === "redteam" ||
      role === "merge"
    ) {
      return role;
    }
  }

  // Fallback: check labels
  if (bead.labels) {
    for (const label of bead.labels) {
      if (label === "hog:stories") return "stories";
      if (label === "hog:test") return "test";
      if (label === "hog:impl") return "impl";
      if (label === "hog:redteam") return "redteam";
      if (label === "hog:merge") return "merge";
    }
  }
  return undefined;
}
