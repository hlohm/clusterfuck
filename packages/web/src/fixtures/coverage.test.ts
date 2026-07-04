import { describe, expect, it } from 'vitest'
import { validateCluster } from '@clusterfuck/shared'
import type { DeviceState, FolderState, FolderType } from '@clusterfuck/shared'
import { FIXTURE_CLUSTERS } from './index'

const ALL_FOLDER_TYPES: FolderType[] = [
  'sendreceive',
  'sendonly',
  'receiveonly',
  'receiveencrypted',
]

const ALL_FOLDER_STATES: FolderState[] = [
  'idle',
  'scanning',
  'syncing',
  'paused',
  'error',
  'out-of-sync',
]

const ALL_DEVICE_STATES: DeviceState[] = ['this-device', 'connected', 'disconnected', 'paused']

describe('fixture clusters', () => {
  it('are each internally valid', () => {
    for (const cluster of FIXTURE_CLUSTERS) {
      expect(validateCluster(cluster), `cluster "${cluster.id}"`).toEqual([])
    }
  })

  it('collectively cover every folder type', () => {
    const seen = new Set(FIXTURE_CLUSTERS.flatMap((c) => c.shares.map((s) => s.type)))
    for (const type of ALL_FOLDER_TYPES) {
      expect(seen.has(type), `missing folder type "${type}"`).toBe(true)
    }
  })

  it('collectively cover every folder state', () => {
    const seen = new Set(FIXTURE_CLUSTERS.flatMap((c) => c.shares.map((s) => s.state)))
    for (const state of ALL_FOLDER_STATES) {
      expect(seen.has(state), `missing folder state "${state}"`).toBe(true)
    }
  })

  it('collectively cover every device state', () => {
    const seen = new Set(FIXTURE_CLUSTERS.flatMap((c) => c.devices.map((d) => d.state)))
    for (const state of ALL_DEVICE_STATES) {
      expect(seen.has(state), `missing device state "${state}"`).toBe(true)
    }
  })

  it('include at least one folder shared by 3+ devices', () => {
    const hasWideShare = FIXTURE_CLUSTERS.some((cluster) =>
      cluster.folders.some(
        (folder) => cluster.shares.filter((s) => s.folderId === folder.id).length >= 3,
      ),
    )
    expect(hasWideShare).toBe(true)
  })

  it('include at least one receiveencrypted share', () => {
    const hasEncrypted = FIXTURE_CLUSTERS.some((cluster) =>
      cluster.shares.some((s) => s.type === 'receiveencrypted'),
    )
    expect(hasEncrypted).toBe(true)
  })
})
