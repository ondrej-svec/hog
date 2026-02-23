import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import type { CompletionAction, HogConfig, RepoConfig } from "./config.js";
import {
  CONFIG_DIR,
  findRepo,
  loadFullConfig,
  saveFullConfig,
  saveLlmAuth,
  validateRepoName,
} from "./config.js";

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

function listUserOrgs(): string[] {
  try {
    const orgs = ghJson<{ login: string }[]>(["api", "user/orgs"]);
    return orgs.map((o) => o.login);
  } catch {
    return [];
  }
}

function listReposForOwner(owner?: string): GhRepo[] {
  const args = [
    "repo",
    "list",
    ...(owner ? [owner] : []),
    "--json",
    "nameWithOwner,name,owner",
    "--limit",
    "100",
  ];
  try {
    return ghJson<GhRepo[]>(args);
  } catch {
    return [];
  }
}

function listAllRepos(): GhRepo[] {
  const orgs = listUserOrgs();
  const personal = listReposForOwner();
  const orgRepos = orgs.flatMap((org) => listReposForOwner(org));
  const all = [...personal, ...orgRepos];
  // Deduplicate by nameWithOwner
  const seen = new Set<string>();
  return all.filter((r) => {
    if (seen.has(r.nameWithOwner)) return false;
    seen.add(r.nameWithOwner);
    return true;
  });
}

interface GhProject {
  number: number;
  title: string;
}

function listOrgProjects(owner: string): GhProject[] {
  try {
    const result = ghJson<{ projects: GhProject[] }>([
      "project",
      "list",
      "--owner",
      owner,
      "--format",
      "json",
    ]);
    return result.projects ?? [];
  } catch {
    return [];
  }
}

interface GhProjectFieldOption {
  id: string;
  name: string;
}

interface GhProjectField {
  id: string;
  name: string;
  type: string;
  options?: GhProjectFieldOption[];
}

function listProjectFields(owner: string, projectNumber: number): GhProjectField[] {
  try {
    const result = ghJson<{ fields: GhProjectField[] }>([
      "project",
      "field-list",
      String(projectNumber),
      "--owner",
      owner,
      "--format",
      "json",
    ]);
    return result.fields ?? [];
  } catch {
    return [];
  }
}

interface StatusFieldInfo {
  fieldId: string;
  options: GhProjectFieldOption[];
}

function detectStatusField(owner: string, projectNumber: number): StatusFieldInfo | null {
  const fields = listProjectFields(owner, projectNumber);
  const statusField = fields.find(
    (f) => f.name === "Status" && f.type === "ProjectV2SingleSelectField",
  );
  if (!statusField) return null;
  return { fieldId: statusField.id, options: statusField.options ?? [] };
}

const DATE_FIELD_NAME_RE = /^(target\s*date|due\s*date|due|deadline)$/i;

function detectDateField(owner: string, projectNumber: number): GhProjectField | null {
  const fields = listProjectFields(owner, projectNumber);
  return fields.find((f) => DATE_FIELD_NAME_RE.test(f.name)) ?? null;
}

