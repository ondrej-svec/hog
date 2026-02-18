---
status: pending
priority: p3
issue_id: "013"
tags: [code-review, agent-native, feature]
---

# Agent-native gap: NL issue creation has no CLI entry point

## Problem Statement

PR #12 introduces a sophisticated NL parser (`src/ai.ts`) accessible only via the TUI's `I` key. Agents/scripts cannot invoke NL issue creation programmatically without an interactive terminal session. The `src/ai.ts` module is already designed as a top-level utility (not board-specific), but has no CLI surface.

## Findings

- **Source:** Agent-native reviewer
- `src/ai.ts` exports `extractIssueFields`, `parseHeuristic`, `hasLlmApiKey` — all CLI-ready
- No `hog issue create` or `hog nl` subcommand exists
- Agents must fall back to `gh issue create` directly (bypasses hog's parsing layer)

**Parity matrix:**

| Feature | TUI | Agent/Script |
|---------|:---:|:---:|
| NL issue creation (I) | ✅ | ❌ |
| Label picker (l) | ✅ | ❌ (use `gh issue edit` directly) |
| Comment (c) | ✅ | ✅ (`gh issue comment`) |
| Copy URL (y) | ✅ | N/A |

## Proposed Solution

Add a `hog issue create <text>` subcommand to `src/cli.ts`:

```typescript
program
  .command("issue")
  .description("GitHub issue utilities")
  .addCommand(
    new Command("create")
      .description("Create issue from natural language text")
      .argument("<text>", "Natural language description")
      .option("--repo <repo>", "Target repository (owner/name)")
      .action(async (text, opts) => {
        const config = loadConfig();
        const repo = opts.repo ?? config.repos[0]?.name;
        if (!repo) { console.error("No repo specified"); process.exit(1); }

        const parsed = await extractIssueFields(text, {
          onLlmFallback: (msg) => console.warn(`[warn] ${msg}`),
        });
        if (!parsed) { console.error("Could not parse title"); process.exit(1); }

        const labels = [...parsed.labels];
        if (parsed.dueDate) labels.push(`due:${parsed.dueDate}`);

        const args = ["issue", "create", "--repo", repo, "--title", parsed.title];
        for (const l of labels) args.push("--label", l);

        execFileSync("gh", args, { stdio: "inherit" });
      })
  );
```

## Acceptance Criteria

- [ ] `hog issue create "fix login bug #bug @me due friday" --repo owner/repo` works
- [ ] Parsed fields are shown before creation (or use `--dry-run` flag)
- [ ] Output compatible with `--json` flag for agent consumption

## Work Log

- 2026-02-18: Identified by Agent-native reviewer
