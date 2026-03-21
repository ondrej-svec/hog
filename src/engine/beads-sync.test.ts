import { describe, expect, it } from "vitest";
import type { BeadsSyncState } from "./beads-sync.js";
import { findBeadId, findGitHubIssue, linkIssueToBead, unlinkIssue } from "./beads-sync.js";

const EMPTY: BeadsSyncState = { version: 1, entries: [] };

describe("beads-sync", () => {
  it("links a GitHub issue to a bead", () => {
    const state = linkIssueToBead(EMPTY, "owner/repo", 42, "bd-abc123");
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.beadId).toBe("bd-abc123");
    expect(state.entries[0]?.lastSyncedAt).toBeDefined();
  });

  it("findBeadId returns the bead ID for a linked issue", () => {
    const state = linkIssueToBead(EMPTY, "owner/repo", 42, "bd-abc123");
    expect(findBeadId(state, "owner/repo", 42)).toBe("bd-abc123");
  });

  it("findBeadId returns undefined for unlinked issue", () => {
    expect(findBeadId(EMPTY, "owner/repo", 42)).toBeUndefined();
  });

  it("findGitHubIssue returns the issue for a bead", () => {
    const state = linkIssueToBead(EMPTY, "owner/repo", 42, "bd-abc123");
    const result = findGitHubIssue(state, "bd-abc123");
    expect(result).toEqual({ repo: "owner/repo", issueNumber: 42 });
  });

  it("findGitHubIssue returns undefined for unknown bead", () => {
    expect(findGitHubIssue(EMPTY, "bd-unknown")).toBeUndefined();
  });

  it("updates an existing link", () => {
    let state = linkIssueToBead(EMPTY, "owner/repo", 42, "bd-old");
    state = linkIssueToBead(state, "owner/repo", 42, "bd-new");
    expect(state.entries).toHaveLength(1);
    expect(findBeadId(state, "owner/repo", 42)).toBe("bd-new");
  });

  it("unlinks a GitHub issue", () => {
    let state = linkIssueToBead(EMPTY, "owner/repo", 42, "bd-abc123");
    state = unlinkIssue(state, "owner/repo", 42);
    expect(state.entries).toHaveLength(0);
    expect(findBeadId(state, "owner/repo", 42)).toBeUndefined();
  });

  it("unlink is safe on non-existent issue", () => {
    const state = unlinkIssue(EMPTY, "owner/repo", 99);
    expect(state.entries).toHaveLength(0);
  });

  it("handles multiple repos independently", () => {
    let state = linkIssueToBead(EMPTY, "owner/repo-a", 1, "bd-a");
    state = linkIssueToBead(state, "owner/repo-b", 1, "bd-b");
    expect(findBeadId(state, "owner/repo-a", 1)).toBe("bd-a");
    expect(findBeadId(state, "owner/repo-b", 1)).toBe("bd-b");
    expect(state.entries).toHaveLength(2);
  });
});
