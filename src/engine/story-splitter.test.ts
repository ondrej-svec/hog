import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractStoryIds, findStoriesFile } from "./story-splitter.js";

describe("story-splitter", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hog-split-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("extractStoryIds", () => {
    it("extracts unique sorted story IDs from a file", () => {
      const path = join(tempDir, "stories.md");
      writeFileSync(path, "## STORY-003\ntext\n## STORY-001\ntext\n## STORY-001\n");
      expect(extractStoryIds(path)).toEqual(["STORY-001", "STORY-003"]);
    });

    it("returns empty for missing file", () => {
      expect(extractStoryIds("/nonexistent/path.md")).toEqual([]);
    });

    it("returns empty for file with no story IDs", () => {
      const path = join(tempDir, "empty.md");
      writeFileSync(path, "# Just a title\nSome text.\n");
      expect(extractStoryIds(path)).toEqual([]);
    });
  });

  describe("findStoriesFile", () => {
    it("finds stories file by slug", () => {
      const storiesDir = join(tempDir, "docs", "stories");
      mkdirSync(storiesDir, { recursive: true });
      writeFileSync(join(storiesDir, "my-feature.md"), "stories");

      expect(findStoriesFile(tempDir, "my-feature")).toBe(join(storiesDir, "my-feature.md"));
    });

    it("finds first .md file in stories directory", () => {
      const storiesDir = join(tempDir, "docs", "stories");
      mkdirSync(storiesDir, { recursive: true });
      writeFileSync(join(storiesDir, "alpha.md"), "stories");

      expect(findStoriesFile(tempDir, "nonexistent-slug")).toBe(join(storiesDir, "alpha.md"));
    });

    it("returns undefined when nothing found", () => {
      expect(findStoriesFile(tempDir, "missing")).toBeUndefined();
    });
  });
});
