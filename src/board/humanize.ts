/**
 * Humanize raw tool names and agent data for cockpit display.
 *
 * H2G2 character mapping for pipeline roles:
 * - brainstorm → Zaphod (reckless visionary, two heads)
 * - stories → Ford (field researcher → structured documentation)
 * - test → Arthur (constrained craftsman, never has full picture)
 * - impl → Arthur (same — builds what he's told)
 * - redteam → Marvin (brain the size of a planet, sees every flaw)
 * - merge → Vogons (bureaucracy IS correctness)
 */

/** Map pipeline role to H2G2 character name. */
const ROLE_CHARACTERS: Record<string, string> = {
  brainstorm: "Zaphod",
  stories: "Ford",
  test: "Arthur",
  impl: "Arthur",
  redteam: "Marvin",
  merge: "Vogons",
};

/** Get the H2G2 character name for a pipeline role. */
export function roleCharacter(role: string): string {
  return ROLE_CHARACTERS[role] ?? role;
}

/** Convert raw tool use string to human-readable action. */
export function humanizeTool(raw: string | undefined): string {
  if (!raw) return "working...";

  // Parse "ToolName (detail)" format
  const match = raw.match(/^(\w+)\s*\((.+)\)$/);
  const tool = match?.[1] ?? raw;
  const detail = match?.[2] ?? "";

  // Extract just the filename from paths
  const file = shortenPath(detail);

  switch (tool) {
    case "Read":
      return file ? `reading ${file}` : "reading file";
    case "Edit":
    case "MultiEdit":
      return file ? `editing ${file}` : "editing file";
    case "Write":
      return file ? `creating ${file}` : "creating file";
    case "Grep":
      return detail ? `searching for "${detail}"` : "searching";
    case "Glob":
      return detail ? `finding ${detail}` : "finding files";
    case "Bash":
      return humanizeBash(detail);
    case "LS":
      return detail ? `listing ${detail}` : "listing directory";
    case "WebFetch":
      return detail ? `fetching ${shortenUrl(detail)}` : "fetching web page";
    case "WebSearch":
      return detail ? `searching web for "${detail}"` : "searching the web";
    case "TodoWrite":
      return "planning next steps";
    case "Agent":
      return "delegating to subagent";
    case "NotebookEdit":
      return "editing notebook";
    default:
      // Friendly fallback: lowercase the tool name
      if (raw.length > 40) return `${raw.slice(0, 37)}...`;
      return file ? `${tool.toLowerCase()} ${file}` : raw;
  }
}

function humanizeBash(cmd: string): string {
  if (!cmd || cmd.trim().length === 0) return "running command";

  // Order matters: install before test (uv pip install pytest matches both)
  if (cmd.match(/npm\s+install|pip\s+install|uv\s+(pip\s+)?install|brew\s+install/))
    return "installing dependencies";
  if (cmd.match(/npm\s+test|vitest|jest|pytest|cargo\s+test|go\s+test/)) return "running tests";
  if (cmd.match(/npm\s+run\s+build|cargo\s+build|go\s+build/)) return "building project";
  if (cmd.match(/npm\s+run\s+lint|biome|eslint|ruff/)) return "running linter";
  if (cmd.match(/git\s+commit/)) return "committing changes";
  if (cmd.match(/git\s+add/)) return "staging files";
  if (cmd.match(/git\s+diff/)) return "checking changes";
  if (cmd.match(/git\s+stash/)) return "stashing changes";
  if (cmd.match(/git\s+log/)) return "checking history";
  if (cmd.match(/^ls\b|^find\b/)) return "listing files";
  if (cmd.match(/^cat\b|^head\b|^tail\b/)) return "reading file";
  if (cmd.match(/^mkdir\b/)) return "creating directory";
  if (cmd.match(/chmod/)) return "setting permissions";
  if (cmd.match(/uv\s+run/)) return "running script";

  // Truncate long commands
  return cmd.length > 50 ? `${cmd.slice(0, 47)}...` : cmd;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 30) : "");
  } catch {
    return url.length > 40 ? `${url.slice(0, 37)}...` : url;
  }
}

function shortenPath(path: string): string {
  if (!path) return "";
  // Remove line numbers (file.ts:142)
  const clean = path.replace(/:\d+$/, "");
  // Last path segment only
  const parts = clean.split("/");
  return parts[parts.length - 1] ?? clean;
}

/** Generate a short agent name from a session ID (deterministic hash). */
const AGENT_NAMES = [
  "Ada",
  "Bea",
  "Cal",
  "Dev",
  "Eve",
  "Fin",
  "Gia",
  "Hal",
  "Ivy",
  "Jay",
  "Kit",
  "Lea",
  "Max",
  "Nia",
  "Oz",
  "Pia",
];

const sessionNameCache = new Map<string, string>();
const usedNames = new Set<string>();

export function agentName(sessionId: string): string {
  const cached = sessionNameCache.get(sessionId);
  if (cached) return cached;

  // Deterministic: hash the session ID to pick a name
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0;
  }
  const baseIdx = Math.abs(hash) % AGENT_NAMES.length;
  let name = AGENT_NAMES[baseIdx]!;

  // Handle collisions with suffix
  if (usedNames.has(name)) {
    let suffix = 2;
    while (usedNames.has(`${name}${suffix}`)) suffix++;
    name = `${name}${suffix}`;
  }

  usedNames.add(name);
  sessionNameCache.set(sessionId, name);
  return name;
}

/** Reset name cache (for tests or new pipeline). */
export function resetAgentNames(): void {
  sessionNameCache.clear();
  usedNames.clear();
}

/** Format elapsed minutes nicely. */
export function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

/** Format a timestamp to HH:MM. */
export function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Format relative time as "Xm ago". */
export function timeAgo(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}
