import { describe, expect, it } from 'vitest'
import { collectConflictPaths } from './conflicts.ts'
import type { DbBrowseItem } from './syncthing/types.ts'

const FILE = 'FILE_INFO_TYPE_FILE'
const DIR = 'FILE_INFO_TYPE_DIRECTORY'

describe('collectConflictPaths', () => {
  it('finds conflict copies at any depth, as folder-relative paths', () => {
    const tree: DbBrowseItem[] = [
      { name: 'notes.txt', type: FILE },
      { name: 'notes.sync-conflict-20260701-093015-ABCDEF1.txt', type: FILE },
      {
        name: 'sub',
        type: DIR,
        children: [
          { name: 'report.sync-conflict-20260630-120000-XYZXYZ9.pdf', type: FILE },
          { name: 'deeper', type: DIR, children: [{ name: 'ok.txt', type: FILE }] },
        ],
      },
    ]

    expect(collectConflictPaths(tree)).toEqual([
      'notes.sync-conflict-20260701-093015-ABCDEF1.txt',
      'sub/report.sync-conflict-20260630-120000-XYZXYZ9.pdf',
    ])
  })

  it('requires the full date-time marker — mentioning sync-conflict is not enough', () => {
    const tree: DbBrowseItem[] = [
      { name: 'how-to-handle-a.sync-conflict-file.md', type: FILE },
      { name: 'sync-conflict-notes.txt', type: FILE },
    ]

    expect(collectConflictPaths(tree)).toEqual([])
  })

  it('descends into a conflict-named directory but does not report the directory itself', () => {
    const tree: DbBrowseItem[] = [
      {
        name: 'weird.sync-conflict-20260701-093015-ABCDEF1',
        type: DIR,
        children: [{ name: 'inner.sync-conflict-20260701-093015-ABCDEF1.txt', type: FILE }],
      },
    ]

    expect(collectConflictPaths(tree)).toEqual([
      'weird.sync-conflict-20260701-093015-ABCDEF1/inner.sync-conflict-20260701-093015-ABCDEF1.txt',
    ])
  })

  it('returns empty for an empty tree', () => {
    expect(collectConflictPaths([])).toEqual([])
  })
})
