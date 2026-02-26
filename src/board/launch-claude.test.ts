import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs before importing the module under test
const mockExistsSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// Mock node:child_process
const mockSpawnSync = vi.fn();
const mockSpawnFn = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawnFn(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import type { LaunchClaudeOptions } from "./launch-claude.js";
import { buildPrompt, launchClaude } from "./launch-claude.js";

// ── Fixtures ──

function makeIssue(overrides: Partial<{ number: number; title: string; url: string }> = {}) {
  return {
    number: overrides.number ?? 42,
    title: overrides.title ?? "Fix login bug",
    url: overrides.url ?? "https://github.com/acme/app/issues/42",
  };
}

function makeOpts(overrides: Partial<LaunchClaudeOptions> = {}): LaunchClaudeOptions {
  return {
    localPath: "/Users/me/code/acme-app",
    issue: makeIssue(),
    launchMode: "tmux",
    repoFullName: "acme/app",
    ...overrides,
  };
}

function makeSpawnChild() {
  return { unref: vi.fn() };
}

// ── Tests ──

describe("buildPrompt", () => {
  it("produces the expected string format", () => {
    const issue = makeIssue({ number: 42, title: "Fix login bug", url: "https://example.com/42" });
    expect(buildPrompt(issue)).toBe("Issue #42: Fix login bug\nURL: https://example.com/42");
  });

  it("handles shell-unsafe characters in the title (single quote)", () => {
    const issue = makeIssue({ title: "Fix user's login" });
    const prompt = buildPrompt(issue);
    expect(prompt).toContain("Fix user's login");
  });

  it("handles shell-unsafe characters in the title (double quote)", () => {
    const issue = makeIssue({ title: 'Fix "login" bug' });
    const prompt = buildPrompt(issue);
    expect(prompt).toContain('Fix "login" bug');
  });

  it("handles shell-unsafe characters in the title (backtick)", () => {
    const issue = makeIssue({ title: "Fix `login` bug" });
    const prompt = buildPrompt(issue);
    expect(prompt).toContain("Fix `login` bug");
  });

  it("handles shell-unsafe characters in the title (dollar sign)", () => {
    const issue = makeIssue({ title: "Fix $PATH in env" });
    const prompt = buildPrompt(issue);
    expect(prompt).toContain("Fix $PATH in env");
  });

  it("handles shell-unsafe characters in the title (backslash)", () => {
    const issue = makeIssue({ title: "Fix C:\\path issue" });
    const prompt = buildPrompt(issue);
    expect(prompt).toContain("Fix C:\\path issue");
  });

  it("handles newlines in the title", () => {
    const issue = makeIssue({ title: "Fix\nline break" });
    const prompt = buildPrompt(issue);
    expect(prompt).toContain("Fix\nline break");
  });

  it("handles flag-like title (--version)", () => {
    const issue = makeIssue({ title: "--version" });
    const prompt = buildPrompt(issue);
    expect(prompt).toContain("--version");
  });

  it("handles flag-like title (--dangerously-skip-permissions)", () => {
    const issue = makeIssue({ title: "--dangerously-skip-permissions" });
    const prompt = buildPrompt(issue);
    expect(prompt).toContain("--dangerously-skip-permissions");
  });

  it("uses default format when template is undefined", () => {
    const issue = makeIssue({ number: 7, title: "Bug", url: "https://example.com/7" });
    expect(buildPrompt(issue, undefined)).toBe("Issue #7: Bug\nURL: https://example.com/7");
  });

  it("uses default format when template is empty string", () => {
    const issue = makeIssue({ number: 7, title: "Bug", url: "https://example.com/7" });
    expect(buildPrompt(issue, "")).toBe("Issue #7: Bug\nURL: https://example.com/7");
  });

  it("interpolates {number}, {title}, {url} placeholders in template", () => {
    const issue = makeIssue({
      number: 99,
      title: "Add auth",
      url: "https://github.com/x/y/issues/99",
    });
    const template = "Work on #{number}: {title}\n{url}";
    expect(buildPrompt(issue, template)).toBe(
      "Work on #99: Add auth\nhttps://github.com/x/y/issues/99",
    );
  });

  it("replaces multiple occurrences of the same placeholder", () => {
    const issue = makeIssue({ number: 5, title: "Fix", url: "https://example.com/5" });
    const template = "#{number} - {title} (#{number})";
    expect(buildPrompt(issue, template)).toBe("#5 - Fix (#5)");
  });

  it("preserves template text with no placeholders", () => {
    const issue = makeIssue();
    const template = "Just do it";
    expect(buildPrompt(issue, template)).toBe("Just do it");
  });
});

describe("launchClaude — guard clauses", () => {
  beforeEach(() => {
    vi.stubEnv("TMUX", "/tmp/tmux-1000/default,1234,0");
    vi.stubEnv("SSH_CLIENT", "");
    vi.stubEnv("SSH_TTY", "");
    mockExistsSync.mockReturnValue(true);
    // claude is in PATH
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns directory-not-found when localPath does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const result = launchClaude(makeOpts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("directory-not-found");
      expect(result.error.message).toContain("/Users/me/code/acme-app");
    }
  });

  it("returns claude-not-found when claude is not in PATH", () => {
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: 1 });
    const result = launchClaude(makeOpts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("claude-not-found");
      expect(result.error.message).toContain("claude binary not found");
    }
  });

  it("returns ssh-no-tmux when in SSH without tmux", () => {
    vi.stubEnv("TMUX", "");
    vi.stubEnv("SSH_CLIENT", "192.168.1.1 1234 22");
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: 0 });
    const result = launchClaude(makeOpts({ launchMode: "auto" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ssh-no-tmux");
    }
  });
});

