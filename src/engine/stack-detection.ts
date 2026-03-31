/**
 * Stack detection — auto-detect project framework and derive build commands,
 * convention checks, and testing guidance.
 *
 * Detection follows the Vercel pattern: config files first (highest confidence),
 * then package.json dependencies, then fallback heuristics.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── Types ──

export interface ConventionCheck {
  /** Human-readable name for logging. */
  readonly name: string;
  /** What this check verifies. */
  readonly description: string;
  /** Run the check. Returns file paths that violate the convention. */
  check(cwd: string): string[];
}

export interface StackInfo {
  /** Detected framework identifier. */
  readonly framework: string;
  /** Runtime environment. */
  readonly runtime: "node" | "python" | "rust" | "go" | "ruby" | "unknown";
  /** Commands to verify the project builds (ordered: fast → slow). */
  readonly buildCommands: readonly string[];
  /** Command to type-check without emitting. */
  readonly typecheckCommand?: string | undefined;
  /** Framework-specific convention checks. */
  readonly conventionChecks: readonly ConventionCheck[];
  /** Guidance injected into the test-writer's context. */
  readonly testingGuidance: string;
}

export interface BuildValidationResult {
  readonly passed: boolean;
  readonly reason?: string | undefined;
  readonly missing?: readonly string[] | undefined;
  readonly context?: string | undefined;
}

// ── Convention Check Implementations ──

/** Check that every .tsx/.ts file in a directory has `export default`. */
function makeDefaultExportCheck(routeDir: string, framework: string): ConventionCheck {
  return {
    name: `${framework}-default-exports`,
    description: `Every route file in ${routeDir}/ must have \`export default\``,
    check(cwd: string): string[] {
      const dir = join(cwd, routeDir);
      if (!existsSync(dir)) return [];
      const violations: string[] = [];
      scanForMissingDefaultExport(dir, cwd, violations);
      return violations;
    },
  };
}

function scanForMissingDefaultExport(dir: string, base: string, results: string[]): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanForMissingDefaultExport(fullPath, base, results);
      } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))) {
        // Skip non-route files (layouts, loading, error boundaries are required to have defaults too)
        try {
          const content = readFileSync(fullPath, "utf-8");
          if (!content.includes("export default")) {
            results.push(fullPath.slice(base.length + 1));
          }
        } catch {
          // skip unreadable
        }
      }
    }
  } catch {
    // skip unreadable directories
  }
}

/** Check that native modules listed in app.json plugins are installed. */
function makeExpoNativeModuleCheck(): ConventionCheck {
  return {
    name: "expo-native-modules",
    description: "All native modules in app.json plugins must be installed",
    check(cwd: string): string[] {
      const appJsonPath = join(cwd, "app.json");
      if (!existsSync(appJsonPath)) return [];
      try {
        const appJson = JSON.parse(readFileSync(appJsonPath, "utf-8")) as {
          expo?: { plugins?: Array<string | [string, unknown]> };
        };
        const plugins = appJson.expo?.plugins ?? [];
        const missing: string[] = [];
        for (const plugin of plugins) {
          const name = Array.isArray(plugin) ? plugin[0] : plugin;
          if (typeof name !== "string") continue;
          // Skip relative paths and built-in expo plugins
          if (name.startsWith(".") || name.startsWith("expo-")) continue;
          if (!existsSync(join(cwd, "node_modules", name))) {
            missing.push(name);
          }
        }
        return missing;
      } catch {
        return [];
      }
    },
  };
}

// ── Framework Presets ──

interface FrameworkPreset {
  readonly framework: string;
  readonly runtime: StackInfo["runtime"];
  readonly buildCommands: readonly string[];
  readonly typecheckCommand?: string | undefined;
  readonly conventionChecks: readonly ConventionCheck[];
  readonly testingGuidance: string;
}

const EXPO_PRESET: FrameworkPreset = {
  framework: "expo",
  runtime: "node",
  buildCommands: ["npx expo export --platform ios"],
  typecheckCommand: "npx tsc --noEmit",
  conventionChecks: [
    makeDefaultExportCheck("app", "expo-router"),
    makeExpoNativeModuleCheck(),
  ],
  testingGuidance: [
    "This is an Expo/React Native project.",
    "Use @testing-library/react-native for component tests.",
    "Mock native modules with jest.mock() in test setup.",
    "Test component rendering, user interactions, and navigation.",
    "Do NOT write Detox or E2E tests — component tests only.",
  ].join(" "),
};

const NEXTJS_PRESET: FrameworkPreset = {
  framework: "nextjs",
  runtime: "node",
  buildCommands: ["npx next build"],
  typecheckCommand: "npx tsc --noEmit",
  conventionChecks: [
    makeDefaultExportCheck("app", "nextjs-app-router"),
    makeDefaultExportCheck("pages", "nextjs-pages"),
  ],
  testingGuidance: [
    "This is a Next.js project.",
    "Use @testing-library/react with vitest or jest.",
    "Test server components and client components separately.",
    "Use next/navigation mocks for testing navigation.",
  ].join(" "),
};

