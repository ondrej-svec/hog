import { describe, expect, it, vi } from "vitest";
import {
  agentWindowName,
  breakPane,
  isPaneAlive,
  joinAgentPane,
  killPane,
  splitWithInfo,
  windowExists,
} from "./tmux-pane.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { execFileSync } = vi.mocked(await import("node:child_process"));

describe("tmux-pane utilities", () => {
  describe("agentWindowName", () => {
    it("returns claude-{number}", () => {
      expect(agentWindowName(42)).toBe("claude-42");
      expect(agentWindowName(1)).toBe("claude-1");
    });
  });

  describe("windowExists", () => {
    it("returns true when window name is in the list", () => {
      execFileSync.mockReturnValue("claude-42\nclaude-7\nhog-board\n");
      expect(windowExists("claude-42")).toBe(true);
    });

    it("returns false when window name is not found", () => {
      execFileSync.mockReturnValue("claude-7\nhog-board\n");
      expect(windowExists("claude-42")).toBe(false);
    });

    it("returns false on tmux error", () => {
      execFileSync.mockImplementation(() => {
        throw new Error("tmux not running");
      });
      expect(windowExists("claude-42")).toBe(false);
    });
  });

  describe("joinAgentPane", () => {
    it("returns pane ID on success", () => {
      execFileSync.mockReturnValue("%5\n");
      const result = joinAgentPane("claude-42", 65);
      expect(result).toBe("%5");
      expect(execFileSync).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["join-pane", "-h", "-s", "claude-42.0"]),
        expect.any(Object),
      );
    });

    it("returns null on failure", () => {
      execFileSync.mockImplementation(() => {
        throw new Error("window not found");
      });
      expect(joinAgentPane("claude-99", 65)).toBeNull();
    });

    it("returns null on empty output", () => {
      execFileSync.mockReturnValue("");
      expect(joinAgentPane("claude-42", 65)).toBeNull();
    });
  });

  describe("breakPane", () => {
    it("calls tmux break-pane with correct args", () => {
      execFileSync.mockReturnValue("");
      breakPane("%5");
      expect(execFileSync).toHaveBeenCalledWith(
        "tmux",
        ["break-pane", "-d", "-s", "%5"],
        expect.any(Object),
      );
    });

    it("does not throw on error", () => {
      execFileSync.mockImplementation(() => {
        throw new Error("pane gone");
      });
      expect(() => breakPane("%5")).not.toThrow();
    });
  });

  describe("isPaneAlive", () => {
    it("returns true when pane ID is in the list", () => {
      execFileSync.mockReturnValue("%0\n%5\n%12\n");
      expect(isPaneAlive("%5")).toBe(true);
    });

    it("returns false when pane ID is not found", () => {
      execFileSync.mockReturnValue("%0\n%12\n");
      expect(isPaneAlive("%5")).toBe(false);
    });

    it("returns false on tmux error", () => {
      execFileSync.mockImplementation(() => {
        throw new Error("tmux error");
      });
      expect(isPaneAlive("%5")).toBe(false);
    });
  });

  describe("splitWithInfo", () => {
    it("returns pane ID on success", () => {
      execFileSync.mockReturnValue("%8\n");
      const result = splitWithInfo({ title: "Fix bug", url: "https://github.com/issue/1" }, 65);
      expect(result).toBe("%8");
      expect(execFileSync).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["split-window", "-h"]),
        expect.any(Object),
      );
    });

    it("passes title and url as separate printf args to prevent shell injection", () => {
      execFileSync.mockClear();
      execFileSync.mockReturnValue("%8\n");
      const maliciousTitle = "$(rm -rf /)";
      splitWithInfo({ title: maliciousTitle, url: "https://example.com" }, 65);
      const args = execFileSync.mock.calls[0]?.[1] as string[];
      // Title and URL must be separate argv elements after the printf format string
      expect(args).toContain(maliciousTitle);
      expect(args).toContain("https://example.com");
      // The format string must use %s placeholders, not interpolated values
      const fmtIdx = args.indexOf("printf");
      expect(fmtIdx).toBeGreaterThan(-1);
      const fmtStr = args[fmtIdx + 1];
      expect(fmtStr).toContain("%s");
      expect(fmtStr).not.toContain(maliciousTitle);
    });

    it("returns null on failure", () => {
      execFileSync.mockImplementation(() => {
        throw new Error("split failed");
      });
      expect(splitWithInfo({ title: "Fix bug", url: "https://github.com/issue/1" }, 65)).toBeNull();
    });
  });

  describe("killPane", () => {
    it("calls tmux kill-pane with correct args", () => {
      execFileSync.mockReturnValue("");
      killPane("%5");
      expect(execFileSync).toHaveBeenCalledWith(
        "tmux",
        ["kill-pane", "-t", "%5"],
        expect.any(Object),
      );
    });

    it("does not throw on error", () => {
      execFileSync.mockImplementation(() => {
        throw new Error("pane gone");
      });
      expect(() => killPane("%5")).not.toThrow();
    });
  });
});
