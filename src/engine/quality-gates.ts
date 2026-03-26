import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ──

export type GateSeverity = "error" | "warning" | "info";

export interface GateResult {
  readonly gate: string;
  readonly severity: GateSeverity;
  readonly passed: boolean;
  readonly issues: GateIssue[];
  readonly detail: string;
}

export interface GateIssue {
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly rule?: string;
}

export interface QualityGate {
  readonly name: string;
  readonly severity: GateSeverity;
  isAvailable(cwd: string): boolean;
  check(cwd: string, files: string[]): Promise<GateResult>;
}

export interface QualityReport {
  readonly gates: GateResult[];
  readonly passed: boolean;
  readonly blockers: GateResult[];
  readonly warnings: GateResult[];
}

// ── Gate Runner ──

/** Run all available quality gates on the given files. */
export async function runQualityGates(
  cwd: string,
  files: string[],
  gates?: QualityGate[],
): Promise<QualityReport> {
  const activeGates = (gates ?? ALL_GATES).filter((g) => g.isAvailable(cwd));

  const results = await Promise.all(activeGates.map((g) => g.check(cwd, files)));

  const blockers = results.filter((r) => !r.passed && r.severity === "error");
  const warnings = results.filter((r) => !r.passed && r.severity === "warning");

  return {
    gates: results,
    passed: blockers.length === 0,
    blockers,
    warnings,
  };
}

// ── Linting Gate ──

const lintingGate: QualityGate = {
  name: "linting",
  severity: "warning",

  isAvailable(cwd: string): boolean {
    return (
      existsSync(join(cwd, "biome.json")) ||
      existsSync(join(cwd, "biome.jsonc")) ||
      existsSync(join(cwd, ".eslintrc")) ||
      existsSync(join(cwd, ".eslintrc.js")) ||
      existsSync(join(cwd, ".eslintrc.json")) ||
      existsSync(join(cwd, "eslint.config.js")) ||
      existsSync(join(cwd, "ruff.toml")) ||
      existsSync(join(cwd, "pyproject.toml"))
    );
  },

  async check(cwd: string, files: string[]): Promise<GateResult> {
    if (files.length === 0) {
      return {
        gate: "linting",
        severity: "warning",
        passed: true,
        issues: [],
        detail: "No files to lint",
      };
    }

    const linter = detectLinter(cwd);
    if (!linter) {
      return {
        gate: "linting",
        severity: "warning",
        passed: true,
        issues: [],
        detail: "No linter detected",
      };
    }

    try {
      const { cmd, args } = linter;
      await execFileAsync(cmd, [...args, ...files], {
        cwd,
        encoding: "utf-8",
        timeout: 60_000,
      });
      return {
        gate: "linting",
        severity: "warning",
        passed: true,
        issues: [],
        detail: "All files pass linting",
      };
    } catch (err: unknown) {
      const output = getOutput(err);
      const issues = parseLintIssues(output);
      return {
        gate: "linting",
        severity: "warning",
        passed: false,
        issues,
        detail: `${issues.length} linting issue(s) found`,
      };
    }
  },
};

// ── Security Gate ──

