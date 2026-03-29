import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupParallelFiles,
  extractStoryIds,
  isParallelizablePhase,
  splitIntoChunks,
  writeFilteredStories,
} from "./story-splitter.js";

describe("story-splitter", () => {
  let tempDir: string;
  let storiesPath: string;

  const SAMPLE_STORIES = `# Feature Stories

## STORY-001: User can sign up

### Acceptance Criteria
- [ ] User provides email and password

## STORY-002: User can log in

### Acceptance Criteria
- [ ] User enters credentials

## STORY-003: User can reset password

### Acceptance Criteria
- [ ] User clicks forgot password
`;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hog-split-"));
    storiesPath = join(tempDir, "stories.md");
    writeFileSync(storiesPath, SAMPLE_STORIES);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("writeFilteredStories", () => {
    it("includes preamble and only matching story sections", () => {
      const outputPath = join(tempDir, "filtered.md");
      writeFilteredStories(storiesPath, new Set(["STORY-001", "STORY-003"]), outputPath);

      const content = readFileSync(outputPath, "utf-8");
      expect(content).toContain("# Feature Stories");
      expect(content).toContain("## STORY-001");
      expect(content).toContain("## STORY-003");
      expect(content).not.toContain("## STORY-002");
    });

    it("writes only preamble when no stories match", () => {
      const outputPath = join(tempDir, "filtered.md");
      writeFilteredStories(storiesPath, new Set(["STORY-999"]), outputPath);

      const content = readFileSync(outputPath, "utf-8");
      expect(content).toContain("# Feature Stories");
      expect(content).not.toContain("## STORY-");
    });
  });

  describe("splitIntoChunks", () => {
    it("splits 3 stories into 2 chunks with filtered files", () => {
      const outputDir = join(tempDir, "parallel");
      const chunks = splitIntoChunks(storiesPath, ["STORY-001", "STORY-002", "STORY-003"], 2, outputDir, "test");

      expect(chunks).toHaveLength(2);
      expect(chunks[0]!.storyIds).toEqual(["STORY-001", "STORY-002"]);
      expect(chunks[1]!.storyIds).toEqual(["STORY-003"]);

      // Each chunk has a filtered file
      const content0 = readFileSync(chunks[0]!.filteredStoriesPath, "utf-8");
      expect(content0).toContain("## STORY-001");
      expect(content0).toContain("## STORY-002");
      expect(content0).not.toContain("## STORY-003");

      const content1 = readFileSync(chunks[1]!.filteredStoriesPath, "utf-8");
      expect(content1).toContain("## STORY-003");
      expect(content1).not.toContain("## STORY-001");
    });

    it("creates one chunk per story when fewer than maxChunks", () => {
      const outputDir = join(tempDir, "parallel");
      const chunks = splitIntoChunks(storiesPath, ["STORY-001", "STORY-002"], 5, outputDir, "test");

      expect(chunks).toHaveLength(2);
      expect(chunks[0]!.storyIds).toEqual(["STORY-001"]);
      expect(chunks[1]!.storyIds).toEqual(["STORY-002"]);
    });

    it("returns empty for no stories", () => {
      const outputDir = join(tempDir, "parallel");
      expect(splitIntoChunks(storiesPath, [], 3, outputDir, "test")).toEqual([]);
    });

    it("labels multi-story chunks with range", () => {
      const outputDir = join(tempDir, "parallel");
      const chunks = splitIntoChunks(storiesPath, ["STORY-001", "STORY-002", "STORY-003"], 2, outputDir, "test");
      expect(chunks[0]!.label).toBe("STORY-001–STORY-002");
      expect(chunks[1]!.label).toBe("STORY-003");
    });
  });

  describe("cleanupParallelFiles", () => {
    it("removes .hog/parallel/ directory", () => {
      const dir = join(tempDir, ".hog", "parallel");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "test.md"), "test");

      cleanupParallelFiles(tempDir);

      const { existsSync } = require("node:fs") as typeof import("node:fs");
      expect(existsSync(dir)).toBe(false);
    });
  });

  describe("isParallelizablePhase", () => {
    it("returns true only for test phase", () => {
      expect(isParallelizablePhase("test")).toBe(true);
    });

    it("returns false for all other phases", () => {
      expect(isParallelizablePhase("impl")).toBe(false);
      expect(isParallelizablePhase("brainstorm")).toBe(false);
      expect(isParallelizablePhase("redteam")).toBe(false);
    });
  });
});