function createDateField(owner: string, projectNumber: number, fieldName: string): string | null {
  try {
    // Create the field and then list fields to get the ID
    execFileSync(
      "gh",
      [
        "project",
        "field-create",
        String(projectNumber),
        "--owner",
        owner,
        "--name",
        fieldName,
        "--data-type",
        "DATE",
      ],
      { encoding: "utf-8", timeout: 30_000 },
    );
    // Re-list to find the newly created field
    const fields = listProjectFields(owner, projectNumber);
    return fields.find((f) => f.name === fieldName)?.id ?? null;
  } catch {
    return null;
  }
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: interactive setup wizard with many steps
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

  // Step 4: Select repos (personal + org repos)
  console.log("Fetching repositories...");
  const allRepos = listAllRepos();
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
    const statusInfo = detectStatusField(owner, projectNumber);
    let statusFieldId: string;
    if (statusInfo) {
      statusFieldId = statusInfo.fieldId;
      console.log(`  Found status field: ${statusFieldId}`);
    } else {
      console.log("  Could not auto-detect status field.");
      statusFieldId = await input({
        message: "  Enter status field ID manually:",
      });
    }

    // Detect due date field
    console.log("  Detecting due date field...");
    let dueDateFieldId: string | undefined;
    const existingDateField = detectDateField(owner, projectNumber);
    if (existingDateField) {
      console.log(`  Found date field: "${existingDateField.name}" (${existingDateField.id})`);
      const useDateField = await confirm({
        message: `  Use "${existingDateField.name}" for due dates?`,
        default: true,
      });
      if (useDateField) {
        dueDateFieldId = existingDateField.id;
      }
    } else {
      console.log("  No due date field found in this project.");
      const createField = await confirm({
        message: '  Create a "Due Date" field for due dates?',
        default: false,
      });
      if (createField) {
        console.log('  Creating "Due Date" field...');
        const newFieldId = createDateField(owner, projectNumber, "Due Date");
        if (newFieldId) {
          dueDateFieldId = newFieldId;
          console.log(`  Created "Due Date" field (${newFieldId})`);
        } else {
          console.log("  Could not create field — due dates will be stored in issue body.");
        }
      } else {
        console.log("  Skipped — due dates will be stored in issue body.");
      }
    }

    // Completion action
    const completionType = await select<CompletionAction["type"]>({
      message: `  When a task is completed, what should happen on GitHub?`,
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
      const statusOptions = statusInfo?.options ?? [];
      let optionId: string;
      if (statusOptions.length > 0) {
        optionId = await select<string>({
          message: "  Status to set when completed:",
          choices: statusOptions.map((o) => ({
            name: o.name,
            value: o.id,
          })),
        });
      } else {
        optionId = await input({
          message: "  Status option ID to set:",
        });
      }
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
      ...(dueDateFieldId ? { dueDateFieldId } : {}),
      completionAction,
    });
  }

  // Step 6: TickTick integration (disabled by default, enable with `hog config ticktick:enable`)
  const ticktickAlreadyEnabled = existsSync(`${CONFIG_DIR}/auth.json`);
  let ticktickAuth = false;
  if (ticktickAlreadyEnabled) {
    ticktickAuth = true;
    console.log("TickTick auth found — integration enabled.");
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

  // Step 8: AI / LLM key (optional)
  console.log("\nAI-enhanced issue creation (optional):");
  console.log(
    '  Press I on the board to create issues with natural language (e.g. "fix login bug #backend @alice due friday").',
  );
  console.log("  Without a key the heuristic parser still works — labels, assignee, and due dates");
  console.log("  are extracted from #, @, and due tokens. An OpenRouter key enables richer title");
  console.log("  cleanup and inference for ambiguous input.");
  const setupLlm = await confirm({
    message: "  Set up an OpenRouter API key now?",
    default: false,
  });
  if (setupLlm) {
    console.log("  Get a free key at https://openrouter.ai/keys");
    const llmKey = await input({
      message: "  OpenRouter API key:",
      validate: (v) => (v.trim().startsWith("sk-or-") ? true : 'Key must start with "sk-or-"'),
    });
    saveLlmAuth(llmKey.trim());
    console.log("  OpenRouter key saved to ~/.config/hog/auth.json");
  } else {
    console.log("  Skipped. You can add it later: hog config ai:set-key");
  }

  // Step 9: Build and write config
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
    ticktick: { enabled: ticktickAuth },
    profiles: existingConfig?.profiles ?? {},
  };

  saveFullConfig(config);
  console.log(`\nConfig written to ${CONFIG_DIR}/config.json`);
  console.log("\nSetup complete! Try:\n");
  console.log("  hog board --live    # Interactive dashboard");
  console.log("  hog task list       # List TickTick tasks");
  console.log("  hog config show     # View configuration\n");
}

// ── repos:add wizard ──

