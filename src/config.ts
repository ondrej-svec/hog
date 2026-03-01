import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";

export const CONFIG_DIR = join(homedir(), ".config", "hog");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const AUTH_SCHEMA = z.object({
  openrouterApiKey: z.string().optional(),
});

type AuthData = z.infer<typeof AUTH_SCHEMA>;

// ── Config Schema (Zod) ──

const COMPLETION_ACTION_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updateProjectStatus"), optionId: z.string() }),
  z.object({ type: z.literal("closeIssue") }),
  z.object({ type: z.literal("addLabel"), label: z.string() }),
]);

const REPO_NAME_PATTERN = /^[\w.-]+\/[\w.-]+$/;

const CLAUDE_START_COMMAND_SCHEMA = z.object({
  command: z.string().min(1),
  extraArgs: z.array(z.string()),
});

const AUTO_STATUS_SCHEMA = z
  .object({
    enabled: z.boolean().default(false),
    triggers: z
      .object({
        branchCreated: z.string().optional(),
        prOpened: z.string().optional(),
        prMerged: z.string().optional(),
        branchPattern: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const WORKFLOW_CONFIG_SCHEMA = z
  .object({
    mode: z.enum(["suggested", "freeform"]).default("suggested"),
    phases: z.array(z.string()).default(["brainstorm", "plan", "implement", "review"]),
    phasePrompts: z.record(z.string(), z.string()).optional(),
    phaseDefaults: z
      .record(
        z.string(),
        z.object({
          mode: z.enum(["interactive", "background", "either"]).default("either"),
          allowedTools: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  })
  .optional();

const REPO_CONFIG_SCHEMA = z.object({
  name: z.string().regex(REPO_NAME_PATTERN, "Must be owner/repo format"),
  shortName: z.string().min(1),
  projectNumber: z.number().int().positive(),
  statusFieldId: z.string().min(1),
  dueDateFieldId: z.string().optional(),
  completionAction: COMPLETION_ACTION_SCHEMA,
  statusGroups: z.array(z.string()).optional(),
  localPath: z
    .string()
    .refine((p) => isAbsolute(p), { message: "localPath must be an absolute path" })
    .refine((p) => normalize(p) === p, {
      message: "localPath must be normalized (no .. segments)",
    })
    .refine((p) => !p.includes("\0"), { message: "localPath must not contain null bytes" })
    .optional(),
  claudeStartCommand: CLAUDE_START_COMMAND_SCHEMA.optional(),
  claudePrompt: z.string().optional(),
  workflow: WORKFLOW_CONFIG_SCHEMA,
  autoStatus: AUTO_STATUS_SCHEMA,
});

const BOARD_CONFIG_SCHEMA = z.object({
  refreshInterval: z.number().int().min(10).default(60),
  backlogLimit: z.number().int().min(1).default(20),
  assignee: z.string().min(1),
  focusDuration: z.number().int().min(60).default(1500),
  claudeStartCommand: CLAUDE_START_COMMAND_SCHEMA.optional(),
  claudePrompt: z.string().optional(),
  claudeLaunchMode: z.enum(["auto", "tmux", "terminal"]).optional(),
  claudeTerminalApp: z
    .enum(["Terminal", "iTerm", "Ghostty", "WezTerm", "Kitty", "Alacritty"])
    .optional(),
  workflow: z
    .object({
      defaultMode: z.enum(["suggested", "freeform"]).default("suggested"),
      defaultPhases: z
        .array(z.string())
        .default(["brainstorm", "plan", "implement", "review"]),
      phasePrompts: z.record(z.string(), z.string()).optional(),
      staleness: z
        .object({
          warningDays: z.number().default(7),
          criticalDays: z.number().default(14),
        })
        .optional(),
      maxConcurrentAgents: z.number().default(3),
      notifications: z
        .object({
          os: z.boolean().default(false),
          sound: z.boolean().default(false),
        })
        .optional(),
    })
    .optional(),
});

const PROFILE_SCHEMA = z.object({
  repos: z.array(REPO_CONFIG_SCHEMA).default([]),
  board: BOARD_CONFIG_SCHEMA,
});

const HOG_CONFIG_SCHEMA = z.object({
  version: z.number().int().default(4),
  repos: z.array(REPO_CONFIG_SCHEMA).default([]),
  board: BOARD_CONFIG_SCHEMA,
  profiles: z.record(z.string(), PROFILE_SCHEMA).default({}),
  defaultProfile: z.string().optional(),
});

export type CompletionAction = z.infer<typeof COMPLETION_ACTION_SCHEMA>;
export type RepoConfig = z.infer<typeof REPO_CONFIG_SCHEMA>;
export type BoardConfig = z.infer<typeof BOARD_CONFIG_SCHEMA>;
export type ProfileConfig = z.infer<typeof PROFILE_SCHEMA>;
export type HogConfig = z.infer<typeof HOG_CONFIG_SCHEMA>;

// ── Config Migration ──

function migrateConfig(raw: Record<string, unknown>): HogConfig {
  const version = typeof raw["version"] === "number" ? raw["version"] : 1;

  if (version < 2) {
    // v1 → v2: Add repos and board config from legacy defaults
    raw = {
      ...raw,
      version: 2,
      repos: [],
      board: {
        refreshInterval: 60,
        backlogLimit: 20,
        assignee: "unknown",
      },
    };
  }

  const v2Version = typeof raw["version"] === "number" ? raw["version"] : 2;
  if (v2Version < 3) {
    raw = { ...raw, version: 3 };
  }

  const v3Version = typeof raw["version"] === "number" ? raw["version"] : 3;
  if (v3Version < 4) {
    // v3 → v4: Remove TickTick fields, add workflow schema fields
    const { ticktick: _, defaultProjectId: _dpid, defaultProjectName: _dpn, ...rest } = raw;
    raw = { ...rest, version: 4 };

    // Clean up auth.json: remove TickTick OAuth fields
    if (existsSync(AUTH_FILE)) {
      try {
        const authRaw = JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as Record<string, unknown>;
        const { accessToken: _at, clientId: _ci, clientSecret: _cs, ...authRest } = authRaw;
        if (Object.keys(authRest).length > 0) {
          writeFileSync(AUTH_FILE, `${JSON.stringify(authRest, null, 2)}\n`, { mode: 0o600 });
        }
      } catch {
        // Ignore auth.json parse errors during migration
      }
    }
  }

  return HOG_CONFIG_SCHEMA.parse(raw);
}

// ── Config Access ──

export function loadFullConfig(): HogConfig {
  const raw = loadRawConfig();

  if (Object.keys(raw).length === 0) {
    // No config exists — create from legacy defaults
    const config = migrateConfig({});
    saveFullConfig(config);
    return config;
  }

  const version = typeof raw["version"] === "number" ? raw["version"] : 1;
  if (version < 4) {
    const migrated = migrateConfig(raw);
    saveFullConfig(migrated);
    return migrated;
  }

  return HOG_CONFIG_SCHEMA.parse(raw);
}

export function saveFullConfig(config: HogConfig): void {
  ensureDir();
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function loadRawConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Resolve a profile from the config.
 * Priority: explicit profileName > config.defaultProfile > top-level config.
 * Returns a HogConfig with the resolved profile's repos/board.
 */
export function resolveProfile(
  config: HogConfig,
  profileName?: string | undefined,
): { resolved: HogConfig; activeProfile: string | null } {
  const name = profileName ?? config.defaultProfile;

  if (!name) {
    return { resolved: config, activeProfile: null };
  }

  const profile = config.profiles[name];
  if (!profile) {
    console.error(
      `Profile "${name}" not found. Available: ${Object.keys(config.profiles).join(", ") || "(none)"}`,
    );
    process.exit(1);
  }

  return {
    resolved: { ...config, repos: profile.repos, board: profile.board },
    activeProfile: name,
  };
}

export function findRepo(config: HogConfig, shortNameOrFull: string): RepoConfig | undefined {
  return config.repos.find((r) => r.shortName === shortNameOrFull || r.name === shortNameOrFull);
}

export function validateRepoName(name: string): boolean {
  return REPO_NAME_PATTERN.test(name);
}

// ── Auth Access ──

function ensureDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadAuth(): AuthData {
  if (!existsSync(AUTH_FILE)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
    const result = AUTH_SCHEMA.safeParse(raw);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

function saveAuth(data: AuthData): void {
  ensureDir();
  writeFileSync(AUTH_FILE, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function getLlmAuth(): { provider: "openrouter"; apiKey: string } | null {
  const auth = loadAuth();
  if (auth.openrouterApiKey) return { provider: "openrouter", apiKey: auth.openrouterApiKey };
  return null;
}

export function saveLlmAuth(openrouterApiKey: string): void {
  const existing = loadAuth();
  saveAuth({ ...existing, openrouterApiKey });
}

export function clearLlmAuth(): void {
  const existing = loadAuth();
  const { openrouterApiKey: _, ...rest } = existing;
  saveAuth(rest);
}
