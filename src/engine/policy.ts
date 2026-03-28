/**
 * Policy-as-Code Engine — declarative quality gates via YAML files.
 *
 * Teams define quality standards in `.hog/policies/*.yaml`. Each policy
 * declares a gate: what to run, when to run it, what severity to assign,
 * and what message to show on failure.
 *
 * User policies override built-in gates of the same name.
 * Invalid policies warn but don't block.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { GateIssue, GateResult, GateSeverity, QualityGate } from "./quality-gates.js";

const execFileAsync = promisify(execFile);

// ── Policy Schema ──

const POLICY_SCHEMA = z.object({
  /** Unique gate name. */
  name: z.string().min(1),
  /** Error blocks merge; warning reports only. */
  severity: z.enum(["error", "warning"]).default("warning"),
  /** Shell command to run. Exit 0 = pass, non-zero = fail. */
  command: z.string().min(1),
  /** When to run: "merge" (default), "impl", "test", "always". */
  on: z.array(z.string()).default(["merge"]),
  /** Human-readable failure message. */
  message: z.string().default("Policy check failed"),
  /** Glob pattern to filter which files to check (optional). */
  glob: z.string().optional(),
  /** Timeout in seconds (default 60). */
  timeout: z.number().default(60),
});

export type Policy = z.infer<typeof POLICY_SCHEMA>;

// ── Policy Directory ──

const POLICY_DIR = ".hog/policies";

/** Load all valid policies from `.hog/policies/` in a project. */
export function loadPolicies(projectPath: string): Policy[] {
  const policyDir = join(projectPath, POLICY_DIR);
  if (!existsSync(policyDir)) return [];

  const files = readdirSync(policyDir).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );

  const policies: Policy[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(policyDir, file), "utf-8");
      // Simple YAML parser for flat key-value policies
      const parsed = parseSimpleYaml(content);
      const result = POLICY_SCHEMA.safeParse(parsed);
      if (result.success) {
        policies.push(result.data);
      } else {
        console.warn(`[policy] Invalid policy ${file}: ${result.error.message}`);
      }
    } catch {
      // Skip malformed files
    }
  }

  return policies;
}

/** Convert a policy to a QualityGate for the gate runner. */
export function policyToGate(policy: Policy): QualityGate {
  return {
    name: policy.name,
    severity: policy.severity as GateSeverity,
    isAvailable: () => true, // command-based gates are always "available"
    check: async (repoPath: string, changedFiles: string[]): Promise<GateResult> => {
      // Filter files by glob if specified
      const files =
        policy.glob
          ? changedFiles.filter((f) => matchGlob(f, policy.glob!))
          : changedFiles;

      if (files.length === 0 && policy.glob) {
        return { gate: policy.name, severity: policy.severity as GateSeverity, passed: true, issues: [], detail: "No matching files" };
      }

      try {
        const [bin, ...args] = policy.command.split(" ");
        if (!bin) {
          return {
            gate: policy.name,
            severity: policy.severity as GateSeverity,
            passed: false,
            issues: [{ file: "", message: "Empty command" }],
            detail: "Empty command",
          };
        }

        await execFileAsync(bin, args, {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: policy.timeout * 1000,
          env: { ...process.env, HOG_CHANGED_FILES: files.join("\n") },
        });

        return { gate: policy.name, severity: policy.severity as GateSeverity, passed: true, issues: [], detail: "Passed" };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        const issues: GateIssue[] = [
          {
            file: "",
            message: `${policy.message}: ${message.slice(0, 200)}`,
          },
        ];
        return { gate: policy.name, severity: policy.severity as GateSeverity, passed: false, issues, detail: policy.message };
      }
    },
  };
}

/** Load policies and merge with built-in gates. User policies override by name. */
export function mergeWithBuiltinGates(
  projectPath: string,
  builtinGates: QualityGate[],
): QualityGate[] {
  const policies = loadPolicies(projectPath);
  if (policies.length === 0) return builtinGates;

  const policyNames = new Set(policies.map((p) => p.name));
  // Keep built-in gates that aren't overridden by policies
  const kept = builtinGates.filter((g) => !policyNames.has(g.name));
  // Add policy-based gates
  const policyGates = policies.map(policyToGate);
  return [...kept, ...policyGates];
}

// ── Presets ──

