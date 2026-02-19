import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendActionLog,
  clearActionLog,
  getActionLog,
  type PersistedLogEntry,
} from "./log-persistence.js";

// The module writes to $HOME/.config/hog/action-log.json.
// We redirect LOG_FILE by mocking the fs module functions that operate on it.

const LOG_FILE = join(homedir(), ".config", "hog", "action-log.json");

function makeEntry(id: string, overrides: Partial<PersistedLogEntry> = {}): PersistedLogEntry {
  return {
    id,
    description: `Action ${id}`,
    status: "success",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("log-persistence", () => {
  // Back up and restore the real log file around each test so we do not
  // pollute the developer's actual log file.
  let originalContents: string | null = null;

  beforeEach(() => {
    if (existsSync(LOG_FILE)) {
      originalContents = require("node:fs").readFileSync(LOG_FILE, "utf-8") as string;
    } else {
      originalContents = null;
    }
  });

  afterEach(() => {
    if (originalContents !== null) {
      const dir = join(homedir(), ".config", "hog");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(LOG_FILE, originalContents, "utf-8");
    } else if (existsSync(LOG_FILE)) {
      unlinkSync(LOG_FILE);
    }
    vi.restoreAllMocks();
  });

  describe("appendActionLog", () => {
    it("creates the log file and stores the first entry", () => {
      // Ensure no pre-existing file
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      const entry = makeEntry("first");
      appendActionLog(entry);

      const stored = getActionLog(100);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe("first");
    });

    it("appends multiple entries in order", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      appendActionLog(makeEntry("a"));
      appendActionLog(makeEntry("b"));
      appendActionLog(makeEntry("c"));

      const stored = getActionLog(100);
      expect(stored.map((e) => e.id)).toEqual(["a", "b", "c"]);
    });

    it("truncates the file and writes only the new entry when size exceeds MAX_SIZE_BYTES", () => {
      // Simulate a file that is already over 10 MB
      const dir = join(homedir(), ".config", "hog");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      // Write more than 10 MB of content so statSync reports size > MAX_SIZE_BYTES
      const bigContent = "x".repeat(10 * 1024 * 1024 + 1);
      writeFileSync(LOG_FILE, bigContent, "utf-8");

      const entry = makeEntry("after-truncate");
      appendActionLog(entry);

      // The file was truncated before reading, so only the new entry should be present
      const stored = getActionLog(100);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe("after-truncate");
    });

    it("drops oldest entries when MAX_ENTRIES (1000) is exceeded", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      // Write 1000 entries directly
      const entries: PersistedLogEntry[] = Array.from({ length: 1000 }, (_, i) =>
        makeEntry(`entry-${i}`),
      );
      writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), "utf-8");

      // Appending one more should rotate out the oldest
      const newEntry = makeEntry("entry-1000");
      appendActionLog(newEntry);

      const stored = getActionLog(1001);
      expect(stored).toHaveLength(1000);
      // The very first entry should have been evicted
      expect(stored.find((e) => e.id === "entry-0")).toBeUndefined();
      // The new entry should be last
      expect(stored[stored.length - 1]?.id).toBe("entry-1000");
    });
  });

  describe("getActionLog", () => {
    it("returns an empty array when the log file does not exist", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);
      expect(getActionLog()).toEqual([]);
    });

    it("returns an empty array when the log file contains malformed JSON", () => {
      const dir = join(homedir(), ".config", "hog");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(LOG_FILE, "not valid json {{{", "utf-8");

      expect(getActionLog()).toEqual([]);
    });

    it("returns an empty array when the log file contains non-array JSON", () => {
      const dir = join(homedir(), ".config", "hog");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(LOG_FILE, JSON.stringify({ foo: "bar" }), "utf-8");

      expect(getActionLog()).toEqual([]);
    });

    it("returns the last N entries when limit is specified", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      for (let i = 0; i < 10; i++) appendActionLog(makeEntry(`e${i}`));

      const result = getActionLog(3);
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe("e7");
      expect(result[1]?.id).toBe("e8");
      expect(result[2]?.id).toBe("e9");
    });

    it("returns all entries when limit exceeds stored count", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      appendActionLog(makeEntry("only-one"));
      const result = getActionLog(999);
      expect(result).toHaveLength(1);
    });

    it("defaults to returning last 50 entries", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      // Write 60 entries
      const entries: PersistedLogEntry[] = Array.from({ length: 60 }, (_, i) => makeEntry(`e${i}`));
      writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), "utf-8");

      const result = getActionLog();
      expect(result).toHaveLength(50);
      expect(result[0]?.id).toBe("e10");
      expect(result[49]?.id).toBe("e59");
    });
  });

  describe("clearActionLog", () => {
    it("writes an empty array to the log file", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      appendActionLog(makeEntry("to-be-cleared"));
      expect(getActionLog(100)).toHaveLength(1);

      clearActionLog();

      expect(getActionLog(100)).toEqual([]);
    });

    it("creates the log file with an empty array even if it did not exist", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      clearActionLog();

      expect(existsSync(LOG_FILE)).toBe(true);
      expect(getActionLog()).toEqual([]);
    });

    it("removes all entries from a non-empty log", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      for (let i = 0; i < 5; i++) appendActionLog(makeEntry(`e${i}`));
      expect(getActionLog(100)).toHaveLength(5);

      clearActionLog();

      expect(getActionLog(100)).toEqual([]);
    });

    it("subsequent getActionLog after clearActionLog returns empty regardless of limit", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);
      appendActionLog(makeEntry("x"));
      clearActionLog();

      expect(getActionLog(1)).toEqual([]);
      expect(getActionLog(0)).toEqual([]);
    });
  });

  describe("appendActionLog — size check branch", () => {
    it("does not call truncateSync when file is under MAX_SIZE_BYTES", () => {
      if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE);

      // Write a small file
      const dir = join(homedir(), ".config", "hog");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(LOG_FILE, JSON.stringify([makeEntry("small")], null, 2), "utf-8");

      const sizeBefore = statSync(LOG_FILE).size;
      expect(sizeBefore).toBeLessThan(10 * 1024 * 1024);

      // Appending should keep existing entries intact (no truncation)
      appendActionLog(makeEntry("added"));
      const stored = getActionLog(100);
      expect(stored.find((e) => e.id === "small")).toBeDefined();
      expect(stored.find((e) => e.id === "added")).toBeDefined();
    });
  });
});