describe("launchClaude — tmux path", () => {
  beforeEach(() => {
    vi.stubEnv("TMUX", "/tmp/tmux-1000/default,1234,0");
    vi.stubEnv("SSH_CLIENT", "");
    vi.stubEnv("SSH_TTY", "");
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: 0 });
    const child = makeSpawnChild();
    mockSpawnFn.mockReturnValue(child);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("calls spawn with tmux new-window and -d flag", () => {
    const result = launchClaude(makeOpts({ launchMode: "tmux" }));
    expect(result.ok).toBe(true);
    expect(mockSpawnFn).toHaveBeenCalledWith(
      "tmux",
      expect.arrayContaining(["new-window", "-d"]),
      expect.objectContaining({ detached: true }),
    );
  });

  it("sets the working directory with -c flag", () => {
    const result = launchClaude(makeOpts({ launchMode: "tmux" }));
    expect(result.ok).toBe(true);
    const [, args] = mockSpawnFn.mock.calls[0] as [string, string[]];
    const cIdx = args.indexOf("-c");
    expect(cIdx).toBeGreaterThan(-1);
    expect(args[cIdx + 1]).toBe("/Users/me/code/acme-app");
  });

  it("names the window claude-<number>", () => {
    const result = launchClaude(makeOpts({ launchMode: "tmux", issue: makeIssue({ number: 42 }) }));
    expect(result.ok).toBe(true);
    const [, args] = mockSpawnFn.mock.calls[0] as [string, string[]];
    const nIdx = args.indexOf("-n");
    expect(nIdx).toBeGreaterThan(-1);
    expect(args[nIdx + 1]).toBe("claude-42");
  });

  it("passes issue prompt after -- separator", () => {
    const issue = makeIssue({ number: 42, title: "Fix login bug", url: "https://example.com/42" });
    const result = launchClaude(makeOpts({ launchMode: "tmux", issue }));
    expect(result.ok).toBe(true);
    const [, args] = mockSpawnFn.mock.calls[0] as [string, string[]];
    const dashDashIdx = args.indexOf("--");
    expect(dashDashIdx).toBeGreaterThan(-1);
    expect(args[dashDashIdx + 1]).toBe("Issue #42: Fix login bug\nURL: https://example.com/42");
  });

  it("calls child.unref() to fire-and-forget", () => {
    const child = makeSpawnChild();
    mockSpawnFn.mockReturnValue(child);
    launchClaude(makeOpts({ launchMode: "tmux" }));
    expect(child.unref).toHaveBeenCalled();
  });

  it("uses custom startCommand when provided", () => {
    const startCommand = {
      command: "my-claude",
      extraArgs: ["--append-system-prompt", "Be brief"],
    };
    const result = launchClaude(makeOpts({ launchMode: "tmux", startCommand }));
    expect(result.ok).toBe(true);
    const [, args] = mockSpawnFn.mock.calls[0] as [string, string[]];
    expect(args).toContain("my-claude");
    expect(args).toContain("--append-system-prompt");
  });

  it("uses promptTemplate for the prompt when provided", () => {
    const issue = makeIssue({
      number: 10,
      title: "Add search",
      url: "https://github.com/a/b/issues/10",
    });
    const result = launchClaude(
      makeOpts({
        launchMode: "tmux",
        issue,
        promptTemplate: "/brainstorm\n\nIssue #{number}: {title}\n{url}",
      }),
    );
    expect(result.ok).toBe(true);
    const [, args] = mockSpawnFn.mock.calls[0] as [string, string[]];
    const dashDashIdx = args.indexOf("--");
    expect(args[dashDashIdx + 1]).toBe(
      "/brainstorm\n\nIssue #10: Add search\nhttps://github.com/a/b/issues/10",
    );
  });

  it("auto mode uses tmux when TMUX env is set", () => {
    vi.stubEnv("TMUX", "/tmp/tmux-1000/default,1234,0");
    const result = launchClaude(makeOpts({ launchMode: "auto" }));
    expect(result.ok).toBe(true);
    expect(mockSpawnFn).toHaveBeenCalledWith("tmux", expect.anything(), expect.anything());
  });
});

