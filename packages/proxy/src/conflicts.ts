import type { DbBrowseItem } from './syncthing/types.ts'

/**
 * Matches Syncthing's conflict-copy naming: when both sides changed a file it
 * keeps one version and renames the other to
 * `<stem>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<device>` (extension preserved
 * after the marker). Anchoring on the full date-time shape avoids false
 * positives on files that merely contain the words "sync-conflict".
 */
const CONFLICT_MARKER = /\.sync-conflict-\d{8}-\d{6}-/

/**
 * Walks a /rest/db/browse tree and collects the folder-relative paths of all
 * conflict copies. Only files count — a directory can't be a conflict copy —
 * but the walk still descends into every directory, whatever its name.
 */
export function collectConflictPaths(items: DbBrowseItem[], prefix = ''): string[] {
  const paths: string[] = []
  for (const item of items) {
    const path = prefix === '' ? item.name : `${prefix}/${item.name}`
    if (item.children !== undefined) {
      paths.push(...collectConflictPaths(item.children, path))
    } else if (CONFLICT_MARKER.test(item.name)) {
      paths.push(path)
    }
  }
  return paths
}
