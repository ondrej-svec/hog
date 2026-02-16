import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

// Import after mocks are set up
const { loadFullConfig, resolveProfile, validateRepoName } = await import("./config.js");

import type { HogConfig } from "./config.js";

describe("config migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should migrate v2 config to v3 with ticktick.enabled=true when auth.json exists", () => {
    const v2Config = {
      version: 2,
      repos: [],
      board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej" },
    };

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      if (path.endsWith("auth.json")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(v2Config));

    const result = loadFullConfig();

    expect(result.version).toBe(3);
    expect(result.ticktick).toEqual({ enabled: true });
  });

  it("should migrate v2 config to v3 with ticktick.enabled=false when auth.json missing", () => {
    const v2Config = {
      version: 2,
      repos: [],
      board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej" },
    };

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      if (path.endsWith("auth.json")) return false;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(v2Config));

    const result = loadFullConfig();

    expect(result.version).toBe(3);
    expect(result.ticktick).toEqual({ enabled: false });
  });

  it("should not re-migrate v3 config", () => {
    const v3Config = {
      version: 3,
      repos: [],
      board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej" },
      ticktick: { enabled: false },
    };

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(v3Config));

    const result = loadFullConfig();

    expect(result.version).toBe(3);
    expect(result.ticktick).toEqual({ enabled: false });
    // Should NOT have called writeFileSync (no migration needed)
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("should preserve all v2 fields during migration to v3", () => {
    const v2Config = {
      version: 2,
      defaultProjectId: "proj123",
      defaultProjectName: "My Project",
      repos: [
        {
          name: "owner/repo",
          shortName: "repo",
          projectNumber: 1,
          statusFieldId: "SF_1",
          completionAction: { type: "closeIssue" },
        },
      ],
      board: { refreshInterval: 30, backlogLimit: 10, assignee: "test-user", focusDuration: 900 },
    };

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      if (path.endsWith("auth.json")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(v2Config));

    const result = loadFullConfig();

    expect(result.version).toBe(3);
    expect(result.defaultProjectId).toBe("proj123");
    expect(result.defaultProjectName).toBe("My Project");
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.name).toBe("owner/repo");
    expect(result.board.refreshInterval).toBe(30);
    expect(result.board.backlogLimit).toBe(10);
    expect(result.board.assignee).toBe("test-user");
    expect(result.board.focusDuration).toBe(900);
    expect(result.ticktick).toEqual({ enabled: true });
  });

  it("should migrate v1 config all the way to v3", () => {
    const v1Config = {
      defaultProjectId: "inbox",
    };

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      if (path.endsWith("auth.json")) return false;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(v1Config));

    const result = loadFullConfig();

    expect(result.version).toBe(3);
    expect(result.repos).toEqual([]); // no legacy repos
    expect(result.board.assignee).toBe("unknown"); // placeholder default
    expect(result.ticktick).toEqual({ enabled: false }); // no auth.json
  });

  it("should default profiles to empty object and defaultProfile to undefined", () => {
    const v3Config = {
      version: 3,
      repos: [],
      board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej" },
      ticktick: { enabled: true },
    };

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(v3Config));

    const result = loadFullConfig();

    expect(result.profiles).toEqual({});
    expect(result.defaultProfile).toBeUndefined();
  });

  it("should save migrated config to disk", () => {
    const v2Config = {
      version: 2,
      repos: [],
      board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej" },
    };

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return true;
      if (path.endsWith("auth.json")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(v2Config));

    loadFullConfig();

    expect(mkdirSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalledTimes(1);

    // Verify the saved config is v3
    const savedJson = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    const saved = JSON.parse(savedJson);
    expect(saved.version).toBe(3);
    expect(saved.ticktick).toEqual({ enabled: true });
  });
});

