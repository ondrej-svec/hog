import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use a stable test dir path (tmpdir is always available)
const testDir = join(tmpdir(), "hog-sync-state-test");

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  const path = await import("node:path");
  const os = await import("node:os");
  return {
    ...actual,
    homedir: () => path.join(os.tmpdir(), "hog-sync-state-test", "home"),
  };
});

import type { SyncMapping, SyncState } from "./sync-state.js";
import {
  findMapping,
  findMappingByTaskId,
  loadSyncState,
  removeMapping,
  saveSyncState,
  upsertMapping,
} from "./sync-state.js";

function makeMapping(overrides: Partial<SyncMapping> = {}): SyncMapping {
  return {
    githubRepo: "aibilitycz/aibility",
    githubIssueNumber: 42,
    githubUrl: "https://github.com/aibilitycz/aibility/issues/42",
    ticktickTaskId: "tt-123",
    ticktickProjectId: "proj-inbox",
    githubUpdatedAt: "2025-01-15T10:00:00Z",
    lastSyncedAt: "2025-01-15T10:05:00Z",
    ...overrides,
  };
}

describe("sync-state", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "home", ".config", "hog"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadSyncState", () => {
    it("returns empty state when file does not exist", () => {
      const state = loadSyncState();
      expect(state.mappings).toEqual([]);
      expect(state.lastSyncAt).toBeUndefined();
    });

    it("loads state from file", () => {
      const data: SyncState = { mappings: [makeMapping()], lastSyncAt: "2025-01-15T10:00:00Z" };
      const filePath = join(testDir, "home", ".config", "hog", "sync-state.json");
      writeFileSync(filePath, JSON.stringify(data));

      const state = loadSyncState();
      expect(state.mappings).toHaveLength(1);
      expect(state.mappings[0]?.githubIssueNumber).toBe(42);
      expect(state.lastSyncAt).toBe("2025-01-15T10:00:00Z");
    });

    it("returns empty state on invalid JSON", () => {
      const filePath = join(testDir, "home", ".config", "hog", "sync-state.json");
      writeFileSync(filePath, "not json");

      const state = loadSyncState();
      expect(state.mappings).toEqual([]);
    });
  });

  describe("saveSyncState", () => {
    it("persists state to file", () => {
      const state: SyncState = { mappings: [makeMapping()], lastSyncAt: "2025-01-15T10:00:00Z" };
      saveSyncState(state);

      const filePath = join(testDir, "home", ".config", "hog", "sync-state.json");
      expect(existsSync(filePath)).toBe(true);

      const loaded = JSON.parse(readFileSync(filePath, "utf-8")) as SyncState;
      expect(loaded.mappings).toHaveLength(1);
    });
  });

  describe("findMapping", () => {
    it("finds mapping by repo and issue number", () => {
      const state: SyncState = {
        mappings: [makeMapping(), makeMapping({ githubIssueNumber: 99 })],
      };
      const found = findMapping(state, "aibilitycz/aibility", 42);
      expect(found?.ticktickTaskId).toBe("tt-123");
    });

    it("returns undefined when not found", () => {
      const state: SyncState = { mappings: [makeMapping()] };
      const found = findMapping(state, "aibilitycz/aibility", 999);
      expect(found).toBeUndefined();
    });
  });

  describe("findMappingByTaskId", () => {
    it("finds mapping by TickTick task ID", () => {
      const state: SyncState = { mappings: [makeMapping()] };
      const found = findMappingByTaskId(state, "tt-123");
      expect(found?.githubIssueNumber).toBe(42);
    });
  });

  describe("upsertMapping", () => {
    it("inserts new mapping", () => {
      const state: SyncState = { mappings: [] };
      upsertMapping(state, makeMapping());
      expect(state.mappings).toHaveLength(1);
    });

    it("updates existing mapping", () => {
      const state: SyncState = { mappings: [makeMapping()] };
      upsertMapping(state, makeMapping({ ticktickTaskId: "tt-456" }));
      expect(state.mappings).toHaveLength(1);
      expect(state.mappings[0]?.ticktickTaskId).toBe("tt-456");
    });
  });

  describe("removeMapping", () => {
    it("removes mapping by repo and issue number", () => {
      const state: SyncState = {
        mappings: [makeMapping(), makeMapping({ githubIssueNumber: 99 })],
      };
      removeMapping(state, "aibilitycz/aibility", 42);
      expect(state.mappings).toHaveLength(1);
      expect(state.mappings[0]?.githubIssueNumber).toBe(99);
    });

    it("does nothing when mapping not found", () => {
      const state: SyncState = { mappings: [makeMapping()] };
      removeMapping(state, "aibilitycz/aibility", 999);
      expect(state.mappings).toHaveLength(1);
    });
  });
});
