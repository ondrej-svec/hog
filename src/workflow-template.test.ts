import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BoardConfig, RepoConfig } from "./config.js";
import {
  BUILTIN_TEMPLATES,
  applyTemplateToBoard,
  applyTemplateToRepo,
  exportTemplate,
  importTemplate,
  validateTemplate,
} from "./workflow-template.js";

// ── Test fixtures ──

const MINIMAL_REPO: RepoConfig = {
  name: "owner/repo",
  shortName: "repo",
  projectNumber: 1,
  statusFieldId: "FIELD_1",
  completionAction: { type: "closeIssue" },
};

const REPO_WITH_WORKFLOW: RepoConfig = {
  ...MINIMAL_REPO,
  workflow: {
    mode: "suggested",
    phases: ["brainstorm", "plan", "implement"],
    phasePrompts: { brainstorm: "Think about it" },
  },
  autoStatus: {
    enabled: true,
    triggers: {
      branchCreated: "In Progress",
      prOpened: "In Review",
      prMerged: "Done",
    },
  },
};

const MINIMAL_BOARD: BoardConfig = {
  refreshInterval: 60,
  backlogLimit: 20,
  assignee: "user",
  focusDuration: 1500,
};

// ── Temp directory for file tests ──

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `hog-template-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── validateTemplate ──

describe("validateTemplate", () => {
  it("should validate a correct template", () => {
    const result = validateTemplate({
      name: "Test",
      workflow: { mode: "suggested", phases: ["plan", "implement"] },
    });
    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("name", "Test");
  });

  it("should reject a template missing required fields", () => {
    const result = validateTemplate({ description: "no name" });
    expect(result).toHaveProperty("error");
  });

  it("should reject a template with invalid workflow mode", () => {
    const result = validateTemplate({
      name: "Bad",
      workflow: { mode: "invalid", phases: [] },
    });
    expect(result).toHaveProperty("error");
  });

  it("should accept a template with optional fields", () => {
    const result = validateTemplate({
      name: "Full",
      version: "2.0.0",
      description: "A full template",
      workflow: { mode: "freeform", phases: ["implement"] },
      staleness: { warningDays: 3, criticalDays: 10 },
      autoStatus: { branchCreated: "In Progress" },
    });
    expect(result).not.toHaveProperty("error");
    if (!("error" in result)) {
      expect(result.version).toBe("2.0.0");
      expect(result.staleness?.warningDays).toBe(3);
      expect(result.autoStatus?.branchCreated).toBe("In Progress");
    }
  });
});

// ── BUILTIN_TEMPLATES ──

describe("BUILTIN_TEMPLATES", () => {
  it("should have 'full' and 'minimal' templates", () => {
    expect(BUILTIN_TEMPLATES).toHaveProperty("full");
    expect(BUILTIN_TEMPLATES).toHaveProperty("minimal");
  });

  it("full template should validate", () => {
    const result = validateTemplate(BUILTIN_TEMPLATES["full"]);
    expect(result).not.toHaveProperty("error");
  });

  it("minimal template should validate", () => {
    const result = validateTemplate(BUILTIN_TEMPLATES["minimal"]);
    expect(result).not.toHaveProperty("error");
  });
});

// ── exportTemplate ──

describe("exportTemplate", () => {
  it("should export from a repo with workflow config", () => {
    const template = exportTemplate("My Template", REPO_WITH_WORKFLOW, {
      ...MINIMAL_BOARD,
      workflow: {
        defaultMode: "suggested",
        defaultPhases: ["brainstorm", "plan", "implement", "review"],
        maxConcurrentAgents: 3,
        staleness: { warningDays: 5, criticalDays: 10 },
      },
    });

    expect(template.name).toBe("My Template");
    expect(template.workflow.mode).toBe("suggested");
    expect(template.workflow.phases).toEqual(["brainstorm", "plan", "implement"]);
    expect(template.staleness).toEqual({ warningDays: 5, criticalDays: 10 });
    expect(template.autoStatus?.branchCreated).toBe("In Progress");
  });

  it("should use defaults for a repo without workflow", () => {
    const template = exportTemplate("Default", MINIMAL_REPO);
    expect(template.workflow.mode).toBe("suggested");
    expect(template.workflow.phases).toEqual(["brainstorm", "plan", "implement", "review"]);
    expect(template.staleness).toBeUndefined();
    expect(template.autoStatus).toBeUndefined();
  });
});

// ── importTemplate ──

describe("importTemplate", () => {
  it("should import a valid template file", () => {
    const filePath = join(tmpDir, "valid.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        name: "Imported",
        workflow: { mode: "freeform", phases: ["implement"] },
      }),
    );

    const result = importTemplate(filePath);
    expect(result).not.toHaveProperty("error");
    if (!("error" in result)) {
      expect(result.name).toBe("Imported");
    }
  });

  it("should return error for missing file", () => {
    const result = importTemplate(join(tmpDir, "nope.json"));
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("File not found");
    }
  });

  it("should return error for invalid JSON", () => {
    const filePath = join(tmpDir, "bad.json");
    writeFileSync(filePath, "not json!");

    const result = importTemplate(filePath);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("Failed to parse JSON");
    }
  });

  it("should return error for valid JSON but invalid template", () => {
    const filePath = join(tmpDir, "invalid.json");
    writeFileSync(filePath, JSON.stringify({ foo: "bar" }));

    const result = importTemplate(filePath);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("Invalid template");
    }
  });
});

// ── applyTemplateToRepo ──

describe("applyTemplateToRepo", () => {
  it("should apply workflow from template", () => {
    const template = BUILTIN_TEMPLATES["full"];
    if (!template) throw new Error("full template not found");

    const updated = applyTemplateToRepo(template, MINIMAL_REPO);
    expect(updated.workflow).toEqual(template.workflow);
    // Instance-specific fields preserved
    expect(updated.name).toBe("owner/repo");
    expect(updated.statusFieldId).toBe("FIELD_1");
  });

  it("should apply autoStatus triggers from template", () => {
    const template = BUILTIN_TEMPLATES["full"];
    if (!template) throw new Error("full template not found");

    const updated = applyTemplateToRepo(template, MINIMAL_REPO);
    expect(updated.autoStatus?.triggers?.branchCreated).toBe("In Progress");
    expect(updated.autoStatus?.triggers?.prMerged).toBe("Done");
    // enabled should default to false for new repos
    expect(updated.autoStatus?.enabled).toBe(false);
  });

  it("should preserve existing autoStatus.enabled", () => {
    const template = BUILTIN_TEMPLATES["full"];
    if (!template) throw new Error("full template not found");

    const repo: RepoConfig = {
      ...MINIMAL_REPO,
      autoStatus: { enabled: true, triggers: {} },
    };
    const updated = applyTemplateToRepo(template, repo);
    expect(updated.autoStatus?.enabled).toBe(true);
  });
});

// ── applyTemplateToBoard ──

describe("applyTemplateToBoard", () => {
  it("should apply workflow defaults to board config", () => {
    const template = BUILTIN_TEMPLATES["full"];
    if (!template) throw new Error("full template not found");

    const updated = applyTemplateToBoard(template, MINIMAL_BOARD);
    expect(updated.workflow?.defaultMode).toBe("suggested");
    expect(updated.workflow?.defaultPhases).toEqual(template.workflow.phases);
    expect(updated.workflow?.staleness).toEqual(template.staleness);
  });

  it("should preserve existing board notifications", () => {
    const template = BUILTIN_TEMPLATES["minimal"];
    if (!template) throw new Error("minimal template not found");

    const board: BoardConfig = {
      ...MINIMAL_BOARD,
      workflow: {
        defaultMode: "suggested",
        defaultPhases: ["brainstorm", "plan", "implement", "review"],
        maxConcurrentAgents: 3,
        notifications: { os: true, sound: false },
      },
    };
    const updated = applyTemplateToBoard(template, board);
    expect(updated.workflow?.notifications).toEqual({ os: true, sound: false });
  });

  it("should preserve maxConcurrentAgents if set", () => {
    const template = BUILTIN_TEMPLATES["minimal"];
    if (!template) throw new Error("minimal template not found");

    const board: BoardConfig = {
      ...MINIMAL_BOARD,
      workflow: {
        defaultMode: "suggested",
        defaultPhases: ["brainstorm", "plan", "implement", "review"],
        maxConcurrentAgents: 5,
      },
    };
    const updated = applyTemplateToBoard(template, board);
    expect(updated.workflow?.maxConcurrentAgents).toBe(5);
  });
});
