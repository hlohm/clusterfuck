import { describe, expect, it } from 'vitest'
import {
  clusterHealth,
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
      { id: 'a', name: 'A', state: 'connected' },
      { id: 'b', name: 'B', state: 'connected' },
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
    c.devices.push({ id: 'c', name: 'C', state: 'paused' })
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
    c.devices.push({ id: 'c', name: 'C', state: 'disconnected' })
    expect(folderHealthForDevice(c, 'c')).toBeUndefined()
  })
})
