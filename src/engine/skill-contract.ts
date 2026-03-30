/**
 * Skill contract validation — the explicit integration contract between
 * toolkit skills and hog orchestration.
 *
 * Skills declare inputs (env vars they read) and outputs (files they produce)
 * in their SKILL.md frontmatter. The conductor validates inputs before spawning
 * and auto-wires outputs from one phase as inputs to the next.
 */

// ── Contract Types ──

export interface SkillInput {
  /** Whether the pipeline MUST provide this input. If false, the skill can work standalone. */
  readonly required: boolean;
  /** What the skill does when the input is missing: ask the user or search the filesystem. */
  readonly fallback: "ask" | "search";
}

export interface SkillContract {
  /** Environment variables the skill reads. Key is the env var name. */
  readonly inputs: Readonly<Record<string, SkillInput>>;
  /** Files the skill produces. Key is a logical name, value is a path template with {slug}. */
  readonly outputs: Readonly<Record<string, string>>;
}

export interface ContractValidation {
  readonly valid: boolean;
  /** Env vars that are required but not provided. */
  readonly missing: string[];
  /** Env vars that are optional but not provided (will use fallback). */
  readonly warnings: string[];
}

// ── Contract Definitions ──
// These mirror the `contract:` section that will be added to SKILL.md frontmatter.
// Until skills have machine-readable contracts, these are the canonical definitions.

export const SKILL_CONTRACTS: Readonly<Record<string, SkillContract>> = {
  "deep-thought:brainstorm": {
    inputs: {
      FEATURE_ID: { required: false, fallback: "ask" },
    },
    outputs: {
      stories: "docs/stories/{slug}.md",
      architecture: "docs/stories/{slug}.architecture.md",
    },
  },
  "deep-thought:architect": {
    inputs: {
      BRAINSTORM_PATH: { required: false, fallback: "search" },
      FEATURE_ID: { required: false, fallback: "ask" },
    },
    outputs: {
      stories: "docs/stories/{slug}.md",
      architecture: "docs/stories/{slug}.architecture.md",
    },
  },
  "marvin:scaffold": {
    inputs: {
      ARCH_PATH: { required: false, fallback: "ask" },
    },
    outputs: {
      context: "docs/stories/{slug}.context.md",
    },
  },
  "marvin:test-writer": {
    inputs: {
      STORIES_PATH: { required: false, fallback: "search" },
      ARCH_PATH: { required: false, fallback: "search" },
    },
    outputs: {},
  },
  "marvin:work": {
    inputs: {
      STORIES_PATH: { required: false, fallback: "search" },
      ARCH_PATH: { required: false, fallback: "search" },
      FEATURE_ID: { required: false, fallback: "ask" },
    },
    outputs: {},
  },
  "marvin:redteam": {
    inputs: {
      ARCH_PATH: { required: false, fallback: "search" },
      STORIES_PATH: { required: false, fallback: "search" },
    },
    outputs: {},
  },
  "marvin:review": {
    inputs: {
      MERGE_CHECK: { required: false, fallback: "ask" },
      ARCH_PATH: { required: false, fallback: "search" },
    },
    outputs: {},
  },
  "marvin:ship": {
    inputs: {
      ARCH_PATH: { required: false, fallback: "search" },
      STORIES_PATH: { required: false, fallback: "search" },
    },
    outputs: {
      readme: "README.md",
    },
  },
};

// ── Validation ──

/**
 * Validate that all required inputs for a skill contract are provided.
 * Returns missing required inputs and optional warnings.
 */
export function validateContract(
  contract: SkillContract,
  env: Readonly<Record<string, string>>,
): ContractValidation {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const [name, input] of Object.entries(contract.inputs)) {
    if (!env[name]) {
      if (input.required) {
        missing.push(name);
      } else {
        warnings.push(`${name} not set — skill will ${input.fallback}`);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Resolve output path templates by substituting {slug}.
 * Returns a map of logical output name → resolved file path.
 */
export function resolveOutputPaths(
  contract: SkillContract,
  vars: { slug: string },
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, template] of Object.entries(contract.outputs)) {
    resolved[name] = template.replace(/\{slug\}/g, vars.slug);
  }
  return resolved;
}

/**
 * Auto-wire phase outputs to the next phase's inputs.
 * Given a pipeline's accumulated outputs and the next phase's contract,
 * returns the env vars that should be set for the next phase.
 *
 * This is the key function that eliminates filename heuristics:
 * instead of guessing where stories or architecture docs are,
 * the conductor reads the contract and wires them explicitly.
 */
export function wirePhaseInputs(
  pipelineOutputs: Readonly<Record<string, string>>,
  nextContract: SkillContract,
): Record<string, string> {
  const env: Record<string, string> = {};

  // Map known output names to input env vars
  const OUTPUT_TO_INPUT: Record<string, string> = {
    stories: "STORIES_PATH",
    architecture: "ARCH_PATH",
    context: "CONTEXT_PATH",
  };

  for (const [outputName, filePath] of Object.entries(pipelineOutputs)) {
    const inputVar = OUTPUT_TO_INPUT[outputName];
    if (inputVar && inputVar in nextContract.inputs) {
      env[inputVar] = filePath;
    }
  }

  return env;
}

/**
 * Get the contract for a skill by name.
 * Returns undefined if no contract is defined (skill not in the registry).
 */
export function getSkillContract(skillName: string): SkillContract | undefined {
  return SKILL_CONTRACTS[skillName];
}
