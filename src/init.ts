import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { exchangeCodeForToken, getAuthorizationUrl, waitForAuthCode } from "./auth.js";
import type { CompletionAction, HogConfig, RepoConfig } from "./config.js";
import { CONFIG_DIR, loadFullConfig, saveAuth, saveFullConfig } from "./config.js";

// ── gh CLI helpers ──

function ghJson<T>(args: string[]): T {
  const output = execFileSync("gh", args, { encoding: "utf-8", timeout: 30_000 }).trim();
  return JSON.parse(output) as T;
}

function isGhAuthenticated(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { encoding: "utf-8", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function getGitHubLogin(): string {
  const user = ghJson<{ login: string }>(["api", "user"]);
  return user.login;
}

interface GhRepo {
  nameWithOwner: string;
  name: string;
  owner: { login: string };
}

function listRepos(): GhRepo[] {
  return ghJson<GhRepo[]>(["repo", "list", "--json", "nameWithOwner,name,owner", "--limit", "100"]);
}

interface GhProject {
  number: number;
  title: string;
}

function listOrgProjects(owner: string): GhProject[] {
  try {
    return ghJson<GhProject[]>(["project", "list", "--owner", owner, "--format", "json"]);
  } catch {
    return [];
  }
}

interface GhProjectField {
  id: string;
  name: string;
  type: string;
}

function listProjectFields(owner: string, projectNumber: number): GhProjectField[] {
  try {
    return ghJson<GhProjectField[]>([
      "project",
      "field-list",
      String(projectNumber),
      "--owner",
      owner,
      "--format",
      "json",
    ]);
  } catch {
    return [];
  }
}

function detectStatusFieldId(owner: string, projectNumber: number): string | null {
  const fields = listProjectFields(owner, projectNumber);
  const statusField = fields.find(
    (f) => f.name === "Status" && f.type === "ProjectV2SingleSelectField",
  );
  return statusField?.id ?? null;
}

// ── Wizard ──

export interface InitOptions {
  force?: boolean;
}

export async function runInit(opts: InitOptions = {}): Promise<void> {
  // Ctrl+C handling: inquirer throws on cancel, we catch at the top level
  try {
    await runWizard(opts);
  } catch (error) {
    if (error instanceof Error && error.message.includes("User force closed")) {
      console.log("\nSetup cancelled. No changes were made.");
      return;
    }
    throw error;
  }
}

async function runWizard(opts: InitOptions): Promise<void> {
  console.log("\n🐗 hog init — Setup Wizard\n");

  // Step 1: Check existing config
  const configExists = existsSync(`${CONFIG_DIR}/config.json`);
  if (configExists && !opts.force) {
    const overwrite = await confirm({
      message: "Config already exists. Overwrite?",
      default: false,
    });
    if (!overwrite) {
      console.log("Setup cancelled.");
      return;
    }
  }

  // Step 2: Check gh CLI auth
  console.log("Checking GitHub CLI authentication...");
  if (!isGhAuthenticated()) {
    console.error(
      "\nGitHub CLI is not authenticated. Run:\n\n  gh auth login\n\nThen re-run `hog init`.",
    );
    process.exit(1);
  }
  console.log("  GitHub CLI authenticated.\n");

  // Step 3: Detect GitHub user
  const login = getGitHubLogin();
  console.log(`  Detected GitHub user: ${login}\n`);

  // Step 4: Select repos
  const allRepos = listRepos();
  if (allRepos.length === 0) {
    console.error("No repositories found. Check your GitHub CLI access.");
    process.exit(1);
  }

  const selectedRepoNames = await checkbox<string>({
    message: "Select repositories to track:",
    choices: allRepos.map((r) => ({
      name: r.nameWithOwner,
      value: r.nameWithOwner,
    })),
  });

  if (selectedRepoNames.length === 0) {
    console.log("No repos selected. You can add repos later with `hog config repos:add`.");
  }

  // Step 5: Configure each repo (project, status field, completion action)
  const repos: RepoConfig[] = [];
  for (const repoName of selectedRepoNames) {
    console.log(`\nConfiguring ${repoName}...`);
    const [owner, name] = repoName.split("/") as [string, string];

    // Detect projects
    const projects = listOrgProjects(owner);
    let projectNumber: number;
    if (projects.length === 0) {
      console.log("  No GitHub Projects found. Enter project number manually.");
      const num = await input({ message: `  Project number for ${repoName}:` });
      projectNumber = Number.parseInt(num, 10);
    } else {
      projectNumber = await select<number>({
        message: `  Select project for ${repoName}:`,
        choices: projects.map((p) => ({
          name: `#${p.number} — ${p.title}`,
          value: p.number,
        })),
      });
    }

    // Auto-detect status field
    console.log("  Detecting status field...");
    let statusFieldId = detectStatusFieldId(owner, projectNumber);
    if (statusFieldId) {
      console.log(`  Found status field: ${statusFieldId}`);
    } else {
      console.log("  Could not auto-detect status field.");
      statusFieldId = await input({
        message: "  Enter status field ID manually:",
      });
    }

    // Completion action
    const completionType = await select<CompletionAction["type"]>({
      message: `  When a task is completed in TickTick, what should happen on GitHub?`,
      choices: [
        { name: "Close the issue", value: "closeIssue" as const },
        { name: "Add a label (e.g. review:pending)", value: "addLabel" as const },
        { name: "Update project status column", value: "updateProjectStatus" as const },
      ],
    });

    let completionAction: CompletionAction;
    if (completionType === "addLabel") {
      const label = await input({
        message: "  Label to add:",
        default: "review:pending",
      });
      completionAction = { type: "addLabel", label };
    } else if (completionType === "updateProjectStatus") {
      const optionId = await input({
        message: "  Status option ID to set:",
      });
      completionAction = { type: "updateProjectStatus", optionId };
    } else {
      completionAction = { type: "closeIssue" };
    }

    // Short name
    const shortName = await input({
      message: `  Short name for ${repoName}:`,
      default: name,
    });

    repos.push({
      name: repoName,
      shortName,
      projectNumber,
      statusFieldId,
      completionAction,
    });
  }

  // Step 6: TickTick integration
  const enableTickTick = await confirm({
    message: "Enable TickTick integration?",
    default: false,
  });

  let ticktickAuth = false;
  if (enableTickTick) {
    const hasAuth = existsSync(`${CONFIG_DIR}/auth.json`);
    if (hasAuth) {
      console.log("  TickTick auth already configured.");
      ticktickAuth = true;
    } else {
      const setupNow = await confirm({
        message: "  Set up TickTick OAuth now?",
        default: true,
      });
      if (setupNow) {
        const clientId = await input({ message: "  TickTick OAuth client ID:" });
        const clientSecret = await input({ message: "  TickTick OAuth client secret:" });
        const url = getAuthorizationUrl(clientId);
        console.log(`\n  Open this URL to authorize:\n\n    ${url}\n`);
        try {
          const { exec } = await import("node:child_process");
          exec(`open "${url}"`);
        } catch {
          // User opens manually
        }
        console.log("  Waiting for authorization...");
        const code = await waitForAuthCode();
        const accessToken = await exchangeCodeForToken(clientId, clientSecret, code);
        saveAuth({ accessToken, clientId, clientSecret });
        console.log("  TickTick authenticated successfully.");
        ticktickAuth = true;
      }
    }
  }

  // Step 7: Board defaults
  console.log("\nBoard settings:");
  const refreshInterval = await input({
    message: "  Refresh interval (seconds):",
    default: "60",
  });
  const backlogLimit = await input({
    message: "  Backlog limit (max issues per repo):",
    default: "20",
  });
  const focusDuration = await input({
    message: "  Focus timer duration (seconds):",
    default: "1500",
  });

  // Step 8: Build and write config
  const existingConfig = configExists ? loadFullConfig() : undefined;
  const config: HogConfig = {
    version: 3,
    defaultProjectId: existingConfig?.defaultProjectId,
    defaultProjectName: existingConfig?.defaultProjectName,
    repos,
    board: {
      refreshInterval: Number.parseInt(refreshInterval, 10) || 60,
      backlogLimit: Number.parseInt(backlogLimit, 10) || 20,
      assignee: login,
      focusDuration: Number.parseInt(focusDuration, 10) || 1500,
    },
    ticktick: { enabled: enableTickTick && ticktickAuth },
    profiles: existingConfig?.profiles ?? {},
  };

  saveFullConfig(config);
  console.log(`\nConfig written to ${CONFIG_DIR}/config.json`);
  console.log("\nSetup complete! Try:\n");
  console.log("  hog board --live    # Interactive dashboard");
  console.log("  hog task list       # List TickTick tasks");
  console.log("  hog config show     # View configuration\n");
}
