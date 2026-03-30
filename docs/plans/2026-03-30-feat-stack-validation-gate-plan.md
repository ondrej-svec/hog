---
title: "feat: stack-aware validation gate — build checks, convention enforcement, dependency completeness"
type: plan
date: 2026-03-30
status: approved
confidence: high
---

# Stack-Aware Validation Gate

One-line: After impl completes, auto-detect the project's tech stack and run framework-specific build, typecheck, and convention checks before spawning redteam — reopening impl with structured feedback when checks fail.

## Problem Statement

The pipeline writes code that passes tests but doesn't build, bundle, or follow framework conventions. Example: an Expo app where `tsc --noEmit` passes but `expo export` fails due to missing default exports in route files, uninstalled native modules, and broken Metro bundling. These are invisible to the test suite but fatal to shipping.

Three validation gaps exist:

1. **Build validation** — `tsc` passes but `expo export` / `next build` / `cargo build` fails
2. **Convention enforcement** — framework-specific rules (expo-router requires `export default` in every route file) that no linter catches
3. **Dependency completeness** — native modules, peer deps, missing packages that cause runtime crashes

These are properties of the **stack**, not the **task**. Whether you're building auth or settings, you still need default exports in Expo route files.

## Proposed Solution

Add a `build-gate` that runs after impl completes (alongside existing stub-gate, conform-gate). It:

1. **Detects the stack** from project files (new `stack-detection.ts`)
2. **Runs build/typecheck commands** discovered from `package.json` scripts or framework conventions
3. **Runs convention checks** specific to the detected framework
4. **Feeds failures back to impl** via the existing retry engine with structured error output

### Detection → Validation flow

```
impl completes
  → detectStack(projectPath)           # returns { framework, buildCommands, conventions }
  → run buildCommands                   # tsc --noEmit, expo export, next build, etc.
  → run convention checks               # default exports, native modules, etc.
  → if failures → runGate("build-gate") # retry impl with error output
  → if pass → proceed to redteam
```

### Context injection flow

```
detectStack(projectPath)
  → inject into test-writer context: "This is an Expo project. Use @testing-library/react-native."
  → inject into impl context: "Before finishing, verify: tsc, expo export, expo-doctor."
```

## Implementation Tasks

### Phase 0: Stack detection module

- [ ] 0.1 Create `src/engine/stack-detection.ts` with `detectStack(cwd)` returning `StackInfo`:
  ```ts
  interface StackInfo {
    framework: string;          // "expo" | "nextjs" | "rails" | "generic-ts" | "python" | "rust" | ...
    runtime: string;            // "node" | "python" | "rust" | "go" | "ruby"
    buildCommands: string[];    // commands to verify the project builds
    typecheckCommand?: string;  // tsc --noEmit, mypy, cargo check
    conventionChecks: ConventionCheck[];  // framework-specific file/pattern checks
    testingGuidance: string;    // injected into test-writer context
  }
  ```
- [ ] 0.2 Implement framework detection — config file first, then package.json deps:

  | Signal (priority order) | Framework | Build command | Typecheck |
  |------------------------|-----------|---------------|-----------|
  | `app.json` with `expo` key, OR `expo` in deps | `expo` | `npx expo export --platform ios` | `npx tsc --noEmit` |
  | `next.config.*` OR `next` in deps | `nextjs` | `npx next build` | `npx tsc --noEmit` |
  | `angular.json` | `angular` | `npx ng build` | `npx tsc --noEmit` |
  | `astro.config.*` | `astro` | `npx astro build` | `npx tsc --noEmit` |
  | `nuxt.config.*` | `nuxt` | `npx nuxi build` | `npx tsc --noEmit` |
  | `svelte.config.js` | `sveltekit` | `npx svelte-kit build` | `npx svelte-check` |
  | `Gemfile` with `rails` | `rails` | `bin/rails assets:precompile` | — |
  | `Cargo.toml` | `rust` | `cargo build` | `cargo check` |
  | `go.mod` | `go` | `go build ./...` | `go vet ./...` |
  | `pyproject.toml` or `setup.py` | `python` | — | `mypy .` (if installed) |
  | `tsconfig.json` (fallback) | `generic-ts` | `scripts.build` from package.json | `npx tsc --noEmit` |

