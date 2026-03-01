import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { AUTO_STATUS_SCHEMA, WORKFLOW_CONFIG_SCHEMA } from "./config.js";
import type { BoardConfig, RepoConfig } from "./config.js";

// ── Schema ──

const WORKFLOW_TEMPLATE_SCHEMA = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default("1.0.0"),
  workflow: WORKFLOW_CONFIG_SCHEMA.unwrap(), // unwrap .optional() to require it
  staleness: z
    .object({
      warningDays: z.number().default(7),
      criticalDays: z.number().default(14),
    })
    .optional(),
  autoStatus: z
    .object({
      branchCreated: z.string().optional(),
      prOpened: z.string().optional(),
      prMerged: z.string().optional(),
    })
    .optional(),
});

export type WorkflowTemplate = z.infer<typeof WORKFLOW_TEMPLATE_SCHEMA>;

// ── Built-in Templates ──

export const BUILTIN_TEMPLATES: Record<string, WorkflowTemplate> = {
  full: {
    name: "Full Development Lifecycle",
    description: "Brainstorm, plan, implement, review with AI agents",
    version: "1.0.0",
    workflow: {
      mode: "suggested",
      phases: ["research", "brainstorm", "plan", "implement", "review", "compound"],
      phaseDefaults: {
        research: { mode: "background" },
        brainstorm: { mode: "interactive" },
        plan: { mode: "either" },
        implement: { mode: "either" },
        review: { mode: "background" },
        compound: { mode: "background" },
      },
    },
    staleness: { warningDays: 7, criticalDays: 14 },
    autoStatus: {
      branchCreated: "In Progress",
      prOpened: "In Review",
      prMerged: "Done",
    },
  },
  minimal: {
    name: "Minimal",
    description: "Plan and implement — no extra phases",
    version: "1.0.0",
    workflow: {
      mode: "freeform",
      phases: ["plan", "implement"],
    },
  },
};

// ── Validation ──

/**
 * Validate a JSON value as a workflow template. Returns the parsed template on
 * success or an error message string on failure.
 */
export function validateTemplate(json: unknown): WorkflowTemplate | { error: string } {
  const result = WORKFLOW_TEMPLATE_SCHEMA.safeParse(json);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  return { error: `Invalid template: ${issues.join("; ")}` };
}

// ── Export ──

/**
 * Build a workflow template from existing repo + board config. Picks only
 * the workflow-relevant fields, omitting instance-specific data like
 * localPath, statusFieldId, etc.
 */
export function exportTemplate(
  name: string,
  repoConfig: RepoConfig,
  boardConfig?: BoardConfig,
): WorkflowTemplate {
  const template: WorkflowTemplate = {
    name,
    version: "1.0.0",
    workflow: repoConfig.workflow ?? {
      mode: "suggested",
      phases: ["brainstorm", "plan", "implement", "review"],
    },
  };

  // Staleness from board config
  if (boardConfig?.workflow?.staleness) {
    template.staleness = boardConfig.workflow.staleness;
  }

  // Auto-status triggers from repo config
  if (repoConfig.autoStatus?.triggers) {
    template.autoStatus = {
      branchCreated: repoConfig.autoStatus.triggers.branchCreated,
      prOpened: repoConfig.autoStatus.triggers.prOpened,
      prMerged: repoConfig.autoStatus.triggers.prMerged,
    };
  }

  return template;
}

// ── Import ──

/**
 * Read and validate a workflow template from a JSON file. Returns the parsed
 * template on success or an error message string on failure.
 */
export function importTemplate(filePath: string): WorkflowTemplate | { error: string } {
  if (!existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return { error: `Failed to parse JSON from ${filePath}` };
  }

  return validateTemplate(json);
}

// ── Apply ──

/**
 * Merge a workflow template into a repo config. Returns a new repo config
 * with workflow and autoStatus fields updated from the template.
 */
export function applyTemplateToRepo(template: WorkflowTemplate, repo: RepoConfig): RepoConfig {
  const updated = { ...repo, workflow: template.workflow };

  if (template.autoStatus) {
    updated.autoStatus = {
      enabled: repo.autoStatus?.enabled ?? false,
      triggers: {
        ...repo.autoStatus?.triggers,
        branchCreated: template.autoStatus.branchCreated,
        prOpened: template.autoStatus.prOpened,
        prMerged: template.autoStatus.prMerged,
      },
    };
  }

  return updated;
}

/**
 * Merge a workflow template into board config. Returns a new board config
 * with workflow fields updated from the template.
 */
export function applyTemplateToBoard(
  template: WorkflowTemplate,
  board: BoardConfig,
): BoardConfig {
  return {
    ...board,
    workflow: {
      ...board.workflow,
      defaultMode: template.workflow.mode,
      defaultPhases: template.workflow.phases,
      phasePrompts: template.workflow.phasePrompts ?? board.workflow?.phasePrompts,
      staleness: template.staleness ?? board.workflow?.staleness,
      maxConcurrentAgents: board.workflow?.maxConcurrentAgents ?? 3,
      notifications: board.workflow?.notifications,
    },
  };
}
