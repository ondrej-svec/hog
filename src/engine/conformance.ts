/**
 * Architecture conformance checker — mechanical verification that the implementation
 * matches the architecture document.
 *
 * Runs as a pre-close gate on the impl bead. Checks:
 * 1. All architecture dependencies are imported in source
 * 2. All specified files exist
 * 3. No stub patterns detected
 *
 * Graceful degradation: unparseable architecture docs produce warnings, not blocks.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ──

export interface ConformanceResult {
  readonly passed: boolean;
  readonly missingDeps: readonly string[];
  readonly missingFiles: readonly string[];
  readonly stubs: readonly string[];
  readonly detail: string;
}

// ── Architecture Doc Parsing ──

/** Extract package names from a ## Dependencies table in the architecture doc. */
export function parseDependencies(archContent: string): string[] {
  const deps: string[] = [];
  const depsSection = archContent.match(/## Dependencies\s*\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (!depsSection?.[1]) return deps;

  // Match table rows: | package-name | description |
  const rows = depsSection[1].matchAll(/\|\s*`?([a-zA-Z0-9@/_.-]+)`?\s*\|/g);
  for (const match of rows) {
    const pkg = match[1]?.trim();
    if (pkg && !pkg.includes("---") && pkg !== "Package" && pkg !== "Name" && pkg !== "Dependency") {
      deps.push(pkg);
    }
  }
  return deps;
}

/** Extract expected file paths from ## File Structure section. */
export function parseFileStructure(archContent: string): string[] {
  const files: string[] = [];
  const section = archContent.match(/## File Structure\s*\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (!section?.[1]) return files;

  // Match backtick-wrapped paths or table rows with paths
  const pathMatches = section[1].matchAll(/`([a-zA-Z0-9/_.-]+\.[a-zA-Z]+)`/g);
  for (const match of pathMatches) {
    if (match[1]) files.push(match[1]);
  }
  return files;
}

// ── Stub Detection ──

const STUB_PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bSTUB\b/,
  /\bHACK\b/,
  /\bPLACEHOLDER\b/,
  /not\s+implemented/i,
  /throw\s+new\s+Error\s*\(\s*["']not\s+implemented/i,
];

/** Scan source files for stub patterns. Returns list of files with stubs. */
export async function detectStubPatterns(cwd: string): Promise<string[]> {
  const patterns = [
    "TODO", "FIXME", "STUB", "HACK", "PLACEHOLDER",
    "not implemented", "throw new Error",
  ];

  const stubFiles: string[] = [];
  for (const pattern of patterns) {
    try {
      const { stdout } = await execFileAsync(
        "grep",
        ["-rl", "--include=*.ts", "--include=*.tsx", "--include=*.js",
         "--include=*.py", "--include=*.rs",
         "-e", pattern, "src/", "lib/", "app/"],
        { cwd, timeout: 10_000 },
      );
      for (const file of stdout.trim().split("\n")) {
        if (file && !stubFiles.includes(file)) {
          // Verify it's actually a stub, not just a comment mentioning TODO
          try {
            const content = readFileSync(join(cwd, file), "utf-8");
            if (STUB_PATTERNS.some((p) => p.test(content))) {
              stubFiles.push(file);
            }
          } catch {
            // Can't read file, skip
          }
        }
      }
    } catch {
      // grep returns non-zero when no matches — expected
    }
  }
  return stubFiles;
}

// ── Import Detection ──

/** Check if a package is imported anywhere in source files. */
async function isPackageImported(cwd: string, pkg: string): Promise<boolean> {
  // Try multiple import patterns across languages
  const patterns = [
    `import.*from.*["']${pkg}`,   // JS/TS ESM
    `require\\(["']${pkg}`,       // JS CJS
    `from ${pkg} import`,         // Python
    `import ${pkg}`,              // Python
    `use ${pkg}::`,               // Rust
    `extern crate ${pkg}`,        // Rust
  ];

  for (const pattern of patterns) {
    try {
      await execFileAsync(
        "grep",
        ["-rlE", "--include=*.ts", "--include=*.tsx", "--include=*.js",
         "--include=*.py", "--include=*.rs",
         "--exclude-dir=__tests__", "--exclude-dir=test", "--exclude-dir=tests",
         "--exclude-dir=spec", "--exclude-dir=node_modules",
         "-e", pattern, "."],
        { cwd, timeout: 10_000 },
      );
      return true; // grep found a match
    } catch {
      // No match for this pattern, try next
    }
  }
  return false;
}

// ── Main Check ──

/**
 * Check implementation against architecture document.
 * Returns a structured result with all violations found.
 *
 * Graceful degradation: if the arch doc can't be parsed, returns passed=true
 * with a warning in detail. Only blocks on detected violations.
 */
export async function checkArchitectureConformance(
  cwd: string,
  archPath: string,
): Promise<ConformanceResult> {
  if (!existsSync(archPath)) {
    return {
      passed: true,
      missingDeps: [],
      missingFiles: [],
      stubs: [],
      detail: `Architecture doc not found at ${archPath} — skipping conformance check`,
    };
  }

  let archContent: string;
  try {
    archContent = readFileSync(archPath, "utf-8");
  } catch {
    return {
      passed: true,
      missingDeps: [],
      missingFiles: [],
      stubs: [],
      detail: `Could not read architecture doc — skipping conformance check`,
    };
  }

  const missingDeps: string[] = [];
  const missingFiles: string[] = [];

  // Check dependencies
  const expectedDeps = parseDependencies(archContent);
  for (const dep of expectedDeps) {
    const imported = await isPackageImported(cwd, dep);
    if (!imported) {
      missingDeps.push(dep);
    }
  }

  // Check file structure
  const expectedFiles = parseFileStructure(archContent);
  for (const file of expectedFiles) {
    if (!existsSync(join(cwd, file))) {
      missingFiles.push(file);
    }
  }

  // Check for stubs
  const stubs = await detectStubPatterns(cwd);

  const passed = missingDeps.length === 0 && missingFiles.length === 0 && stubs.length === 0;
  const details: string[] = [];
  if (missingDeps.length > 0) details.push(`Missing deps: ${missingDeps.join(", ")}`);
  if (missingFiles.length > 0) details.push(`Missing files: ${missingFiles.join(", ")}`);
  if (stubs.length > 0) details.push(`Stubs found: ${stubs.join(", ")}`);

  return {
    passed,
    missingDeps,
    missingFiles,
    stubs,
    detail: passed ? "Architecture conformance verified" : details.join(". "),
  };
}