const ANGULAR_PRESET: FrameworkPreset = {
  framework: "angular",
  runtime: "node",
  buildCommands: ["npx ng build"],
  typecheckCommand: "npx tsc --noEmit",
  conventionChecks: [],
  testingGuidance: "This is an Angular project. Use TestBed for component tests, HttpClientTestingModule for service tests.",
};

const SVELTEKIT_PRESET: FrameworkPreset = {
  framework: "sveltekit",
  runtime: "node",
  buildCommands: ["npx svelte-kit build"],
  typecheckCommand: "npx svelte-check",
  conventionChecks: [],
  testingGuidance: "This is a SvelteKit project. Use @testing-library/svelte for component tests.",
};

const RAILS_PRESET: FrameworkPreset = {
  framework: "rails",
  runtime: "ruby",
  buildCommands: [],
  conventionChecks: [],
  testingGuidance: "This is a Rails project. Use RSpec with FactoryBot. Write request specs for APIs, system specs for critical flows.",
};

const RUST_PRESET: FrameworkPreset = {
  framework: "rust",
  runtime: "rust",
  buildCommands: ["cargo build"],
  typecheckCommand: "cargo check",
  conventionChecks: [],
  testingGuidance: "This is a Rust project. Write unit tests in #[cfg(test)] modules. Use assert_eq! and assert! macros.",
};

const GO_PRESET: FrameworkPreset = {
  framework: "go",
  runtime: "go",
  buildCommands: ["go build ./..."],
  typecheckCommand: "go vet ./...",
  conventionChecks: [],
  testingGuidance: "This is a Go project. Write tests in _test.go files using testing.T. Use table-driven tests.",
};

const PYTHON_PRESET: FrameworkPreset = {
  framework: "python",
  runtime: "python",
  buildCommands: [],
  typecheckCommand: "mypy .",
  conventionChecks: [],
  testingGuidance: "This is a Python project. Use pytest with fixtures. Write unit tests for functions, integration tests for API endpoints.",
};

const GENERIC_TS_PRESET: FrameworkPreset = {
  framework: "generic-ts",
  runtime: "node",
  buildCommands: [],
  typecheckCommand: "npx tsc --noEmit",
  conventionChecks: [],
  testingGuidance: "Use the project's test runner (vitest/jest). Write unit tests for pure functions, integration tests for API routes.",
};

// ── Detection ──

/**
 * Detect the project's tech stack from files and dependencies.
 *
 * Detection order (highest confidence first):
 * 1. Framework-specific config files
 * 2. package.json dependencies
 * 3. Language-specific files (Cargo.toml, go.mod, Gemfile)
 * 4. Fallback to generic TypeScript if tsconfig.json exists
 */
export function detectStack(cwd: string): StackInfo | undefined {
  // 1. Config-file detection (highest confidence)
  const configDetected = detectFromConfigFiles(cwd);
  if (configDetected) return applyScriptOverrides(cwd, configDetected);

  // 2. package.json dependency detection
  const depDetected = detectFromDependencies(cwd);
  if (depDetected) return applyScriptOverrides(cwd, depDetected);

  // 3. Language-specific files
  if (existsSync(join(cwd, "Cargo.toml"))) return RUST_PRESET;
  if (existsSync(join(cwd, "go.mod"))) return GO_PRESET;
  if (existsSync(join(cwd, "Gemfile"))) {
    try {
      const gemfile = readFileSync(join(cwd, "Gemfile"), "utf-8");
      if (gemfile.includes("rails")) return RAILS_PRESET;
    } catch { /* fall through */ }
  }
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "setup.py"))) {
    return PYTHON_PRESET;
  }

  // 4. Fallback: generic TypeScript
  if (existsSync(join(cwd, "tsconfig.json"))) {
    return applyScriptOverrides(cwd, GENERIC_TS_PRESET);
  }

  return undefined;
}

function detectFromConfigFiles(cwd: string): FrameworkPreset | undefined {
  // Expo: app.json with expo key, or app.config.ts/js
  if (existsSync(join(cwd, "app.json"))) {
    try {
      const appJson = JSON.parse(readFileSync(join(cwd, "app.json"), "utf-8")) as Record<string, unknown>;
      if ("expo" in appJson) return EXPO_PRESET;
    } catch { /* not valid JSON */ }
  }
  if (existsSync(join(cwd, "app.config.ts")) || existsSync(join(cwd, "app.config.js"))) {
    return EXPO_PRESET;
  }

  // Next.js
  if (
    existsSync(join(cwd, "next.config.js")) ||
    existsSync(join(cwd, "next.config.ts")) ||
    existsSync(join(cwd, "next.config.mjs"))
  ) {
    return NEXTJS_PRESET;
  }

  // Angular
  if (existsSync(join(cwd, "angular.json"))) return ANGULAR_PRESET;

  // SvelteKit
  if (existsSync(join(cwd, "svelte.config.js"))) return SVELTEKIT_PRESET;

  // Astro, Nuxt — add as needed
  return undefined;
}

