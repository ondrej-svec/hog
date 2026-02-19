---
review_agents:
  - compound-engineering:review:kieran-typescript-reviewer
  - compound-engineering:review:security-sentinel
  - compound-engineering:review:performance-oracle
  - compound-engineering:review:architecture-strategist
  - compound-engineering:review:code-simplicity-reviewer
  - compound-engineering:review:pattern-recognition-specialist
---

# hog Review Context

This is a TypeScript/Node.js CLI tool using Ink (React-for-CLIs) for TUI rendering.

## Key Conventions

- **Biome** for linting/formatting (not ESLint/Prettier). Filenames must be kebab-case. `noExplicitAny` is an error.
- **TypeScript strict mode**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Use `import type` for type-only imports.
- **GitHub data** always via `execFileSync("gh", ...)` — never REST/GraphQL directly.
- **Ink overlays**: each overlay registers its own `useInput`. Main keyboard handler is inactive during overlays.
- **biome-ignore** comments used sparingly for: cognitive complexity (complex reducers), exhaustive-deps (stable ref signals).
- **80% test coverage** threshold enforced on statements/branches/functions/lines.

## Review Focus Areas

When reviewing this codebase, pay special attention to:
1. Test coverage for new hooks and components
2. UX patterns — key bindings must not conflict, hint bar must be accurate
3. CLI command DX — error messages must be actionable, --dry-run must work
4. $EDITOR integration — terminal state restoration in finally blocks
5. Async error handling — each gh call should fail gracefully
6. Ink-specific patterns — useInput, useApp, stdin rawMode
