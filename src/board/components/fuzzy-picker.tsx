import { TextInput } from "@inkjs/ui";
import { Fzf } from "fzf";
import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import type { RepoData } from "../fetch.js";

interface FuzzyPickerIssue {
  readonly navId: string;
  readonly repoShortName: string;
  readonly number: number;
  readonly title: string;
  readonly labels: string;
  readonly assignee: string;
  readonly repoName: string;
}

interface FuzzyPickerProps {
  readonly repos: RepoData[];
  readonly onSelect: (navId: string) => void;
  readonly onClose: () => void;
}

function keepCursorVisible(cursor: number, offset: number, visible: number): number {
  if (cursor < offset) return cursor;
  if (cursor >= offset + visible) return cursor - visible + 1;
  return offset;
}

function FuzzyPicker({ repos, onSelect, onClose }: FuzzyPickerProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Flatten all issues from repos into a searchable list
  const allIssues = useMemo((): FuzzyPickerIssue[] => {
    const items: FuzzyPickerIssue[] = [];
    for (const rd of repos) {
      for (const issue of rd.issues) {
        items.push({
          navId: `gh:${rd.repo.name}:${issue.number}`,
          repoShortName: rd.repo.shortName,
          number: issue.number,
          title: issue.title,
          labels: issue.labels.map((l) => l.name).join(" "),
          assignee: (issue.assignees ?? []).map((a) => a.login).join(" "),
          repoName: rd.repo.name,
        });
      }
    }
    return items;
  }, [repos]);

  // Build fuzzy indexes (rebuilt only when allIssues changes, not on each keystroke)
  const fuzzyIndex = useMemo(
    () => ({
      byTitle: new Fzf(allIssues, {
        selector: (i: FuzzyPickerIssue) => i.title,
        casing: "smart-case",
      }),
      byRepo: new Fzf(allIssues, {
        selector: (i: FuzzyPickerIssue) => i.repoShortName,
        casing: "smart-case",
      }),
      byNum: new Fzf(allIssues, {
        selector: (i: FuzzyPickerIssue) => `#${String(i.number)}`,
        casing: "case-insensitive",
      }),
      byLabel: new Fzf(allIssues, {
        selector: (i: FuzzyPickerIssue) => i.labels,
        casing: "smart-case",
      }),
    }),
    [allIssues],
  );

  // Fuzzy search results (rebuilt on each query change)
  const results = useMemo((): FuzzyPickerIssue[] => {
    if (!query.trim()) return allIssues.slice(0, 20);

    const WEIGHTS = { title: 1.0, repo: 0.6, num: 2.0, label: 0.5 };
    const scoreMap = new Map<string, { item: FuzzyPickerIssue; score: number }>();

    function upsert(hits: { item: FuzzyPickerIssue; score: number }[], w: number) {
      for (const h of hits) {
        const s = h.score * w;
        const e = scoreMap.get(h.item.navId);
        if (!e || s > e.score) scoreMap.set(h.item.navId, { item: h.item, score: s });
      }
    }

    upsert(fuzzyIndex.byTitle.find(query), WEIGHTS.title);
    upsert(fuzzyIndex.byRepo.find(query), WEIGHTS.repo);
    upsert(fuzzyIndex.byNum.find(query), WEIGHTS.num);
    upsert(fuzzyIndex.byLabel.find(query), WEIGHTS.label);

    return [...scoreMap.values()].sort((a, b) => b.score - a.score).map((e) => e.item);
  }, [query, fuzzyIndex, allIssues]);

  const VISIBLE = Math.min(process.stdout.rows - 4, 15);

  // Internal keyboard navigation (Arrow keys, Ctrl-J/K, Enter, Escape)
  useInput((input, key) => {
    if (key.downArrow || (key.ctrl && input === "j")) {
      const newCursor = Math.min(cursor + 1, results.length - 1);
      setCursor(newCursor);
      setScrollOffset((prev) => keepCursorVisible(newCursor, prev, VISIBLE));
      return;
    }
    if (key.upArrow || (key.ctrl && input === "k")) {
      const newCursor = Math.max(cursor - 1, 0);
      setCursor(newCursor);
      setScrollOffset((prev) => keepCursorVisible(newCursor, prev, VISIBLE));
      return;
    }
    if (key.return) {
      const selected = results[cursor];
      if (selected) {
        onSelect(selected.navId);
      }
      return;
    }
    if (key.escape) {
      onClose();
    }
  });

  const visibleResults = results.slice(scrollOffset, scrollOffset + VISIBLE);
  const totalCount = results.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text color="cyan" bold>
          Find issue{" "}
        </Text>
        <Text color="gray">({totalCount} match{totalCount !== 1 ? "es" : ""}) </Text>
        <Text color="gray" dimColor>
          ↑↓/Ctrl-J/K nav  Enter:jump  Esc:close
        </Text>
      </Box>
      <Box>
        <Text color="yellow">{">"} </Text>
        <TextInput
          defaultValue={query}
          placeholder="type to search..."
          onChange={(v) => {
            setQuery(v);
            setCursor(0);
            setScrollOffset(0);
          }}
          onSubmit={() => {
            const selected = results[cursor];
            if (selected) onSelect(selected.navId);
          }}
        />
      </Box>
      {scrollOffset > 0 ? (
        <Text color="gray" dimColor>
          ▲ {scrollOffset} more above
        </Text>
      ) : null}
      {visibleResults.map((issue, idx) => {
        const isSelected = scrollOffset + idx === cursor;
        const labelStr = issue.labels ? ` [${issue.labels.split(" ").slice(0, 2).join("] [")}]` : "";
        const assigneeStr = issue.assignee ? ` @${issue.assignee.split(" ")[0]}` : "";
        return (
          <Box key={issue.navId}>
            {isSelected ? (
              <Text color="cyan" bold>
                {">"} {issue.repoShortName}#{issue.number} {issue.title}
                {labelStr}
                {assigneeStr}
              </Text>
            ) : (
              <Text>
                {"  "}
                {issue.repoShortName}#{issue.number} {issue.title}
                {labelStr}
                {assigneeStr}
              </Text>
            )}
          </Box>
        );
      })}
      {totalCount === 0 ? (
        <Text dimColor>No issues match &quot;{query}&quot;</Text>
      ) : null}
      {results.length > scrollOffset + VISIBLE ? (
        <Text color="gray" dimColor>
          ▼ {results.length - scrollOffset - VISIBLE} more below
        </Text>
      ) : null}
    </Box>
  );
}

export { FuzzyPicker };
export type { FuzzyPickerProps };
