/**
 * Ship phase detection logic — determines whether deployment docs are needed
 * and checks operational readiness.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── Deployment Detection ──

/** File patterns that signal deployment infrastructure. */
const DEPLOYMENT_FILES = [
  "vercel.json",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "fly.toml",
  "render.yaml",
  "netlify.toml",
  "Procfile",
] as const;

/** Directory patterns that signal deployment infrastructure. */
const DEPLOYMENT_DIRS = ["terraform"] as const;

/** File extensions that signal Terraform/IaC. */
const DEPLOYMENT_EXTENSIONS = [".tf"] as const;

/** Cloud SDK import patterns in source code. */
const CLOUD_SDK_PATTERNS = [
  /@vercel\//,
  /@aws-sdk\//,
  /@google-cloud\//,
  /firebase-admin/,
] as const;

/** Architecture doc section headers that signal deployment needs. */
const DEPLOYMENT_SECTIONS = [
  /^##\s+deployment/im,
  /^##\s+infrastructure/im,
  /^##\s+hosting/im,
] as const;

export interface DeploymentDetectionResult {
  readonly needed: boolean;
  readonly signals: readonly string[];
}

/**
 * Detect whether deployment documentation should be generated.
 *
 * Two signal types, either sufficient:
 * - Explicit: architecture doc contains deployment/infrastructure/hosting sections
 * - Implicit: project contains deployment config files or cloud SDK imports
 */
export function detectDeploymentNeed(
  projectPath: string,
  architectureDoc?: string,
): DeploymentDetectionResult {
  const signals: string[] = [];

  // Check architecture doc sections
  if (architectureDoc) {
    for (const pattern of DEPLOYMENT_SECTIONS) {
      if (pattern.test(architectureDoc)) {
        signals.push(`Architecture doc contains ${pattern.source}`);
      }
    }
  }

  // Check deployment files
  for (const file of DEPLOYMENT_FILES) {
    if (existsSync(join(projectPath, file))) {
      signals.push(`Found ${file}`);
    }
  }

  // Check deployment directories
  for (const dir of DEPLOYMENT_DIRS) {
    if (existsSync(join(projectPath, dir))) {
      signals.push(`Found ${dir}/ directory`);
    }
  }

  // Check for .tf files in root
  try {
    const rootFiles = readdirSync(projectPath);
    for (const file of rootFiles) {
      for (const ext of DEPLOYMENT_EXTENSIONS) {
        if (file.endsWith(ext)) {
          signals.push(`Found ${file}`);
        }
      }
    }
  } catch {
    // best-effort
  }

  // Check for cloud SDK imports in package.json
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = readFileSync(pkgPath, "utf-8");
      for (const pattern of CLOUD_SDK_PATTERNS) {
        if (pattern.test(pkg)) {
          signals.push(`package.json references ${pattern.source}`);
        }
      }
    } catch {
      // best-effort
    }
  }

  return { needed: signals.length > 0, signals };
}

// ── Operational Readiness ──

/** Simple patterns that suggest hardcoded secrets. */
const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][a-zA-Z0-9_+/=-]{16,}["']/i,
] as const;

export interface OperationalReadinessResult {
  readonly ready: boolean;
  readonly gaps: {
    /** Gaps the ship agent can fix directly (within its canWrite scope). */
    readonly fixableByShip: readonly string[];
    /** Gaps that require impl to fix (code changes needed). */
    readonly needsImpl: readonly string[];
  };
}

/**
 * Check operational readiness of the project.
 *
 * Scans for common gaps: missing .env.example, hardcoded secrets,
 * missing health checks when deployment config exists.
 */
export function checkOperationalReadiness(
  projectPath: string,
  options?: {
    hasDeploymentConfig?: boolean;
    sourceFiles?: readonly string[];
  },
): OperationalReadinessResult {
  const fixableByShip: string[] = [];
  const needsImpl: string[] = [];

  // Check for process.env usage without .env.example
  const envExamplePath = join(projectPath, ".env.example");
  const hasEnvExample = existsSync(envExamplePath);

  if (!hasEnvExample) {
    // Check if source uses process.env
    const sourceFiles = options?.sourceFiles ?? findSourceFiles(projectPath);
    let usesEnvVars = false;
    for (const file of sourceFiles) {
      try {
        const content = readFileSync(join(projectPath, file), "utf-8");
        if (/process\.env\b/.test(content) || /import\.meta\.env\b/.test(content)) {
          usesEnvVars = true;
          break;
        }
      } catch {
        // skip unreadable files
      }
    }
    if (usesEnvVars) {
      fixableByShip.push("Missing .env.example — project uses environment variables");
    }
  }

  // Check for hardcoded secrets in source
  const sourceFiles = options?.sourceFiles ?? findSourceFiles(projectPath);
  for (const file of sourceFiles) {
    try {
      const content = readFileSync(join(projectPath, file), "utf-8");
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) {
          needsImpl.push(`Possible hardcoded secret in ${file}`);
          break;
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  // Check for health check when deployment config exists
  if (options?.hasDeploymentConfig) {
    let hasHealthCheck = false;
    for (const file of sourceFiles) {
      try {
        const content = readFileSync(join(projectPath, file), "utf-8");
        if (/\/health|\/healthz|\/readyz|health[_-]?check/i.test(content)) {
          hasHealthCheck = true;
          break;
        }
      } catch {
        // skip
      }
    }
    if (!hasHealthCheck) {
      needsImpl.push("No health check endpoint found — deployment config exists");
    }
  }

  return {
    ready: fixableByShip.length === 0 && needsImpl.length === 0,
    gaps: { fixableByShip, needsImpl },
  };
}

/** Find source files in common locations — shallow scan, not recursive. */
function findSourceFiles(projectPath: string): string[] {
  const files: string[] = [];
  const srcDir = join(projectPath, "src");

  try {
    if (existsSync(srcDir)) {
      scanDir(srcDir, projectPath, files, 3);
    }
    // Also check root for config files
    for (const file of readdirSync(projectPath)) {
      if (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".py")) {
        files.push(file);
      }
    }
  } catch {
    // best-effort
  }

  return files;
}

function scanDir(dir: string, base: string, results: string[], maxDepth: number): void {
  if (maxDepth <= 0) return;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const relPath = fullPath.slice(base.length + 1);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        scanDir(fullPath, base, results, maxDepth - 1);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") ||
          entry.name.endsWith(".js") ||
          entry.name.endsWith(".py") ||
          entry.name.endsWith(".rb"))
      ) {
        results.push(relPath);
      }
    }
  } catch {
    // skip unreadable directories
  }
}