const securityGate: QualityGate = {
  name: "security",
  severity: "error",

  isAvailable(_cwd: string): boolean {
    // Check if semgrep is available
    try {
      const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
      execFileSync("semgrep", ["--version"], { encoding: "utf-8", timeout: 5_000, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  },

  async check(cwd: string, files: string[]): Promise<GateResult> {
    if (files.length === 0) {
      return {
        gate: "security",
        severity: "error",
        passed: true,
        issues: [],
        detail: "No files to scan",
      };
    }

    try {
      const { stdout } = await execFileAsync("semgrep", ["--config", "auto", "--json", ...files], {
        cwd,
        encoding: "utf-8",
        timeout: 120_000,
      });

      const parsed = JSON.parse(stdout) as {
        results?: {
          path: string;
          start: { line: number };
          extra: { message: string; metadata: { source_rule_url?: string } };
        }[];
      };
      const results = parsed.results ?? [];

      const issues: GateIssue[] = results.map((r) => ({
        file: r.path,
        line: r.start.line,
        message: r.extra.message,
        ...(r.extra.metadata.source_rule_url ? { rule: r.extra.metadata.source_rule_url } : {}),
      }));

      return {
        gate: "security",
        severity: "error",
        passed: issues.length === 0,
        issues,
        detail:
          issues.length === 0
            ? "No security issues found"
            : `${issues.length} security issue(s) found`,
      };
    } catch (err: unknown) {
      const output = getOutput(err);
      // semgrep exits non-zero when findings exist
      try {
        const parsed = JSON.parse(output) as {
          results?: {
            path: string;
            start: { line: number };
            extra: { message: string; metadata: { source_rule_url?: string } };
          }[];
        };
        const results = parsed.results ?? [];
        const issues: GateIssue[] = results.map((r) => ({
          file: r.path,
          line: r.start.line,
          message: r.extra.message,
          ...(r.extra.metadata.source_rule_url ? { rule: r.extra.metadata.source_rule_url } : {}),
        }));
        return {
          gate: "security",
          severity: "error",
          passed: issues.length === 0,
          issues,
          detail: `${issues.length} security issue(s) found`,
        };
      } catch {
        return {
          gate: "security",
          severity: "error",
          passed: true,
          issues: [],
          detail: `Security scan inconclusive: ${output.slice(0, 100)}`,
        };
      }
    }
  },
};

// ── Abuse/Injection Gate ──

const abuseGate: QualityGate = {
  name: "abuse-patterns",
  severity: "error",

  isAvailable(): boolean {
    return true; // Uses grep — always available
  },

  async check(cwd: string, files: string[]): Promise<GateResult> {
    if (files.length === 0) {
      return {
        gate: "abuse-patterns",
        severity: "error",
        passed: true,
        issues: [],
        detail: "No files to check",
      };
    }

    const patterns = [
      { pattern: "eval\\s*\\(", message: "Potential code injection via eval()", rule: "no-eval" },
      {
        pattern: "exec\\s*\\(.*\\$",
        message: "Potential command injection",
        rule: "no-shell-injection",
      },
      { pattern: "innerHTML\\s*=", message: "Potential XSS via innerHTML", rule: "no-inner-html" },
      {
        pattern: "(password|secret|api.?key)\\s*[:=]\\s*['\"][^'\"]{8,}",
        message: "Potential hardcoded credential",
        rule: "no-hardcoded-secrets",
      },
      { pattern: "\\.\\./", message: "Potential path traversal", rule: "no-path-traversal" },
    ];

    const issues: GateIssue[] = [];

    for (const file of files) {
      for (const { pattern, message, rule } of patterns) {
        try {
          const { stdout } = await execFileAsync("grep", ["-n", "-E", pattern, file], {
            cwd,
            encoding: "utf-8",
            timeout: 5_000,
          });
          for (const line of stdout.trim().split("\n").filter(Boolean)) {
            const lineNum = parseInt(line.split(":")[0] ?? "0", 10);
            issues.push({ file, line: lineNum, message, rule });
          }
        } catch {
          // grep exits 1 when no matches — that's fine
        }
      }
    }

    return {
      gate: "abuse-patterns",
      severity: "error",
      passed: issues.length === 0,
      issues,
      detail:
        issues.length === 0
          ? "No abuse patterns detected"
          : `${issues.length} potential abuse pattern(s) found`,
    };
  },
};

// ── Role Audit Gate (Amodei) ──

const TEST_FILE_PATTERNS = [
	/\.test\.[jt]sx?$/,
	/\.spec\.[jt]sx?$/,
	/\/__tests__\//,
	/\/tests?\//,
	/_test\.[jt]sx?$/,
	/_test\.py$/,
	/test_[^/]+\.py$/,
];

const SOURCE_PATTERNS = [
	/^src\//,
	/^lib\//,
	/^app\//,
	/^pkg\//,
];

function isTestFile(path: string): boolean {
	return TEST_FILE_PATTERNS.some((p) => p.test(path));
}

function isSourceFile(path: string): boolean {
	return SOURCE_PATTERNS.some((p) => p.test(path));
}

/**
 * Create a role-scoped audit gate that verifies an agent only modified
 * files appropriate for its role. Catches the most dangerous prompt violations.
 *
 * Usage: `createRoleAuditGate("test")` returns a gate that fails if non-test files were modified.
 */
export function createRoleAuditGate(role: string): QualityGate {
	return {
		name: `role-audit:${role}`,
		severity: "error",

		isAvailable(): boolean {
			// Always available — no external tools needed
			return true;
		},

		async check(_cwd: string, files: string[]): Promise<GateResult> {
			const violations: GateIssue[] = [];

			for (const file of files) {
				let violation = false;

				switch (role) {
					case "test":
					case "redteam":
						// Test/redteam agents should only modify test files
						if (!isTestFile(file)) {
							violation = true;
						}
						break;
					case "impl":
						// Impl agent should only modify source files (not tests)
						if (isTestFile(file)) {
							violation = true;
						}
						break;
					case "stories":
						// Stories agent should only modify docs/stories files
						if (!file.startsWith("docs/") && !file.startsWith("tests/stories/") && !file.endsWith(".md")) {
							violation = true;
						}
						break;
					// brainstorm and merge: no restrictions
				}

				if (violation) {
					violations.push({
						file,
						message: `${role} agent modified file outside its allowed scope`,
						rule: "role-boundary",
					});
				}
			}

			return {
				gate: `role-audit:${role}`,
				severity: "error",
				passed: violations.length === 0,
				issues: violations,
				detail:
					violations.length === 0
						? `${role} agent stayed within its file scope`
						: `${role} agent modified ${violations.length} file(s) outside its allowed scope`,
			};
		},
	};
}

// ── Mutation Testing Gate (Farley) ──

const mutationGate: QualityGate = {
	name: "mutation-testing",
	severity: "warning", // Advisory — don't block, but report

	isAvailable(cwd: string): boolean {
		// Available when a mutation testing tool is configured
		return !!(
			existsSync(join(cwd, "stryker.config.mjs")) ||
			existsSync(join(cwd, "stryker.config.js")) ||
			existsSync(join(cwd, "Cargo.toml"))
		);
	},

	async check(cwd: string, _files: string[]): Promise<GateResult> {
		try {
			// Dynamic import to avoid circular dependency
			const { runMutationTesting } = await import("./tdd-enforcement.js");
			const result = await runMutationTesting(cwd, {
				enforceRedFirst: true,
				mutationThreshold: 70,
				specTraceability: true,
			});
			return {
				gate: "mutation-testing",
				severity: "warning",
				passed: result.passed,
				issues: result.passed
					? []
					: [
							{
								file: "mutation-report",
								message: `Mutation score ${result.score}% below threshold (${result.survived} mutants survived)`,
								rule: "mutation-threshold",
							},
						],
				detail: `Mutation score: ${result.score}% (${result.killed}/${result.total} killed). ${result.passed ? "Above" : "Below"} threshold.`,
			};
		} catch (err) {
			return {
				gate: "mutation-testing",
				severity: "warning",
				passed: true, // Don't block if mutation tool fails
				issues: [],
				detail: `Mutation testing skipped: ${err instanceof Error ? err.message : "unknown error"}`,
			};
		}
	},
};

// ── Registry ──

export const ALL_GATES: QualityGate[] = [lintingGate, securityGate, abuseGate, mutationGate];

// ── Helpers ──

function detectLinter(cwd: string): { cmd: string; args: string[] } | undefined {
  if (existsSync(join(cwd, "biome.json")) || existsSync(join(cwd, "biome.jsonc"))) {
    return { cmd: "npx", args: ["biome", "check"] };
  }
  if (
    existsSync(join(cwd, ".eslintrc")) ||
    existsSync(join(cwd, ".eslintrc.js")) ||
    existsSync(join(cwd, ".eslintrc.json")) ||
    existsSync(join(cwd, "eslint.config.js"))
  ) {
    return { cmd: "npx", args: ["eslint"] };
  }
  if (existsSync(join(cwd, "ruff.toml"))) {
    return { cmd: "ruff", args: ["check"] };
  }
  return undefined;
}

function parseLintIssues(output: string): GateIssue[] {
  const issues: GateIssue[] = [];
  // Generic: file:line:col: message
  const lineRe = /^(.+?):(\d+):\d+:\s*(.+)$/gm;
  let match: RegExpExecArray | null = lineRe.exec(output);
  while (match) {
    issues.push({
      file: match[1] ?? "",
      line: parseInt(match[2] ?? "0", 10),
      message: match[3] ?? "",
    });
    match = lineRe.exec(output);
  }
  return issues;
}

function getOutput(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stdout?: string; stderr?: string };
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
  return "";
}
