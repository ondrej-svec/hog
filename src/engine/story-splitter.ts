/**
 * Story Splitter — divides pipeline work into parallel chunks.
 *
 * Reads the stories file, extracts story IDs, groups them into chunks,
 * and writes filtered stories files so each agent sees only its stories.
 *
 * Key principle: the orchestrator prepares inputs. Skills stay standalone.
 * Each parallel agent gets a filtered stories file — the skill doesn't
 * know or care about parallelism.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StoryChunk {
  /** Story IDs in this chunk (e.g., ["STORY-001", "STORY-002", "STORY-003"]). */
  readonly storyIds: string[];
  /** Human-readable label for this chunk. */
  readonly label: string;
  /** Path to a filtered stories file containing only this chunk's stories. */
  readonly filteredStoriesPath: string;
}

const STORY_ID_RE = /STORY-\d{3,}/g;
const STORY_SECTION_RE = /^## STORY-\d{3,}/;

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
 * Write a filtered stories file containing only the specified story sections.
 *
 * Parses the markdown by `## STORY-NNN` headings. Everything before the first
 * story heading (title, preamble) is included in every filtered file. Each
 * `## STORY-NNN` section is included only if its ID is in the storyIds list.
 */
export function writeFilteredStories(
  fullStoriesPath: string,
  storyIds: Set<string>,
  outputPath: string,
): void {
  const content = readFileSync(fullStoriesPath, "utf-8");
  const lines = content.split("\n");

  const preambleLines: string[] = [];
  const sections: Array<{ id: string; lines: string[] }> = [];
  let currentSection: { id: string; lines: string[] } | undefined;

  for (const line of lines) {
    if (STORY_SECTION_RE.test(line)) {
      // Start of a new story section
      if (currentSection) sections.push(currentSection);
      const idMatch = line.match(STORY_ID_RE);
      currentSection = { id: idMatch?.[0] ?? "UNKNOWN", lines: [line] };
    } else if (currentSection) {
      currentSection.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  // Build filtered content: preamble + matching sections
  const filtered = [
    ...preambleLines,
    ...sections.filter((s) => storyIds.has(s.id)).flatMap((s) => s.lines),
  ].join("\n");

  const dir = join(outputPath, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, filtered, "utf-8");
}

/**
 * Split stories into chunks for parallel execution.
 * Writes a filtered stories file for each chunk.
 *
 * @param storiesPath - Path to the full stories file
 * @param storyIds - All story IDs to distribute
 * @param maxChunks - Maximum number of parallel chunks
 * @param outputDir - Directory for filtered stories files (e.g., .hog/parallel/)
 * @param phase - The phase name (for file naming)
 */
export function splitIntoChunks(
  storiesPath: string,
  storyIds: string[],
  maxChunks: number,
  outputDir: string,
  phase: string,
): StoryChunk[] {
  if (storyIds.length === 0) return [];

  mkdirSync(outputDir, { recursive: true });

  const distribute = (ids: string[], index: number): StoryChunk => {
    const first = ids[0]!;
    const last = ids[ids.length - 1]!;
    const filteredPath = join(outputDir, `${phase}-${index}-stories.md`);
    writeFilteredStories(storiesPath, new Set(ids), filteredPath);
    return {
      storyIds: ids,
      label: ids.length === 1 ? first : `${first}–${last}`,
      filteredStoriesPath: filteredPath,
    };
  };

  if (storyIds.length <= maxChunks) {
    return storyIds.map((id, i) => distribute([id], i));
  }

  const chunkSize = Math.ceil(storyIds.length / maxChunks);
  const chunks: StoryChunk[] = [];

  for (let i = 0; i < storyIds.length; i += chunkSize) {
    const ids = storyIds.slice(i, i + chunkSize);
    chunks.push(distribute(ids, chunks.length));
  }

  return chunks;
}

/**
 * Clean up filtered stories files after a phase completes.
 */
export function cleanupParallelFiles(localPath: string): void {
  const dir = join(localPath, ".hog", "parallel");
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Check if a phase supports parallel execution. */
export function isParallelizablePhase(phase: string): boolean {
  return phase === "test";
}