function detectFromDependencies(cwd: string): FrameworkPreset | undefined {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return undefined;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if ("expo" in allDeps) return EXPO_PRESET;
    if ("next" in allDeps) return NEXTJS_PRESET;
    if ("@angular/core" in allDeps) return ANGULAR_PRESET;
    if ("@sveltejs/kit" in allDeps) return SVELTEKIT_PRESET;
  } catch {
    // invalid package.json
  }
  return undefined;
}

/**
 * Override build/typecheck commands with package.json scripts if present.
 * User's configured commands take priority over framework defaults.
 */
function applyScriptOverrides(cwd: string, preset: FrameworkPreset): StackInfo {
  const pkgPath = join(cwd, "package.json");
  let buildCommands = [...preset.buildCommands];
  let typecheckCommand = preset.typecheckCommand;

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      // If user has a build script, use it instead of framework default
      if (pkg.scripts?.["build"]) {
        buildCommands = ["npm run build"];
      }
      // If user has a typecheck script, prefer it
      if (pkg.scripts?.["typecheck"]) {
        typecheckCommand = "npm run typecheck";
      }
    } catch {
      // invalid package.json
    }
  }

  return {
    framework: preset.framework,
    runtime: preset.runtime,
    buildCommands,
    typecheckCommand,
    conventionChecks: preset.conventionChecks,
    testingGuidance: preset.testingGuidance,
  };
}

// ── Monorepo Detection ──

export interface MonorepoInfo {
  readonly type: "turbo" | "nx" | "pnpm" | "npm-workspaces" | "none";
  readonly buildCommand?: string | undefined;
}

export function detectMonorepo(cwd: string): MonorepoInfo {
  if (existsSync(join(cwd, "turbo.json"))) {
    return { type: "turbo", buildCommand: "npx turbo run build" };
  }
  if (existsSync(join(cwd, "nx.json"))) {
    return { type: "nx", buildCommand: "npx nx run-many --target=build" };
  }
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) {
    return { type: "pnpm" };
  }
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8")) as {
      workspaces?: string[] | { packages: string[] };
    };
    if (pkg.workspaces) return { type: "npm-workspaces" };
  } catch {
    // not a workspace
  }
  return { type: "none" };
}

// ── Build Validation ──

/**
 * Run build validation for a detected stack.
 *
 * Runs typecheck first (fast), then build commands (slower),
 * then convention checks (fast, file-system only).
 * Returns on first failure with structured error output.
 */
export function runBuildValidation(
  cwd: string,
  stack: StackInfo,
): BuildValidationResult {
  const failures: string[] = [];
  let errorOutput = "";

  // 1. Typecheck (fast)
  if (stack.typecheckCommand) {
    const result = runCommand(cwd, stack.typecheckCommand, 60_000);
    if (!result.success) {
      failures.push(`Typecheck failed: ${stack.typecheckCommand}`);
      errorOutput += `=== ${stack.typecheckCommand} ===\n${result.output.slice(0, 1500)}\n`;
    }
  }

  // 2. Build commands (slower — skip if typecheck already failed for fast feedback)
  if (failures.length === 0) {
    for (const cmd of stack.buildCommands) {
      const result = runCommand(cwd, cmd, 180_000);
      if (!result.success) {
        failures.push(`Build failed: ${cmd}`);
        errorOutput += `=== ${cmd} ===\n${result.output.slice(0, 1500)}\n`;
        break; // stop on first build failure
      }
    }
  }

  // 3. Convention checks (fast, always run)
  for (const check of stack.conventionChecks) {
    const violations = check.check(cwd);
    if (violations.length > 0) {
      failures.push(`${check.name}: ${violations.length} violation${violations.length === 1 ? "" : "s"}`);
      errorOutput += `=== ${check.description} ===\n${violations.slice(0, 20).join("\n")}\n`;
    }
  }

  if (failures.length === 0) {
    return { passed: true };
  }

  return {
    passed: false,
    reason: failures.join("; "),
    missing: failures,
    context: errorOutput.slice(0, 2000),
  };
}

/** Run a shell command with a timeout. Returns success + combined output. */
function runCommand(cwd: string, command: string, timeoutMs: number): { success: boolean; output: string } {
  try {
    const [cmd, ...args] = command.split(" ");
    if (!cmd) return { success: false, output: "Empty command" };
    const result = execFileSync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      shell: true,
    });
    return { success: true, output: String(result) };
  } catch (err: unknown) {
    const error = err as { stderr?: string; stdout?: string; message?: string };
    const output = [error.stdout ?? "", error.stderr ?? "", error.message ?? ""].join("\n").trim();
    return { success: false, output };
  }
}
