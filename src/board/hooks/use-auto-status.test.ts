import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoConfig } from "../../config.js";
import type { StatusOption } from "../../github.js";
import type { ActivityEvent } from "../fetch.js";
import { matchTrigger, resolveStatusOptionId } from "./use-auto-status.js";

// ── Fixtures ──

function makeRepoConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    name: "test-org/backend",
    shortName: "backend",
    projectNumber: 1,
    statusFieldId: "PVTSSF_123",
    completionAction: { type: "closeIssue" },
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    type: "branch_created",
    repoShortName: "backend",
    issueNumber: 42,
    actor: "alice",
    summary: "created branch feat/42-auth",
    timestamp: new Date(),
    ...overrides,
  };
}

const STATUS_OPTIONS: StatusOption[] = [
  { id: "opt_1", name: "Ready" },
  { id: "opt_2", name: "In Progress" },
  { id: "opt_3", name: "In Review" },
  { id: "opt_4", name: "Done" },
];

// ── matchTrigger ──

describe("matchTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined when autoStatus is not configured", () => {
    const rc = makeRepoConfig();
    const event = makeEvent({ type: "branch_created" });
    expect(matchTrigger(event, rc)).toBeUndefined();
  });

  it("returns undefined when autoStatus is disabled", () => {
    const rc = makeRepoConfig({
      autoStatus: {
        enabled: false,
        triggers: { branchCreated: "In Progress" },
      },
    });
    const event = makeEvent({ type: "branch_created" });
    expect(matchTrigger(event, rc)).toBeUndefined();
  });

  it("returns undefined when no triggers configured", () => {
    const rc = makeRepoConfig({
      autoStatus: { enabled: true },
    });
    const event = makeEvent({ type: "branch_created" });
    expect(matchTrigger(event, rc)).toBeUndefined();
  });

  it("matches branch_created to branchCreated trigger", () => {
    const rc = makeRepoConfig({
      autoStatus: {
        enabled: true,
        triggers: { branchCreated: "In Progress" },
      },
    });
    const event = makeEvent({ type: "branch_created" });
    expect(matchTrigger(event, rc)).toBe("In Progress");
  });

  it("matches pr_opened to prOpened trigger", () => {
    const rc = makeRepoConfig({
      autoStatus: {
        enabled: true,
        triggers: { prOpened: "In Review" },
      },
    });
    const event = makeEvent({ type: "pr_opened" });
    expect(matchTrigger(event, rc)).toBe("In Review");
  });

  it("matches pr_merged to prMerged trigger", () => {
    const rc = makeRepoConfig({
      autoStatus: {
        enabled: true,
        triggers: { prMerged: "Done" },
      },
    });
    const event = makeEvent({ type: "pr_merged" });
    expect(matchTrigger(event, rc)).toBe("Done");
  });

  it("returns undefined for non-trigger event types", () => {
    const rc = makeRepoConfig({
      autoStatus: {
        enabled: true,
        triggers: { branchCreated: "In Progress" },
      },
    });
    expect(matchTrigger(makeEvent({ type: "comment" }), rc)).toBeUndefined();
    expect(matchTrigger(makeEvent({ type: "opened" }), rc)).toBeUndefined();
    expect(matchTrigger(makeEvent({ type: "closed" }), rc)).toBeUndefined();
    expect(matchTrigger(makeEvent({ type: "assignment" }), rc)).toBeUndefined();
    expect(matchTrigger(makeEvent({ type: "labeled" }), rc)).toBeUndefined();
    expect(matchTrigger(makeEvent({ type: "pr_closed" }), rc)).toBeUndefined();
  });

  it("returns undefined when trigger for that event type is not configured", () => {
    const rc = makeRepoConfig({
      autoStatus: {
        enabled: true,
        triggers: { prOpened: "In Review" },
        // branchCreated not configured
      },
    });
    const event = makeEvent({ type: "branch_created" });
    expect(matchTrigger(event, rc)).toBeUndefined();
  });
});

// ── resolveStatusOptionId ──

describe("resolveStatusOptionId", () => {
  it("resolves exact name to option ID", () => {
    expect(resolveStatusOptionId("In Progress", STATUS_OPTIONS)).toBe("opt_2");
  });

  it("resolves case-insensitively", () => {
    expect(resolveStatusOptionId("in progress", STATUS_OPTIONS)).toBe("opt_2");
    expect(resolveStatusOptionId("IN PROGRESS", STATUS_OPTIONS)).toBe("opt_2");
    expect(resolveStatusOptionId("done", STATUS_OPTIONS)).toBe("opt_4");
  });

  it("returns undefined for unknown status name", () => {
    expect(resolveStatusOptionId("Unknown Status", STATUS_OPTIONS)).toBeUndefined();
  });

  it("returns undefined for empty status options", () => {
    expect(resolveStatusOptionId("In Progress", [])).toBeUndefined();
  });
});
