import { describe, expect, it } from "vitest";
import { extractStoryIds, isParallelizablePhase, splitIntoChunks } from "./story-splitter.js";

describe("story-splitter", () => {
  describe("splitIntoChunks", () => {
    it("splits 10 stories into 3 chunks", () => {
      const ids = Array.from({ length: 10 }, (_, i) => `STORY-${String(i + 1).padStart(3, "0")}`);
      const chunks = splitIntoChunks(ids, 3, "impl");

      expect(chunks).toHaveLength(3);
      expect(chunks[0]!.storyIds).toHaveLength(4); // ceil(10/3)
      expect(chunks[1]!.storyIds).toHaveLength(4);
      expect(chunks[2]!.storyIds).toHaveLength(2);

      // All stories accounted for
      const allIds = chunks.flatMap((c) => c.storyIds);
      expect(allIds).toHaveLength(10);
    });

    it("creates one chunk per story when fewer than maxChunks", () => {
      const ids = ["STORY-001", "STORY-002"];
      const chunks = splitIntoChunks(ids, 5, "test");

      expect(chunks).toHaveLength(2);
      expect(chunks[0]!.storyIds).toEqual(["STORY-001"]);
      expect(chunks[1]!.storyIds).toEqual(["STORY-002"]);
    });

    it("returns empty for no stories", () => {
      expect(splitIntoChunks([], 3, "impl")).toEqual([]);
    });

    it("includes scope instruction for test phase", () => {
      const chunks = splitIntoChunks(["STORY-001", "STORY-002"], 2, "test");
      expect(chunks[0]!.scopeInstruction).toContain("STORY-001");
      expect(chunks[0]!.scopeInstruction).toContain("Write tests ONLY");
    });

    it("includes scope instruction for impl phase", () => {
      const chunks = splitIntoChunks(["STORY-001", "STORY-002"], 2, "impl");
      expect(chunks[0]!.scopeInstruction).toContain("STORY-001");
      expect(chunks[0]!.scopeInstruction).toContain("Implement code ONLY");
    });

    it("labels multi-story chunks with range", () => {
      const ids = Array.from({ length: 6 }, (_, i) => `STORY-${String(i + 1).padStart(3, "0")}`);
      const chunks = splitIntoChunks(ids, 2, "impl");
      expect(chunks[0]!.label).toBe("STORY-001–STORY-003");
      expect(chunks[1]!.label).toBe("STORY-004–STORY-006");
    });
  });

  describe("isParallelizablePhase", () => {
    it("returns true for test and impl", () => {
      expect(isParallelizablePhase("test")).toBe(true);
      expect(isParallelizablePhase("impl")).toBe(true);
    });

    it("returns false for other phases", () => {
      expect(isParallelizablePhase("brainstorm")).toBe(false);
      expect(isParallelizablePhase("stories")).toBe(false);
      expect(isParallelizablePhase("redteam")).toBe(false);
      expect(isParallelizablePhase("merge")).toBe(false);
    });
  });
});