export interface PolicyPreset {
  readonly name: string;
  readonly description: string;
  readonly policies: Policy[];
}

export const PRESETS: Record<string, PolicyPreset> = {
  typescript: {
    name: "typescript",
    description: "Biome lint, TypeScript typecheck, npm audit",
    policies: [
      {
        name: "biome-lint",
        severity: "warning",
        command: "npx biome check --no-errors-on-unmatched .",
        on: ["merge"],
        message: "Biome lint violations found",
        timeout: 60,
      },
      {
        name: "typecheck",
        severity: "error",
        command: "npx tsc --noEmit",
        on: ["merge"],
        message: "TypeScript type errors found",
        timeout: 120,
      },
      {
        name: "dependency-audit",
        severity: "warning",
        command: "npm audit --audit-level high",
        on: ["merge"],
        message: "High-severity dependency vulnerabilities found. Run: npm audit fix",
        timeout: 60,
      },
    ],
  },
  python: {
    name: "python",
    description: "Ruff lint, mypy typecheck, pip audit",
    policies: [
      {
        name: "ruff-lint",
        severity: "warning",
        command: "ruff check .",
        on: ["merge"],
        message: "Ruff lint violations found",
        timeout: 60,
      },
      {
        name: "mypy-typecheck",
        severity: "warning",
        command: "mypy .",
        on: ["merge"],
        message: "mypy type errors found",
        timeout: 120,
      },
      {
        name: "dependency-audit",
        severity: "warning",
        command: "pip audit",
        on: ["merge"],
        message: "Dependency vulnerabilities found. Run: pip audit --fix",
        timeout: 60,
      },
    ],
  },
  rust: {
    name: "rust",
    description: "Clippy lint, cargo audit, cargo-mutants",
    policies: [
      {
        name: "clippy-lint",
        severity: "warning",
        command: "cargo clippy -- -D warnings",
        on: ["merge"],
        message: "Clippy lint violations found",
        timeout: 120,
      },
      {
        name: "dependency-audit",
        severity: "warning",
        command: "cargo audit",
        on: ["merge"],
        message: "Dependency vulnerabilities found",
        timeout: 60,
      },
    ],
  },
};

/** Install a preset's policies to `.hog/policies/`. */
export function installPreset(projectPath: string, presetName: string): number {
  const preset = PRESETS[presetName];
  if (!preset) return 0;

  const policyDir = join(projectPath, POLICY_DIR);
  mkdirSync(policyDir, { recursive: true });

  let installed = 0;
  for (const policy of preset.policies) {
    const filename = `${policy.name}.yaml`;
    const filepath = join(policyDir, filename);
    // Don't overwrite existing policies
    if (existsSync(filepath)) continue;
    writeFileSync(filepath, policyToYaml(policy), "utf-8");
    installed++;
  }
  return installed;
}

// ── Helpers ──

/** Simple YAML parser for flat key-value policies (no nested objects). */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Handle array values: "on: [merge, impl]"
    const arrayMatch = trimmed.match(/^(\w+):\s*\[(.+)\]$/);
    if (arrayMatch?.[1] && arrayMatch[2]) {
      result[arrayMatch[1]] = arrayMatch[2].split(",").map((s) => s.trim().replace(/['"]/g, ""));
      continue;
    }

    // Handle simple key: value
    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (kvMatch?.[1] && kvMatch[2]) {
      const value = kvMatch[2].replace(/^["']|["']$/g, "").trim();
      // Parse numbers
      if (/^\d+$/.test(value)) {
        result[kvMatch[1]] = Number(value);
      } else {
        result[kvMatch[1]] = value;
      }
    }
  }

  return result;
}

/** Convert a policy to YAML string. */
function policyToYaml(policy: Policy): string {
  const lines = [
    `name: ${policy.name}`,
    `severity: ${policy.severity}`,
    `command: ${policy.command}`,
    `on: [${policy.on.join(", ")}]`,
    `message: "${policy.message}"`,
    `timeout: ${policy.timeout}`,
  ];
  if (policy.glob) {
    lines.push(`glob: ${policy.glob}`);
  }
  return lines.join("\n") + "\n";
}

/** Simple glob matching (supports * wildcard). */
function matchGlob(filepath: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`,
  );
  return regex.test(filepath);
}