- [ ] 0.3 Implement `scripts.build` and `scripts.typecheck` detection from `package.json` — use these as overrides when present (user's configured commands > framework defaults)
- [ ] 0.4 Implement monorepo detection: `turbo.json` → use `turbo run build`, `nx.json` → use `nx run-many --target=build`, `pnpm-workspace.yaml` → check workspace root. When in a monorepo, scope to the affected workspace.
- [ ] 0.5 Implement convention checks registry:

  | Framework | Convention check | Implementation |
  |-----------|-----------------|----------------|
  | `expo` | Every `.tsx`/`.ts` file in `app/` has `export default` | `grep -rL "export default" app/ --include="*.tsx" --include="*.ts"` |
  | `expo` | Native modules installed | parse `app.json` plugins, check each in `node_modules/` |
  | `expo` | `expo-doctor` passes | `npx expo-doctor` (if available) |
  | `nextjs` | Every file in `app/` or `pages/` has default export | same grep pattern |
  | `nextjs` | `next lint` passes | `npx next lint` (if available) |
  | `rails` | No pending migrations | `bin/rails db:migrate:status` check for "down" |
  | `rails` | Specs loadable | `bundle exec rspec --dry-run` |
  | `generic-ts` | No `any` in new files | `grep -n ": any" <changed-files>` |

- [ ] 0.6 Implement testing guidance strings per framework:

  | Framework | Guidance injected into test-writer context |
  |-----------|-------------------------------------------|
  | `expo` | "Use @testing-library/react-native. Mock native modules with jest.mock(). Test component rendering and user interactions." |
  | `nextjs` | "Use @testing-library/react with vitest or jest. Test server components separately from client components." |
  | `rails` | "Use RSpec with FactoryBot. Write request specs for API endpoints, system specs for critical flows." |
  | `generic-ts` | "Use the project's test runner (vitest/jest). Write unit tests for pure functions, integration tests for API routes." |

- [ ] 0.7 Tests for `detectStack` — detection for each framework, fallback behavior, monorepo detection

### Phase 1: Build gate in retry engine

- [ ] 1.1 Add `build-gate` to `GATE_CONFIGS` in `retry-engine.ts`:
  - phases: `["impl"]`
  - retryRole: `"impl"`
  - alsoReopen: `[]` (impl only — build failures are impl's problem)
  - decrementBeads: `0` (don't decrement — impl bead stays open)
  - maxRetries: `2`
  - trackingMethod: `"retryFeedback"`
- [ ] 1.2 Add escalation options: `["Retry impl", "Skip build check", "Cancel pipeline"]`
- [ ] 1.3 Update `GATE_CONFIGS` count in `retry-engine.test.ts`

### Phase 2: Wire into conductor

- [ ] 2.1 In `onAgentCompleted` for `phase === "impl"`, after conform-gate and before the `implGateBlocked` check, add the build-gate:
  ```
  const stack = detectStack(pipeline.localPath);
  const buildResult = await runBuildValidation(pipeline.localPath, stack);
  if (!buildResult.passed) {
    runGate("build-gate", buildResult, summary, "retryFeedback", "gate:build:failed");
    implGateBlocked = true;
  }
  ```
- [ ] 2.2 Create `runBuildValidation(cwd, stack)` in `stack-detection.ts`:
  - Runs `stack.typecheckCommand` first (fast, catches most errors)
  - Runs `stack.buildCommands` (slower, catches bundling/asset issues)
  - Runs `stack.conventionChecks` (fast, file-system only)
  - Returns `{ passed, reason, missing, context }` matching the gate result shape
  - Each command gets a 60s timeout (build commands can be slow)
  - Captures stderr/stdout for the retry feedback context
- [ ] 2.3 Cache `detectStack` result on the pipeline context — don't re-detect on every retry. Add `stackInfo` to `PipelineContext` in conductor.ts.

### Phase 3: Context injection into agents

- [ ] 3.1 In `buildContextSection` for `role === "test"`, inject `stack.testingGuidance` as a `<stack_context>` block. The test writer learns what testing libraries to use.
- [ ] 3.2 In `buildContextSection` for `role === "impl"`, inject a `<build_requirements>` block listing what commands the build-gate will run. The impl agent knows what "done" means.
- [ ] 3.3 In the brainstorm context (`brainstorm-context.ts`), inject detected framework so the architect knows the stack context.
- [ ] 3.4 In the ship phase context, inject `stack.framework` so the ship agent knows what deployment docs to produce.

### Phase 4: Tests

- [ ] 4.1 Unit tests for `detectStack` — each framework detection, fallback, monorepo, package.json scripts override
- [ ] 4.2 Unit tests for `runBuildValidation` — typecheck pass/fail, build pass/fail, convention pass/fail, timeout handling
- [ ] 4.3 Unit tests for convention checks — expo default exports, nextjs page exports, missing deps
- [ ] 4.4 Update conductor tests — build-gate wired after conform-gate, retry feedback includes build errors
- [ ] 4.5 Update retry-engine test — gate count, build-gate config assertions

### Phase 5: Fallback prompt updates

- [ ] 5.1 Update `fallback-prompts/test-writer.md` — add `{stackGuidance}` placeholder, replaced with detected testing guidance
- [ ] 5.2 Update `fallback-prompts/work.md` — add `{buildRequirements}` placeholder, replaced with "before finishing, run: ..."
- [ ] 5.3 Update `role-context.ts` — pass stack guidance through `writeRoleClaudeMd` for skill-mode agents

## Decision Rationale

**Why a gate, not more tests?**
Build validation (`expo export`, `next build`) is a build check, not a test. Making the test writer produce `expect(module.default).toBeDefined()` is roundabout when you can just run `expo export` and get a precise error message. Convention checks are similarly better as direct file-system checks than test assertions.

**Why after impl, not after merge?**
Build failures are impl's responsibility. Running build checks at merge means the fix requires reopening impl + redteam + merge — 3 phases instead of 0. Catching it at impl means zero bead decrement, same agent retries immediately.

**Why detect from files, not configuration?**
Following the Vercel/Netlify pattern — config files are the most reliable signal. `package.json` deps are the fallback. User configuration via `hog init` is the escape hatch but shouldn't be required. The goal is zero-config for common stacks.

**Why cache stack detection on the pipeline?**
`detectStack` reads the filesystem and parses `package.json`. Running it on every retry is wasteful. The stack doesn't change during a pipeline run.

**Why `package.json` scripts override framework defaults?**
A project with `"build": "turbo run build"` knows better than our generic `next build` detection. Respect the user's configured commands.

**Why convention checks are separate from build commands?**
Convention checks (grep for default exports) are fast (milliseconds) and can run even when build tools aren't installed. Build commands are slow (seconds-minutes) and require the tool. Running conventions first means faster feedback on the easy catches.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Build command hangs or takes too long | Medium | Medium | 60s timeout per command, total 3min cap |
| False positive convention check | Medium | Low | Convention checks are grep-based, easy to debug. "Skip build check" escalation option. |
| Framework detection wrong (e.g., detects Next.js in an Expo project) | Low | Medium | Config file detection is high-confidence. Fallback to `package.json` scripts if present. |
| Monorepo: build command runs wrong workspace | Medium | Medium | Scope to `pipeline.context.workingDir` if set. Default to cwd. |
| Build commands not available (`expo` not installed) | Medium | Low | `isAvailable` check before running. Skip gracefully with a warning log. |
| Retry feedback too verbose (build output is long) | Medium | Low | Cap context at 1500 chars (existing pattern). Extract the first error, not the full log. |

## Acceptance Criteria

1. **Expo project detected.** `detectStack` returns `framework: "expo"` when `app.json` has `expo` key.
2. **Build gate catches missing default export.** Expo convention check finds route files without `export default` and reopens impl with the file list.
3. **Build gate catches type errors.** `tsc --noEmit` failure reopens impl with the TypeScript error output.
4. **Test writer gets stack context.** Test agent for an Expo project receives guidance to use `@testing-library/react-native`.
5. **Impl agent knows build requirements.** Impl agent receives "before finishing, verify: tsc, expo export" in its context.
6. **Zero-config for common stacks.** No `hog init` changes required — detection is automatic.
7. **Graceful fallback.** Projects without a detected framework skip the build gate silently.
8. **Retry works.** Failed build gate injects structured feedback, impl agent fixes the issue, build gate passes on retry.
