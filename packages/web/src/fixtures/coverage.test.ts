import { describe, expect, it } from 'vitest'
import { detectDrift, syncthingMajors, validateCluster } from '@clusterfuck/shared'
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

  it('include advanced options covering both watcher on and watcher off', () => {
    const advanced = FIXTURE_CLUSTERS.flatMap((c) => c.shares.flatMap((s) => s.advanced ?? []))
    expect(advanced.some((a) => a.fsWatcherEnabled)).toBe(true)
    expect(advanced.some((a) => !a.fsWatcherEnabled)).toBe(true)
  })

  it('include at least one connection with a live transfer rate', () => {
    const hasRate = FIXTURE_CLUSTERS.some((c) =>
      c.connections.some((conn) => conn.inBps !== undefined && conn.outBps !== undefined),
    )
    expect(hasRate).toBe(true)
  })

  it('include at least one share with failed items', () => {
    const hasFailed = FIXTURE_CLUSTERS.some((c) => c.shares.some((s) => (s.failedItems ?? 0) > 0))
    expect(hasFailed).toBe(true)
  })

  it('include config drift at both severities, so the drift section is explorable', () => {
    const findings = FIXTURE_CLUSTERS.flatMap(detectDrift)
    expect(findings.some((f) => f.severity === 'warning')).toBe(true)
    expect(findings.some((f) => f.severity === 'info')).toBe(true)
  })

  it('include a cluster with mixed Syncthing majors, so mid-migration rendering is explorable', () => {
    // ROADMAP "Syncthing 2.x support": per-node detection exists because a
    // cluster is temporarily mixed 1.x/2.x during a rolling upgrade — a
    // fixture must keep the mixed-major hint and version chips reachable.
    const hasMixed = FIXTURE_CLUSTERS.some((c) => syncthingMajors(c).length > 1)
    expect(hasMixed).toBe(true)
  })

  it('include at least one receiveencrypted share', () => {
    const hasEncrypted = FIXTURE_CLUSTERS.some((cluster) =>
      cluster.shares.some((s) => s.type === 'receiveencrypted'),
    )
    expect(hasEncrypted).toBe(true)
  })
})