describe("resolveProfile", () => {
  function makeBaseConfig(): HogConfig {
    return {
      version: 3,
      repos: [
        {
          name: "owner/main-repo",
          shortName: "main-repo",
          projectNumber: 1,
          statusFieldId: "SF_1",
          completionAction: { type: "closeIssue" as const },
        },
      ],
      board: { refreshInterval: 60, backlogLimit: 20, assignee: "ondrej", focusDuration: 1500 },
      ticktick: { enabled: true },
      profiles: {
        work: {
          repos: [
            {
              name: "company/work-repo",
              shortName: "work-repo",
              projectNumber: 2,
              statusFieldId: "SF_2",
              completionAction: { type: "closeIssue" as const },
            },
          ],
          board: {
            refreshInterval: 30,
            backlogLimit: 10,
            assignee: "ondrej-work",
            focusDuration: 900,
          },
          ticktick: { enabled: false },
        },
        personal: {
          repos: [
            {
              name: "user/personal-repo",
              shortName: "personal-repo",
              projectNumber: 3,
              statusFieldId: "SF_3",
              completionAction: { type: "closeIssue" as const },
            },
          ],
          board: {
            refreshInterval: 120,
            backlogLimit: 50,
            assignee: "ondrej-personal",
            focusDuration: 1800,
          },
          ticktick: { enabled: true },
        },
      },
      defaultProfile: "work",
    };
  }

  it("should return top-level config when no profile specified and no default", () => {
    const config = makeBaseConfig();
    config.defaultProfile = undefined;

    const { resolved, activeProfile } = resolveProfile(config);

    expect(activeProfile).toBeNull();
    expect(resolved.board.assignee).toBe("ondrej");
    expect(resolved.repos[0]?.shortName).toBe("main-repo");
  });

  it("should resolve defaultProfile when no explicit profile specified", () => {
    const config = makeBaseConfig();

    const { resolved, activeProfile } = resolveProfile(config);

    expect(activeProfile).toBe("work");
    expect(resolved.board.assignee).toBe("ondrej-work");
    expect(resolved.repos[0]?.shortName).toBe("work-repo");
    expect(resolved.ticktick.enabled).toBe(false);
  });

  it("should resolve explicit profile over defaultProfile", () => {
    const config = makeBaseConfig();

    const { resolved, activeProfile } = resolveProfile(config, "personal");

    expect(activeProfile).toBe("personal");
    expect(resolved.board.assignee).toBe("ondrej-personal");
    expect(resolved.repos[0]?.shortName).toBe("personal-repo");
    expect(resolved.ticktick.enabled).toBe(true);
  });

  it("should preserve non-profile fields (version, defaultProjectId) from base config", () => {
    const config = makeBaseConfig();
    config.defaultProjectId = "inbox123";

    const { resolved } = resolveProfile(config, "work");

    expect(resolved.version).toBe(3);
    expect(resolved.defaultProjectId).toBe("inbox123");
    expect(resolved.profiles).toEqual(config.profiles);
  });

  it("should exit with error for unknown profile", () => {
    const config = makeBaseConfig();
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => resolveProfile(config, "nonexistent")).toThrow("process.exit");
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining("nonexistent"));

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

describe("validateRepoName", () => {
  it.each([
    "owner/repo",
    "my-org/my-repo",
    "user_123/repo.js",
    "org/repo-name.v2",
  ])("accepts valid repo names: %s", (name) => {
    expect(validateRepoName(name)).toBe(true);
  });

  describe("malicious input fuzzing", () => {
    it.each([
      "../../etc/passwd",
      "owner/../../../etc/shadow",
    ])("rejects path traversal: %s", (name) => {
      expect(validateRepoName(name)).toBe(false);
    });

    it.each([
      "; rm -rf /",
      "owner/repo; echo pwned",
      "$(whoami)/repo",
      "`id`/repo",
      "owner/repo && cat /etc/passwd",
      "owner/repo | rm -rf /",
    ])("rejects shell injection: %s", (name) => {
      expect(validateRepoName(name)).toBe(false);
    });

    it.each([
      "",
      "   ",
      "/",
      "owner/",
      "/repo",
      "owner//repo",
      "just-a-name",
    ])("rejects malformed names: %s", (name) => {
      expect(validateRepoName(name)).toBe(false);
    });

    it.each([
      "repo\x00name/repo",
      "owner/repo\x00",
      "\x00/\x00",
    ])("rejects null bytes: %s", (name) => {
      expect(validateRepoName(name)).toBe(false);
    });

    it.each([
      "owner/repo name",
      "owner repo/name",
      "owner/repo\ttab",
      "owner/repo\nnewline",
    ])("rejects whitespace in names: %s", (name) => {
      expect(validateRepoName(name)).toBe(false);
    });
  });
});
