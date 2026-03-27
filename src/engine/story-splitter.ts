/**
 * Story Splitter — divides pipeline work into parallel chunks.
 *
 * Reads the stories file, extracts story IDs, and groups them
 * into chunks for parallel agent execution.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface StoryChunk {
  /** Story IDs in this chunk (e.g., ["STORY-001", "STORY-002", "STORY-003"]). */
  readonly storyIds: string[];
  /** Human-readable label for this chunk. */
  readonly label: string;
  /** Prompt suffix scoping the agent to these stories. */
  readonly scopeInstruction: string;
}

const STORY_ID_RE = /STORY-\d{3,}/g;

/** Extract all story IDs from a stories file. */
export function extractStoryIds(storiesPath: string): string[] {
  if (!existsSync(storiesPath)) return [];
  try {
    const content = readFileSync(storiesPath, "utf-8");
    const matches = content.match(STORY_ID_RE);
    return [...new Set(matches ?? [])].sort();
  } catch {
    return [];
  }
}

/**
 * Find the stories file for a pipeline by searching common locations.
 * Returns the full path if found, undefined otherwise.
 */
export function findStoriesFile(localPath: string, slug: string): string | undefined {
  const candidates = [
    join(localPath, "docs", "stories", `${slug}.md`),
    join(localPath, "docs", "stories"),
    join(localPath, "tests", "stories", `${slug}.md`),
    join(localPath, "tests", "stories"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // If it's a directory, look for any .md file
      if (candidate.endsWith("stories")) {
        const { readdirSync } = require("node:fs") as typeof import("node:fs");
        try {
          const files = readdirSync(candidate).filter(
            (f: string) => f.endsWith(".md") && !f.endsWith(".architecture.md"),
          );
          if (files.length > 0) return join(candidate, files[0]!);
        } catch {
          continue;
        }
      }
      return candidate;
    }
  }
  return undefined;
}

/**
 * Split stories into chunks for parallel execution.
 *
 * @param storyIds - All story IDs to distribute
 * @param maxChunks - Maximum number of parallel chunks (typically maxConcurrentAgents)
 * @param phase - The phase name (for prompt construction)
 * @returns Array of StoryChunks, each with scoped instructions
 */
export function splitIntoChunks(
  storyIds: string[],
  maxChunks: number,
  phase: "test" | "impl",
): StoryChunk[] {
  if (storyIds.length === 0) return [];
  if (storyIds.length <= maxChunks) {
    // Fewer stories than chunks — one story per chunk
    return storyIds.map((id) => ({
      storyIds: [id],
      label: id,
      scopeInstruction: buildScopeInstruction([id], phase),
    }));
  }

  // Distribute evenly across chunks
  const chunkSize = Math.ceil(storyIds.length / maxChunks);
  const chunks: StoryChunk[] = [];

  for (let i = 0; i < storyIds.length; i += chunkSize) {
    const ids = storyIds.slice(i, i + chunkSize);
    const first = ids[0]!;
    const last = ids[ids.length - 1]!;
    chunks.push({
      storyIds: ids,
      label: ids.length === 1 ? first : `${first}–${last}`,
      scopeInstruction: buildScopeInstruction(ids, phase),
    });
  }

  return chunks;
}

function buildScopeInstruction(storyIds: string[], phase: "test" | "impl"): string {
  const idList = storyIds.join(", ");
  if (phase === "test") {
    return `\n\nIMPORTANT: You are only responsible for stories: ${idList}.\nWrite tests ONLY for these stories. Other stories are handled by parallel agents.`;
  }
  return `\n\nIMPORTANT: You are only responsible for tests matching stories: ${idList}.\nImplement code ONLY for these tests. Other tests are handled by parallel agents.`;
}

/** Check if a phase supports parallel execution. */
export function isParallelizablePhase(phase: string): boolean {
  return phase === "test" || phase === "impl";
}
