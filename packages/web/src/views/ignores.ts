import type { NodeIgnorePatterns } from '@clusterfuck/shared'

/**
 * Pure helpers for the ignore-patterns editor. `.stignore` is edited as free
 * text in a textarea but stored/sent as a line array, and the "diff across
 * nodes" indicator is a set-comparison — both kept here so they're testable
 * without the component.
 */

/** Line array → textarea text. */
export function patternsToText(patterns: string[]): string {
  return patterns.join('\n')
}

/**
 * Textarea text → line array. Drops the trailing empty line(s) a textarea
 * leaves (so a final newline doesn't become a stray empty pattern), but keeps
 * internal blank lines and comments verbatim — Syncthing tolerates them and
 * round-tripping them avoids spurious cross-node diffs.
 */
export function textToPatterns(text: string): string[] {
  const lines = text.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Whether the readable nodes disagree on their patterns. Nodes that errored
 * are excluded (we don't know their patterns, so we can't call them different);
 * fewer than two readable nodes can't disagree.
 */
export function ignoresDiffer(nodes: NodeIgnorePatterns[]): boolean {
  const readable = nodes.filter((n) => n.error === undefined)
  if (readable.length < 2) return false
  const distinct = new Set(readable.map((n) => JSON.stringify(n.patterns)))
  return distinct.size > 1
}
