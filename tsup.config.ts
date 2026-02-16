import { defineConfig } from "tsup";

const shared = {
  format: "esm" as const,
  target: "node22" as const,
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  // Keep heavy dependencies external — they stay in node_modules
  external: [
    "ink",
    "react",
    "@inkjs/ui",
    "zod",
    "commander",
    "@inquirer/prompts",
    "chalk",
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: { cli: "src/cli.ts" },
    banner: { js: "#!/usr/bin/env node" },
    clean: true,
  },
  {
    ...shared,
    entry: { "fetch-worker": "src/board/fetch-worker.ts" },
    clean: false, // Don't wipe cli.js from the first build
  },
]);
