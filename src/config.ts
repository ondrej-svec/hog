import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const CONFIG_DIR = join(homedir(), ".config", "hog");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface AuthData {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  openrouterApiKey?: string;
}

// ── Config Schema (Zod) ──

const COMPLETION_ACTION_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updateProjectStatus"), optionId: z.string() }),
  z.object({ type: z.literal("closeIssue") }),
  z.object({ type: z.literal("addLabel"), label: z.string() }),
]);

const REPO_NAME_PATTERN = /^[\w.-]+\/[\w.-]+$/;

const REPO_CONFIG_SCHEMA = z.object({
  name: z.string().regex(REPO_NAME_PATTERN, "Must be owner/repo format"),
  shortName: z.string().min(1),
  projectNumber: z.number().int().positive(),
  statusFieldId: z.string().min(1),
  completionAction: COMPLETION_ACTION_SCHEMA,
  statusGroups: z.array(z.string()).optional(),
});

const BOARD_CONFIG_SCHEMA = z.object({
  refreshInterval: z.number().int().min(10).default(60),
  backlogLimit: z.number().int().min(1).default(20),
  assignee: z.string().min(1),
  focusDuration: z.number().int().min(60).default(1500),
});

const TICKTICK_CONFIG_SCHEMA = z.object({
  enabled: z.boolean().default(true),
});

const PROFILE_SCHEMA = z.object({
  repos: z.array(REPO_CONFIG_SCHEMA).default([]),
  board: BOARD_CONFIG_SCHEMA,
  ticktick: TICKTICK_CONFIG_SCHEMA.default({ enabled: true }),
});

const HOG_CONFIG_SCHEMA = z.object({
  version: z.number().int().default(3),
  defaultProjectId: z.string().optional(),
  defaultProjectName: z.string().optional(),
  repos: z.array(REPO_CONFIG_SCHEMA).default([]),
  board: BOARD_CONFIG_SCHEMA,
  ticktick: TICKTICK_CONFIG_SCHEMA.default({ enabled: true }),
  profiles: z.record(z.string(), PROFILE_SCHEMA).default({}),
  defaultProfile: z.string().optional(),
});

export type CompletionAction = z.infer<typeof COMPLETION_ACTION_SCHEMA>;
export type RepoConfig = z.infer<typeof REPO_CONFIG_SCHEMA>;
export type BoardConfig = z.infer<typeof BOARD_CONFIG_SCHEMA>;
export type ProfileConfig = z.infer<typeof PROFILE_SCHEMA>;
export type HogConfig = z.infer<typeof HOG_CONFIG_SCHEMA>;

// ── Legacy Repo Defaults (for migration) ──

const LEGACY_REPOS: RepoConfig[] = [];

// ── Config Migration ──

function migrateConfig(raw: Record<string, unknown>): HogConfig {
  const version = typeof raw["version"] === "number" ? raw["version"] : 1;

  if (version < 2) {
    // v1 → v2: Add repos and board config from legacy defaults
    raw = {
      ...raw,
      version: 2,
      repos: LEGACY_REPOS,
      board: {
        refreshInterval: 60,
        backlogLimit: 20,
        assignee: "unknown",
      },
    };
  }

  const currentVersion = typeof raw["version"] === "number" ? raw["version"] : 2;
  if (currentVersion < 3) {
    // v2 → v3: Add ticktick config, infer enabled from auth.json presence
    raw = {
      ...raw,
      version: 3,
      ticktick: { enabled: existsSync(AUTH_FILE) },
    };
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
  if (version < 3) {
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
 * Returns a HogConfig with the resolved profile's repos/board/ticktick.
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
    resolved: { ...config, repos: profile.repos, board: profile.board, ticktick: profile.ticktick },
    activeProfile: name,
  };
}

export function findRepo(config: HogConfig, shortNameOrFull: string): RepoConfig | undefined {
  return config.repos.find((r) => r.shortName === shortNameOrFull || r.name === shortNameOrFull);
}

export function validateRepoName(name: string): boolean {
  return REPO_NAME_PATTERN.test(name);
}

// ── Legacy Config Access (backward compat) ──

interface ConfigData {
  defaultProjectId?: string;
  defaultProjectName?: string;
}

function ensureDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

export function getAuth(): AuthData | null {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function saveAuth(data: AuthData): void {
  ensureDir();
  writeFileSync(AUTH_FILE, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function getLlmAuth(): { provider: "openrouter"; apiKey: string } | null {
  const auth = getAuth();
  if (auth?.openrouterApiKey) return { provider: "openrouter", apiKey: auth.openrouterApiKey };
  return null;
}

export function saveLlmAuth(openrouterApiKey: string): void {
  const existing = getAuth();
  const updated: AuthData = existing
    ? { ...existing, openrouterApiKey }
    : { accessToken: "", clientId: "", clientSecret: "", openrouterApiKey };
  saveAuth(updated);
}

export function clearLlmAuth(): void {
  const existing = getAuth();
  if (!existing) return;
  const { openrouterApiKey: _, ...rest } = existing;
  saveAuth(rest as AuthData);
}

export function getConfig(): ConfigData {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveConfig(data: ConfigData): void {
  ensureDir();
  const existing = getConfig();
  writeFileSync(CONFIG_FILE, `${JSON.stringify({ ...existing, ...data }, null, 2)}\n`);
}

export function requireAuth(): AuthData {
  const auth = getAuth();
  if (!auth) {
    console.error("Not authenticated. Run `hog init` first.");
    process.exit(1);
  }
  return auth;
}
