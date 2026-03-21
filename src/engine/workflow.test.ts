import { describe, expect, it } from "vitest";
import type { HogConfig } from "../config.js";
import type { AgentSession } from "../enrichment.js";
import { derivePhaseStatus, resolvePhases } from "./workflow.js";

// Minimal config stubs
const minConfig = {
  repos: [],
  board: { assignee: "test" },
} as unknown as HogConfig;

const configWithBoardPhases = {
  repos: [],
  board: { assignee: "test", workflow: { defaultPhases: ["design", "code", "ship"] } },
} as unknown as HogConfig;

describe("resolvePhases", () => {
  it("returns default phases when no config", () => {
    expect(resolvePhases(minConfig)).toEqual(["brainstorm", "plan", "implement", "review"]);
  });

  it("uses board-level phases when configured", () => {
    expect(resolvePhases(configWithBoardPhases)).toEqual(["design", "code", "ship"]);
  });

  it("repo phases override board phases", () => {
    const repoConfig = { workflow: { phases: ["a", "b"] } } as never;
    expect(resolvePhases(configWithBoardPhases, repoConfig)).toEqual(["a", "b"]);
  });

  it("falls back to board phases if repo phases is empty", () => {
    const repoConfig = { workflow: { phases: [] } } as never;
    expect(resolvePhases(configWithBoardPhases, repoConfig)).toEqual(["design", "code", "ship"]);
  });
});

describe("derivePhaseStatus", () => {
  it("returns pending when no sessions", () => {
    const result = derivePhaseStatus("impl", []);
    expect(result).toEqual({ name: "impl", state: "pending" });
  });

  it("returns active when session has no exitedAt", () => {
    const session: AgentSession = {
      id: "s1",
      repo: "r",
      issueNumber: 1,
      phase: "impl",
      mode: "background",
      startedAt: "2026-01-01T00:00:00Z",
    };
    const result = derivePhaseStatus("impl", [session]);
    expect(result.state).toBe("active");
    expect(result.session).toBe(session);
  });

  it("returns completed when session exited with code 0", () => {
    const session: AgentSession = {
      id: "s1",
      repo: "r",
      issueNumber: 1,
      phase: "impl",
      mode: "background",
      startedAt: "2026-01-01T00:00:00Z",
      exitedAt: "2026-01-01T01:00:00Z",
      exitCode: 0,
    };
    const result = derivePhaseStatus("impl", [session]);
    expect(result.state).toBe("completed");
  });

  it("returns pending with latest session when all sessions failed", () => {
    const s1: AgentSession = {
      id: "s1",
      repo: "r",
      issueNumber: 1,
      phase: "impl",
      mode: "background",
      startedAt: "2026-01-01T00:00:00Z",
      exitedAt: "2026-01-01T01:00:00Z",
      exitCode: 1,
    };
    const s2: AgentSession = {
      id: "s2",
      repo: "r",
      issueNumber: 1,
      phase: "impl",
      mode: "background",
      startedAt: "2026-01-02T00:00:00Z",
      exitedAt: "2026-01-02T01:00:00Z",
      exitCode: 1,
    };
    const result = derivePhaseStatus("impl", [s1, s2]);
    expect(result.state).toBe("pending");
    expect(result.session?.id).toBe("s2"); // most recent
  });

  it("ignores sessions for other phases", () => {
    const session: AgentSession = {
      id: "s1",
      repo: "r",
      issueNumber: 1,
      phase: "review",
      mode: "background",
      startedAt: "2026-01-01T00:00:00Z",
    };
    const result = derivePhaseStatus("impl", [session]);
    expect(result.state).toBe("pending");
  });
});