describe("launchClaude — terminal fallback", () => {
  beforeEach(() => {
    vi.stubEnv("TMUX", "");
    vi.stubEnv("SSH_CLIENT", "");
    vi.stubEnv("SSH_TTY", "");
    vi.stubEnv("TERM_PROGRAM", "Apple_Terminal");
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: 0 });
    const child = makeSpawnChild();
    mockSpawnFn.mockReturnValue(child);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("launches via terminal when launchMode is terminal", () => {
    const result = launchClaude(makeOpts({ launchMode: "terminal" }));
    expect(result.ok).toBe(true);
    expect(mockSpawnFn).toHaveBeenCalled();
  });

  it("auto mode without TMUX falls back to terminal", () => {
    const result = launchClaude(makeOpts({ launchMode: "auto" }));
    expect(result.ok).toBe(true);
    expect(mockSpawnFn).toHaveBeenCalled();
    // Should NOT call tmux
    const [cmd] = (mockSpawnFn.mock.calls[0] as [string]) ?? [""];
    expect(cmd).not.toBe("tmux");
  });

  it("WezTerm: uses wezterm start --cwd", () => {
    vi.stubEnv("TERM_PROGRAM", "WezTerm");
    const child = makeSpawnChild();
    mockSpawnFn.mockReturnValue(child);
    const result = launchClaude(makeOpts({ launchMode: "terminal" }));
    expect(result.ok).toBe(true);
    expect(mockSpawnFn).toHaveBeenCalledWith(
      "wezterm",
      expect.arrayContaining(["start", "--cwd", "/Users/me/code/acme-app"]),
      expect.anything(),
    );
  });

  it("Ghostty: uses open -na Ghostty --args --working-directory", () => {
    vi.stubEnv("TERM_PROGRAM", "ghostty");
    const child = makeSpawnChild();
    mockSpawnFn.mockReturnValue(child);
    const result = launchClaude(makeOpts({ launchMode: "terminal" }));
    expect(result.ok).toBe(true);
    expect(mockSpawnFn).toHaveBeenCalledWith(
      "open",
      expect.arrayContaining(["-na", "Ghostty", "--args"]),
      expect.anything(),
    );
  });

  it("uses configured terminalApp override", () => {
    const child = makeSpawnChild();
    mockSpawnFn.mockReturnValue(child);
    const result = launchClaude(makeOpts({ launchMode: "terminal", terminalApp: "WezTerm" }));
    expect(result.ok).toBe(true);
    expect(mockSpawnFn).toHaveBeenCalledWith("wezterm", expect.anything(), expect.anything());
  });
});

describe("launchClaude — forced launchMode edge cases", () => {
  beforeEach(() => {
    vi.stubEnv("TMUX", "/tmp/tmux-1000/default,1234,0");
    vi.stubEnv("SSH_CLIENT", "");
    vi.stubEnv("SSH_TTY", "");
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("forced tmux mode does not fall back when spawn is called", () => {
    const child = makeSpawnChild();
    mockSpawnFn.mockReturnValue(child);
    const result = launchClaude(makeOpts({ launchMode: "tmux" }));
    expect(result.ok).toBe(true);
    expect(mockSpawnFn).toHaveBeenCalledWith("tmux", expect.anything(), expect.anything());
  });
});