export async function runReposAdd(initialRepoName?: string): Promise<void> {
  try {
    await runReposAddWizard(initialRepoName);
  } catch (error) {
    if (error instanceof Error && error.message.includes("User force closed")) {
      console.log("\nCancelled. No changes were made.");
      return;
    }
    throw error;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: interactive add-repo wizard with many steps
async function runReposAddWizard(initialRepoName?: string): Promise<void> {
  console.log("\n🐗 hog config repos:add\n");

  const cfg = loadFullConfig();
  let repoName = initialRepoName;

  if (!repoName) {
    console.log("Fetching repositories...");
    const allRepos = listAllRepos();
    const configuredNames = new Set(cfg.repos.map((r) => r.name));
    const available = allRepos.filter((r) => !configuredNames.has(r.nameWithOwner));

    if (available.length === 0) {
      console.log(
        "No more repositories available to add. All accessible repos are already tracked.",
      );
      return;
    }

    repoName = await select<string>({
      message: "Select repository to add:",
      choices: available.map((r) => ({ name: r.nameWithOwner, value: r.nameWithOwner })),
    });
  }

  if (!validateRepoName(repoName)) {
    console.error("Invalid repo name. Use owner/repo format (e.g. myorg/myrepo).");
    process.exit(1);
  }

  if (findRepo(cfg, repoName)) {
    console.error(`Repo "${repoName}" is already configured.`);
    process.exit(1);
  }

  const [owner, name] = repoName.split("/") as [string, string];
  console.log(`\nConfiguring ${repoName}...`);

  // Detect projects
  console.log("  Fetching GitHub Projects...");
  const projects = listOrgProjects(owner);
  let projectNumber: number;
  if (projects.length === 0) {
    console.log("  No GitHub Projects found. Enter project number manually.");
    const num = await input({ message: `  Project number for ${repoName}:` });
    projectNumber = Number.parseInt(num, 10);
  } else {
    projectNumber = await select<number>({
      message: `  Select project for ${repoName}:`,
      choices: projects.map((p) => ({ name: `#${p.number} — ${p.title}`, value: p.number })),
    });
  }

  // Auto-detect status field
  console.log("  Detecting status field...");
  const statusInfo = detectStatusField(owner, projectNumber);
  let statusFieldId: string;
  if (statusInfo) {
    statusFieldId = statusInfo.fieldId;
    console.log(`  Found status field: ${statusFieldId}`);
  } else {
    console.log("  Could not auto-detect status field.");
    statusFieldId = await input({ message: "  Enter status field ID manually:" });
  }

  // Detect due date field
  console.log("  Detecting due date field...");
  let dueDateFieldId: string | undefined;
  const existingDateField = detectDateField(owner, projectNumber);
  if (existingDateField) {
    console.log(`  Found date field: "${existingDateField.name}" (${existingDateField.id})`);
    const useDateField = await confirm({
      message: `  Use "${existingDateField.name}" for due dates?`,
      default: true,
    });
    if (useDateField) {
      dueDateFieldId = existingDateField.id;
    }
  } else {
    console.log("  No due date field found.");
    const createField = await confirm({
      message: '  Create a "Due Date" field for this project?',
      default: false,
    });
    if (createField) {
      console.log('  Creating "Due Date" field...');
      const newFieldId = createDateField(owner, projectNumber, "Due Date");
      if (newFieldId) {
        dueDateFieldId = newFieldId;
        console.log(`  Created "Due Date" field (${newFieldId})`);
      } else {
        console.log("  Could not create field — due dates will be stored in issue body.");
      }
    }
  }

  // Completion action
  const completionType = await select<CompletionAction["type"]>({
    message: "  When a task is completed, what should happen on GitHub?",
    choices: [
      { name: "Close the issue", value: "closeIssue" as const },
      { name: "Add a label (e.g. review:pending)", value: "addLabel" as const },
      { name: "Update project status column", value: "updateProjectStatus" as const },
    ],
  });

  let completionAction: CompletionAction;
  if (completionType === "addLabel") {
    const label = await input({ message: "  Label to add:", default: "review:pending" });
    completionAction = { type: "addLabel", label };
  } else if (completionType === "updateProjectStatus") {
    const statusOptions = statusInfo?.options ?? [];
    let optionId: string;
    if (statusOptions.length > 0) {
      optionId = await select<string>({
        message: "  Status to set when completed:",
        choices: statusOptions.map((o) => ({ name: o.name, value: o.id })),
      });
    } else {
      optionId = await input({ message: "  Status option ID to set:" });
    }
    completionAction = { type: "updateProjectStatus", optionId };
  } else {
    completionAction = { type: "closeIssue" };
  }

  // Short name
  const shortName = await input({
    message: `  Short name for ${repoName}:`,
    default: name,
  });

  const newRepo: RepoConfig = {
    name: repoName,
    shortName,
    projectNumber,
    statusFieldId,
    ...(dueDateFieldId ? { dueDateFieldId } : {}),
    completionAction,
  };

  cfg.repos.push(newRepo);
  saveFullConfig(cfg);

  console.log(`\n  Added ${shortName} → ${repoName}`);
  console.log("  Run: hog board --live\n");
}
