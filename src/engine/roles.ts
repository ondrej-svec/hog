/**
 * Role definitions for the agent development pipeline.
 *
 * Each role maps to a toolkit skill (when installed) or a bundled fallback prompt.
 * The key invariant: the test writer and implementer are ALWAYS different agents
 * with different context.
 *
 * Intelligence lives in SKILL.md files in the heart-of-gold-toolkit.
 * This file is metadata only — no prompt string constants.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Role Types ──

export type PipelineRole =
  | "brainstorm"
  | "stories"
  | "scaffold"
  | "test"
  | "impl"
  | "redteam"
  | "merge";

/** File scope constraints for a role — single source of truth for role-audit gates. */
export interface RoleScope {
  /** Glob patterns for files this role may read. Empty = read anything. */
  readonly canRead: readonly string[];
  /** Glob patterns for files this role may create/modify. */
  readonly canWrite: readonly string[];
  /** Human-readable forbidden actions (for CLAUDE.md generation). */
  readonly forbidden: readonly string[];
}

export interface RoleConfig {
  readonly role: PipelineRole;
  readonly label: string;
  readonly envRole: string;
  /** Heart of Gold toolkit skill name (e.g., "deep-thought:brainstorm"). */
  readonly skill: string;
  /** Fallback prompt file name (without .md extension) loaded from fallback-prompts/. */
  readonly fallbackPromptFile: string;
  /** Structural file scope — used by role-audit gate AND CLAUDE.md generation. */
  readonly scope: RoleScope;
}

/** Generate the "Allowed/Forbidden Actions" CLAUDE.md section from a role's scope. */
export function scopeToClaudeMd(scope: RoleScope): string {
  const lines = ["## Scope (enforced by role-audit gate)", ""];
  if (scope.canRead.length > 0) {
    lines.push(`**May read:** ${scope.canRead.join(", ")}`);
  } else {
    lines.push("**May read:** any file");
  }
  if (scope.canWrite.length > 0) {
    lines.push(`**May modify:** ${scope.canWrite.join(", ")}`);
  }
  if (scope.forbidden.length > 0) {
    lines.push("");
    lines.push("**Forbidden:**");
    for (const f of scope.forbidden) {
      lines.push(`- ${f}`);
    }
  }
  return lines.join("\n");
}

// ── Fallback Prompt Loading ──

const DIRNAME = fileURLToPath(new URL(".", import.meta.url));
const FALLBACK_DIR = join(DIRNAME, "fallback-prompts");

/** Cache for loaded fallback prompts. */
const fallbackCache = new Map<string, string>();

/**
 * Load a fallback prompt from the bundled fallback-prompts/ directory.
 * These are simplified versions of the toolkit SKILL.md content —
 * they lose Stop hooks and knowledge directories but the pipeline still runs.
 */
export function loadFallbackPrompt(fileName: string): string {
  const cached = fallbackCache.get(fileName);
  if (cached !== undefined) return cached;

  const filePath = join(FALLBACK_DIR, `${fileName}.md`);
  if (!filePath.startsWith(FALLBACK_DIR)) {
    throw new Error(`Invalid fallback prompt path: ${fileName}`);
  }
  if (!existsSync(filePath)) {
    throw new Error(
      `Fallback prompt not found: ${filePath}. Run "npm run build" to copy prompts to dist/.`,
    );
  }
  const content = readFileSync(filePath, "utf-8");
  fallbackCache.set(fileName, content);
  return content;
}

// ── Role Registry (metadata only — no prompt strings) ──

