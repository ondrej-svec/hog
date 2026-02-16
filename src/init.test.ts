import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

// Mock node:child_process
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock @inquirer/prompts
const mockCheckbox = vi.fn();
const mockConfirm = vi.fn();
const mockInput = vi.fn();
const mockSelect = vi.fn();

vi.mock("@inquirer/prompts", () => ({
  checkbox: (...args: unknown[]) => mockCheckbox(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  input: (...args: unknown[]) => mockInput(...args),
  select: (...args: unknown[]) => mockSelect(...args),
}));

// Mock auth module
vi.mock("./auth.js", () => ({
  getAuthorizationUrl: () => "https://example.com/auth",
  exchangeCodeForToken: async () => "mock-token",
  waitForAuthCode: async () => "mock-code",
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedExistsSync = vi.mocked(existsSync);

const { runInit } = await import("./init.js");

describe("hog init wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing config
    mockedExistsSync.mockReturnValue(false);
  });

  function mockGhCalls() {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === "auth" && argsArr[1] === "status") return "";
      if (argsArr[0] === "api" && argsArr[1] === "user") {
        return JSON.stringify({ login: "test-user" });
      }
      if (argsArr[0] === "repo" && argsArr[1] === "list") {
        return JSON.stringify([
          { nameWithOwner: "org/repo-one", name: "repo-one", owner: { login: "org" } },
          { nameWithOwner: "org/repo-two", name: "repo-two", owner: { login: "org" } },
        ]);
      }
      if (argsArr[0] === "project" && argsArr[1] === "list") {
        return JSON.stringify([{ number: 1, title: "Main Board" }]);
      }
      if (argsArr[0] === "project" && argsArr[1] === "field-list") {
        return JSON.stringify([
          { id: "SF_auto", name: "Status", type: "ProjectV2SingleSelectField" },
          { id: "F_other", name: "Priority", type: "ProjectV2SingleSelectField" },
        ]);
      }
      return "";
    });
  }

  it("should create config from wizard answers", async () => {
    mockGhCalls();

    // Select repos
    mockCheckbox.mockResolvedValue(["org/repo-one"]);
    // For repo config: project, completion action, short name
    mockSelect
      .mockResolvedValueOnce(1) // project number
      .mockResolvedValueOnce("closeIssue"); // completion action
    mockInput
      .mockResolvedValueOnce("repo-one") // short name
      .mockResolvedValueOnce("60") // refresh interval
      .mockResolvedValueOnce("20") // backlog limit
      .mockResolvedValueOnce("1500"); // focus duration
    // TickTick
    mockConfirm.mockResolvedValueOnce(false); // no ticktick

    await runInit({ force: true });

    expect(mkdirSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalledTimes(1);

    const savedJson = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    const saved = JSON.parse(savedJson);

    expect(saved.version).toBe(3);
    expect(saved.repos).toHaveLength(1);
    expect(saved.repos[0].name).toBe("org/repo-one");
    expect(saved.repos[0].shortName).toBe("repo-one");
    expect(saved.repos[0].projectNumber).toBe(1);
    expect(saved.repos[0].statusFieldId).toBe("SF_auto");
    expect(saved.repos[0].completionAction).toEqual({ type: "closeIssue" });
    expect(saved.board.assignee).toBe("test-user");
    expect(saved.board.refreshInterval).toBe(60);
    expect(saved.board.focusDuration).toBe(1500);
    expect(saved.ticktick.enabled).toBe(false);
  });

  it("should prompt for overwrite when config exists and force not set", async () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      return false;
    });
    mockGhCalls();

    // Decline overwrite
    mockConfirm.mockResolvedValueOnce(false);

    await runInit();

    // Should not write config
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("should skip overwrite prompt when force flag is set", async () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      return false;
    });
    mockGhCalls();

    mockCheckbox.mockResolvedValue([]); // no repos
    mockConfirm.mockResolvedValueOnce(false); // no ticktick
    mockInput.mockResolvedValueOnce("60").mockResolvedValueOnce("20").mockResolvedValueOnce("1500");

    await runInit({ force: true });

    // Should still write config (no overwrite prompt)
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("should handle Ctrl+C gracefully", async () => {
    mockGhCalls();
    mockedExistsSync.mockReturnValue(false);

    // Simulate user cancellation
    mockCheckbox.mockRejectedValue(new Error("User force closed the prompt"));

    await runInit();

    // Should not write config
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("should handle addLabel completion action", async () => {
    mockGhCalls();

    mockCheckbox.mockResolvedValue(["org/repo-one"]);
    mockSelect
      .mockResolvedValueOnce(1) // project number
      .mockResolvedValueOnce("addLabel"); // completion action
    mockInput
      .mockResolvedValueOnce("review:pending") // label name
      .mockResolvedValueOnce("r1") // short name
      .mockResolvedValueOnce("60")
      .mockResolvedValueOnce("20")
      .mockResolvedValueOnce("1500");
    mockConfirm.mockResolvedValueOnce(false); // no ticktick

    await runInit({ force: true });

    const savedJson = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    const saved = JSON.parse(savedJson);

    expect(saved.repos[0].completionAction).toEqual({ type: "addLabel", label: "review:pending" });
  });

  it("should configure multiple repos", async () => {
    mockGhCalls();

    mockCheckbox.mockResolvedValue(["org/repo-one", "org/repo-two"]);
    // Repo 1
    mockSelect
      .mockResolvedValueOnce(1) // project number
      .mockResolvedValueOnce("closeIssue"); // completion action
    mockInput.mockResolvedValueOnce("r1"); // short name
    // Repo 2
    mockSelect
      .mockResolvedValueOnce(1) // project number
      .mockResolvedValueOnce("closeIssue"); // completion action
    mockInput
      .mockResolvedValueOnce("r2") // short name
      .mockResolvedValueOnce("30") // refresh interval
      .mockResolvedValueOnce("10") // backlog limit
      .mockResolvedValueOnce("900"); // focus duration
    mockConfirm.mockResolvedValueOnce(false); // no ticktick

    await runInit({ force: true });

    const savedJson = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    const saved = JSON.parse(savedJson);

    expect(saved.repos).toHaveLength(2);
    expect(saved.repos[0].shortName).toBe("r1");
    expect(saved.repos[1].shortName).toBe("r2");
  });
});
