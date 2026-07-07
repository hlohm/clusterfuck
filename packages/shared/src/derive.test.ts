import { describe, expect, it } from 'vitest'
import {
  clusterHealth,
  clusterTransferTotals,
  connectionsByDevice,
  deviceTransferTotals,
  folderHealth,
  folderHealthForDevice,
  sharesByDevice,
  sharesByFolder,
} from './derive.ts'
import type { ClusterModel } from './types.ts'

function cluster(): ClusterModel {
  return {
    id: 'c1',
    label: 'Test',
    devices: [
      { id: 'a', name: 'A', state: 'connected', managed: true },
      { id: 'b', name: 'B', state: 'connected', managed: true },
    ],
    folders: [
      { id: 'f1', label: 'Folder 1' },
      { id: 'f2', label: 'Folder 2' },
    ],
    shares: [
      { folderId: 'f1', deviceId: 'a', type: 'sendreceive', state: 'idle', sharedWith: ['a', 'b'] },
      { folderId: 'f2', deviceId: 'a', type: 'sendonly', state: 'error', sharedWith: ['a'] },
      { folderId: 'f1', deviceId: 'b', type: 'sendreceive', state: 'syncing', sharedWith: ['a', 'b'] },
    ],
    connections: [
      { deviceId: 'a', peerId: 'b', connected: true, inBytesTotal: 1000, outBytesTotal: 2000 },
      { deviceId: 'b', peerId: 'a', connected: true, inBytesTotal: 500, outBytesTotal: 250 },
    ],
    pendingDevices: [],
    pendingFolders: [],
  }
}

describe('sharesByFolder', () => {
  it('returns only shares for the given folder', () => {
    expect(sharesByFolder(cluster(), 'f1')).toHaveLength(2)
  })
})

describe('sharesByDevice', () => {
  it('returns only shares for the given device', () => {
    expect(sharesByDevice(cluster(), 'a')).toHaveLength(2)
  })
})

describe('folderHealth', () => {
  it('returns the worst state across a folder\'s shares', () => {
    expect(folderHealth(cluster(), 'f1')).toBe('syncing') // idle on a, syncing on b
    expect(folderHealth(cluster(), 'f2')).toBe('error')
  })

  it('returns undefined for a folder with no shares', () => {
    const c = cluster()
    c.folders.push({ id: 'f3', label: 'Folder 3' })
    expect(folderHealth(c, 'f3')).toBeUndefined()
  })
})

describe('clusterHealth', () => {
  it('rolls up device counts, folder worst-states, and attention shares', () => {
    const c = cluster()
    c.devices.push({ id: 'c', name: 'C', state: 'paused', managed: false })
    c.shares[1]!.outOfSyncItems = 7

    const health = clusterHealth(c)

    expect(health.deviceCounts).toEqual({
      'this-device': 0,
      connected: 2,
      disconnected: 0,
      paused: 1,
    })
    expect(health.folderCounts.syncing).toBe(1) // f1: idle + syncing -> syncing
    expect(health.folderCounts.error).toBe(1) // f2
    expect(health.outOfSyncItems).toBe(7)
    expect(health.attention).toHaveLength(1)
    expect(health.attention[0]!.state).toBe('error')
  })

  it('sums failed items across shares (0 when no share reports any)', () => {
    const c = cluster()
    expect(clusterHealth(c).failedItems).toBe(0)

    c.shares[1]!.failedItems = 3
    c.shares[2]!.failedItems = 2
    expect(clusterHealth(c).failedItems).toBe(5)
  })

  it('sorts attention shares worst-first', () => {
    const c = cluster()
    c.shares[0]!.state = 'paused'
    c.shares[2]!.state = 'out-of-sync'

    const states = clusterHealth(c).attention.map((s) => s.state)
    expect(states).toEqual(['error', 'out-of-sync', 'paused'])
  })
})

describe('folderHealthForDevice', () => {
  it('returns the worst folder state across a device\'s shares', () => {
    expect(folderHealthForDevice(cluster(), 'a')).toBe('error')
  })

  it('returns the only state when a device has one share', () => {
    expect(folderHealthForDevice(cluster(), 'b')).toBe('syncing')
  })

  it('returns undefined for a device with no shares', () => {
    const c = cluster()
    c.devices.push({ id: 'c', name: 'C', state: 'disconnected', managed: false })
    expect(folderHealthForDevice(c, 'c')).toBeUndefined()
  })
})

describe('connectionsByDevice', () => {
  it("returns only the given device's own reported connections, not the peer's separate row for the same link", () => {
    const connections = connectionsByDevice(cluster(), 'a')
    expect(connections).toHaveLength(1)
    expect(connections[0]).toEqual({
      deviceId: 'a',
      peerId: 'b',
      connected: true,
      inBytesTotal: 1000,
      outBytesTotal: 2000,
    })
  })

  it('returns an empty array for a device that reports no connections', () => {
    const c = cluster()
    c.devices.push({ id: 'c', name: 'C', state: 'disconnected', managed: false })
    expect(connectionsByDevice(c, 'c')).toEqual([])
  })
})

describe('deviceTransferTotals', () => {
  it("sums one device's own connections, not the peer's separate row for the same link", () => {
    expect(deviceTransferTotals(cluster(), 'a')).toEqual({ inBytesTotal: 1000, outBytesTotal: 2000 })
    expect(deviceTransferTotals(cluster(), 'b')).toEqual({ inBytesTotal: 500, outBytesTotal: 250 })
  })

  it('returns zero totals for a device with no reported connections', () => {
    const c = cluster()
    c.devices.push({ id: 'c', name: 'C', state: 'disconnected', managed: false })
    expect(deviceTransferTotals(c, 'c')).toEqual({ inBytesTotal: 0, outBytesTotal: 0 })
  })
})

describe('clusterTransferTotals', () => {
  it("sums every connection's own reported bytes, counting a link between two managed nodes from both ends", () => {
    // a→b reports 1000 in / 2000 out; b→a (the SAME physical link, from the
    // other side) reports 500 in / 250 out — both rows count, by design
    // (see Connection's doc comment), so the cluster total isn't halved or
    // deduplicated down to "one link's worth".
    expect(clusterTransferTotals(cluster())).toEqual({ inBytesTotal: 1500, outBytesTotal: 2250 })
  })
})
