import { describe, expect, it } from 'vitest'
import { ChangeBuffer, mapDiskEvent } from './changes.ts'
import type { RecentChange } from '@clusterfuck/shared'

describe('mapDiskEvent', () => {
  it('maps a local change, reading folderID with a fallback to folder', () => {
    const change = mapDiskEvent(
      {
        id: 1,
        type: 'LocalChangeDetected',
        time: '2026-07-06T10:00:00Z',
        data: { action: 'modified', folderID: 'f1', label: 'F1', path: 'docs/a.txt', type: 'file' },
      },
      'DEVICE-A',
    )
    expect(change).toEqual({
      nodeId: 'DEVICE-A',
      folderId: 'f1',
      path: 'docs/a.txt',
      action: 'modified',
      itemType: 'file',
      origin: 'local',
      modifiedBy: undefined,
      time: '2026-07-06T10:00:00Z',
    })

    const viaFolderKey = mapDiskEvent(
      {
        id: 2,
        type: 'LocalChangeDetected',
        time: '2026-07-06T10:00:00Z',
        data: { action: 'deleted', folder: 'f2', path: 'b.txt', type: 'file' },
      },
      'DEVICE-A',
    )
    expect(viaFolderKey?.folderId).toBe('f2')
  })

  it('maps a remote change with its origin device', () => {
    const change = mapDiskEvent(
      {
        id: 3,
        type: 'RemoteChangeDetected',
        time: '2026-07-06T10:01:00Z',
        data: { action: 'added', folderID: 'f1', path: 'c.txt', type: 'file', modifiedBy: 'DEVICE-B' },
      },
      'DEVICE-A',
    )
    expect(change?.origin).toBe('remote')
    expect(change?.modifiedBy).toBe('DEVICE-B')
  })

  it('skips event types that are not disk changes', () => {
    expect(
      mapDiskEvent({ id: 4, type: 'StateChanged', time: 't', data: {} }, 'DEVICE-A'),
    ).toBeUndefined()
  })
})

describe('ChangeBuffer', () => {
  const change = (path: string): RecentChange => ({
    nodeId: 'DEVICE-A',
    folderId: 'f1',
    path,
    action: 'modified',
    itemType: 'file',
    origin: 'local',
    time: 't',
  })

  it('returns newest first', () => {
    const buffer = new ChangeBuffer(10)
    buffer.push(change('one'))
    buffer.push(change('two'))
    expect(buffer.list().map((c) => c.path)).toEqual(['two', 'one'])
  })

  it('drops the oldest entries past its capacity', () => {
    const buffer = new ChangeBuffer(3)
    for (const p of ['a', 'b', 'c', 'd', 'e']) buffer.push(change(p))
    expect(buffer.list().map((c) => c.path)).toEqual(['e', 'd', 'c'])
  })
})
