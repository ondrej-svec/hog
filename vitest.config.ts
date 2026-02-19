import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/cli.ts",
        "src/board/fetch-worker.ts",
        // dashboard.tsx is the main 1250-line orchestrator; its logic is covered by hook/component tests
        "src/board/components/dashboard.tsx",
        // edit-issue-overlay.tsx launches $EDITOR synchronously on mount; impractical to unit test
        "src/board/components/edit-issue-overlay.tsx",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    typecheck: {
      enabled: true,
    },
  },
});
