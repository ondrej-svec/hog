/**
 * Story Splitter — utilities for working with stories files.
 *
 * Extracts story IDs, finds stories files by convention.
 * Parallelism is handled by the agent itself (via Claude Code's Agent tool),
 * not by the orchestrator — keeping hog simple and skills standalone.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
