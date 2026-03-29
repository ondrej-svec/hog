/**
 * Safety Rules — deny rules for Claude Code agents.
 *
 * These are written to .claude/settings.json in the project directory.
 * Deny rules ALWAYS win — even in bypassPermissions mode. They can't
 * be overridden by the agent.
 *
 * The deny list blocks destructive operations. The allow list is empty —
 * agents can do anything NOT on the deny list.
 */

/** Dangerous bash patterns that agents should never execute. */
export const DENY_RULES: readonly string[] = [
  // Destructive file operations
  "Bash(rm -rf /*)",
  "Bash(rm -rf ~*)",
  "Bash(rm -rf ./*)",
  "Bash(rm -rf .)",
  "Bash(rm -rf ../*)",
  // Dangerous git operations
  "Bash(git push --force*)",
  "Bash(git push * --force*)",
  "Bash(git push -f*)",
  "Bash(git push * -f *)",
  "Bash(git reset --hard*)",
  "Bash(git clean -fd*)",
  "Bash(git checkout -- .)",
  // Privilege escalation
  "Bash(sudo *)",
  "Bash(su *)",
  "Bash(doas *)",
  // Remote code execution
  "Bash(curl * | sh*)",
  "Bash(curl * | bash*)",
  "Bash(wget * | sh*)",
  "Bash(wget * | bash*)",
  // Credential/secret exposure
  "Bash(cat */.ssh/*)",
  "Bash(cat */.aws/*)",
  "Bash(cat */.env.prod*)",
  "Bash(printenv *SECRET*)",
  "Bash(printenv *TOKEN*)",
  "Bash(printenv *PASSWORD*)",
  // System modification
  "Bash(chmod 777 *)",
  "Bash(chown *)",
  "Bash(mkfs *)",
  "Bash(dd *)",
  // Process/system control
  "Bash(kill -9 *)",
  "Bash(killall *)",
  "Bash(shutdown *)",
  "Bash(reboot *)",
];

/** Settings.json structure for Claude Code project-level deny rules. */
export interface ClaudeSettings {
  permissions?: {
    deny?: string[];
    allow?: string[];
  };
}

/**
 * Generate a .claude/settings.json with deny rules.
 * Merges with existing settings if present.
 */
export function buildClaudeSettings(existing?: ClaudeSettings): ClaudeSettings {
  const existingDeny = existing?.permissions?.deny ?? [];
  const existingAllow = existing?.permissions?.allow ?? [];

  // Merge: keep existing rules, add ours (deduplicated)
  const mergedDeny = [...new Set([...existingDeny, ...DENY_RULES])];

  return {
    ...existing,
    permissions: {
      deny: mergedDeny,
      ...(existingAllow.length > 0 ? { allow: existingAllow } : {}),
    },
  };
}

/**
 * Write deny rules to a project's .claude/settings.json.
 * Creates the file if it doesn't exist, merges if it does.
 */
export async function writeSafetyRules(projectPath: string): Promise<void> {
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") return;
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const claudeDir = join(projectPath, ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  // Read existing settings if present
  let existing: ClaudeSettings | undefined;
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
    } catch {
      // Malformed — we'll overwrite
    }
  }

  const settings = buildClaudeSettings(existing);

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}