export const PIPELINE_ROLES: Record<PipelineRole, RoleConfig> = {
  brainstorm: {
    role: "brainstorm",
    label: "Brainstorm",
    envRole: "HOG_ROLE=brainstorm",
    skill: "deep-thought:brainstorm",
    fallbackPromptFile: "brainstorm",
    scope: {
      canRead: [],
      canWrite: ["docs/stories/**"],
      forbidden: ["Do NOT write implementation code or tests", "Do NOT modify source files"],
    },
  },
  stories: {
    role: "stories",
    label: "Architect",
    envRole: "HOG_ROLE=stories",
    skill: "deep-thought:architect",
    fallbackPromptFile: "architect",
    scope: {
      canRead: [],
      canWrite: ["docs/stories/**/*.md"],
      forbidden: ["Do NOT create or modify files in src/", "Do NOT create or modify test files"],
    },
  },
  scaffold: {
    role: "scaffold",
    label: "Scaffolder",
    envRole: "HOG_ROLE=scaffold",
    skill: "marvin:scaffold",
    fallbackPromptFile: "scaffold",
    scope: {
      canRead: [],
      canWrite: [
        "package.json",
        "*.config.*",
        "tsconfig.*",
        "biome.json",
        ".gitignore",
        ".env.example",
        "docs/stories/**",
        "Dockerfile",
        "docker-compose.*",
        ".github/**",
      ],
      forbidden: [
        "Do NOT create source files (.ts, .js, .py, .rs)",
        "Do NOT create test files (*.test.*, *.spec.*)",
        "Do NOT write functions, classes, or code",
      ],
    },
  },
  test: {
    role: "test",
    label: "Test Writer",
    envRole: "HOG_ROLE=test",
    skill: "marvin:test-writer",
    fallbackPromptFile: "test-writer",
    scope: {
      canRead: [
        "docs/stories/**",
        "*.test.*",
        "*.spec.*",
        "package.json",
        "vitest.config.*",
        "tsconfig.*",
      ],
      canWrite: ["*.test.*", "*.spec.*", "*_test.*"],
      forbidden: [
        "Do NOT write implementation code in src/",
        "Do NOT read brainstorm/plan documents",
      ],
    },
  },
  impl: {
    role: "impl",
    label: "Implementer",
    envRole: "HOG_ROLE=impl",
    skill: "marvin:work",
    fallbackPromptFile: "work",
    scope: {
      canRead: ["*.test.*", "docs/stories/**", "package.json"],
      canWrite: ["src/**", "package.json", "*.config.*"],
      forbidden: [
        "Do NOT modify test files",
        "Do NOT read brainstorm/plan documents",
        "Do NOT add features beyond what the tests require",
      ],
    },
  },
  redteam: {
    role: "redteam",
    label: "Red Team",
    envRole: "HOG_ROLE=redteam",
    skill: "marvin:redteam",
    fallbackPromptFile: "redteam",
    scope: {
      canRead: [],
      canWrite: ["*.test.*", "*.spec.*", "*_test.*"],
      forbidden: [
        "Do NOT modify implementation code in src/",
        "Do NOT fix issues — only expose them with failing tests",
      ],
    },
  },
  merge: {
    role: "merge",
    label: "Merge Gatekeeper",
    envRole: "HOG_ROLE=merge",
    skill: "marvin:review",
    fallbackPromptFile: "review",
    scope: {
      canRead: [],
      canWrite: [],
      forbidden: [
        "Do NOT modify source files",
        "Do NOT modify test files",
        "Do NOT skip failing tests",
      ],
    },
  },
};

// ── Skill Availability ──

/** Session-scoped cache — plugin installation doesn't change mid-run. */
const skillAvailabilityCache = new Map<string, boolean>();

/**
 * Check if a toolkit skill is available by looking for its plugin directory.
 * Results are cached per plugin name for the lifetime of the process.
 */
export function checkSkillInstalled(skillName: string): boolean {
  const [pluginName] = skillName.split(":");
  if (!(pluginName && /^[a-z0-9_-]+$/i.test(pluginName))) return false;

  const cached = skillAvailabilityCache.get(pluginName);
  if (cached !== undefined) return cached;

  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  let found = false;

  try {
    const marketplacesDir = join(home, ".claude", "plugins", "marketplaces");
    if (existsSync(marketplacesDir)) {
      for (const marketplace of readdirSync(marketplacesDir)) {
        const pluginDir = join(marketplacesDir, marketplace, "plugins", pluginName);
        if (existsSync(pluginDir)) {
          found = true;
          break;
        }
      }
    }

    if (!found) {
      const configPluginDir = join(home, ".config", "claude-code", "plugins", pluginName);
      if (existsSync(configPluginDir)) found = true;
    }
  } catch {
    // If fs operations fail, assume not installed
  }

  skillAvailabilityCache.set(pluginName, found);
  return found;
}

/**
 * Resolve the prompt for a role: skill invocation if available, fallback prompt otherwise.
 * When the skill is available, the prompt is just the slash command (e.g., "/marvin:test-writer").
 * When not available, the full fallback prompt is loaded from the bundled markdown files.
 */
export function resolvePromptForRole(role: PipelineRole): { prompt: string; usingSkill: boolean } {
  const config = PIPELINE_ROLES[role];
  const skillAvailable = checkSkillInstalled(config.skill);

  if (skillAvailable) {
    return { prompt: `/${config.skill}`, usingSkill: true };
  }

  return { prompt: loadFallbackPrompt(config.fallbackPromptFile), usingSkill: false };
}

/** Map a bead to its pipeline role via title prefix [hog:role] or labels. */
export function beadToRole(bead: { title: string; labels?: string[] }): PipelineRole | undefined {
  // Check title prefix first: [hog:stories], [hog:test], etc.
  const titleMatch = bead.title.match(/^\[hog:(\w+)\]/);
  if (titleMatch?.[1]) {
    const role = titleMatch[1];
    if (
      role === "brainstorm" ||
      role === "stories" ||
      role === "scaffold" ||
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
      if (label === "hog:brainstorm") return "brainstorm";
      if (label === "hog:stories") return "stories";
      if (label === "hog:scaffold") return "scaffold";
      if (label === "hog:test") return "test";
      if (label === "hog:impl") return "impl";
      if (label === "hog:redteam") return "redteam";
      if (label === "hog:merge") return "merge";
    }
  }
  return undefined;
}
