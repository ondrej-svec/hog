import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

const { isSnoozed, snoozeIssue, markNudgeShown, snoozeKey } = await import("../../enrichment.js");

import type { EnrichmentData } from "../../enrichment.js";

function makeEnrichment(overrides: Partial<EnrichmentData> = {}): EnrichmentData {
  return {
    version: 1,
    sessions: [],
    nudgeState: { snoozedIssues: {} },
    ...overrides,
  };
}

describe("nudge helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("snoozeKey", () => {
    it("formats repo#issueNumber", () => {
      expect(snoozeKey("owner/repo", 42)).toBe("owner/repo#42");
    });
  });

  describe("isSnoozed", () => {
    it("returns false when issue is not snoozed", () => {
      const data = makeEnrichment();
      expect(isSnoozed(data, "owner/repo", 42)).toBe(false);
    });

    it("returns true when snooze-until is in the future", () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const data = makeEnrichment({
        nudgeState: { snoozedIssues: { "owner/repo#42": future } },
      });
      expect(isSnoozed(data, "owner/repo", 42)).toBe(true);
    });

    it("returns false when snooze-until is in the past", () => {
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const data = makeEnrichment({
        nudgeState: { snoozedIssues: { "owner/repo#42": past } },
      });
      expect(isSnoozed(data, "owner/repo", 42)).toBe(false);
    });
  });

  describe("snoozeIssue", () => {
    it("adds a snooze entry with future date", () => {
      const data = makeEnrichment();
      const result = snoozeIssue(data, "owner/repo", 42, 3);

      expect(result.nudgeState.snoozedIssues["owner/repo#42"]).toBeDefined();
      const until = new Date(result.nudgeState.snoozedIssues["owner/repo#42"]!);
      expect(until.getTime()).toBeGreaterThan(Date.now());
    });

    it("preserves existing snooze entries", () => {
      const data = makeEnrichment({
        nudgeState: { snoozedIssues: { "owner/other#1": "2099-01-01T00:00:00Z" } },
      });
      const result = snoozeIssue(data, "owner/repo", 42, 7);

      expect(result.nudgeState.snoozedIssues["owner/other#1"]).toBe("2099-01-01T00:00:00Z");
      expect(result.nudgeState.snoozedIssues["owner/repo#42"]).toBeDefined();
    });
  });

  describe("markNudgeShown", () => {
    it("sets lastDailyNudge to today", () => {
      const data = makeEnrichment();
      const result = markNudgeShown(data);

      const today = new Date().toISOString().slice(0, 10);
      expect(result.nudgeState.lastDailyNudge).toBe(today);
    });

    it("preserves sessions", () => {
      const data = makeEnrichment({
        sessions: [
          {
            id: "s1",
            repo: "owner/repo",
            issueNumber: 42,
            phase: "plan",
            mode: "interactive",
            startedAt: "2026-01-15T10:00:00Z",
          },
        ],
      });
      const result = markNudgeShown(data);
      expect(result.sessions).toHaveLength(1);
    });
  });
});
