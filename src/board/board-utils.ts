/**
 * Shared nav-ID helpers for the board TUI.
 *
 * A GitHub issue nav ID has the shape `gh:<repoName>:<issueNumber>`.
 * These utilities centralise construction, parsing, and lookup so the
 * pattern is not duplicated across components and hooks.
 */

import type { GitHubIssue } from "../github.js";
import type { RepoData } from "./fetch.js";

/** Build the canonical nav ID for a GitHub issue. */
export function makeIssueNavId(repoName: string, issueNumber: number): string {
  return `gh:${repoName}:${issueNumber}`;
}

/** Parse a nav ID into its repo name and issue number, or return null. */
export function parseIssueNavId(
  navId: string | null,
): { repoName: string; issueNumber: number } | null {
  if (!navId?.startsWith("gh:")) return null;
  const parts = navId.split(":");
  if (parts.length < 3) return null;
  const num = Number(parts[2]);
  return Number.isNaN(num) ? null : { repoName: parts[1] as string, issueNumber: num };
}

/** Find a GitHub issue (and its repo name) inside `repos` by nav ID. */
export function findIssueByNavId(
  repos: RepoData[],
  navId: string | null,
): { issue: GitHubIssue; repoName: string } | null {
  if (!navId?.startsWith("gh:")) return null;
  for (const rd of repos) {
    for (const issue of rd.issues) {
      if (makeIssueNavId(rd.repo.name, issue.number) === navId) {
        return { issue, repoName: rd.repo.name };
      }
    }
  }
  return null;
}
