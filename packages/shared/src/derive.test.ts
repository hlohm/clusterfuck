import { describe, expect, it } from 'vitest'
import { folderHealthForDevice, sharesByDevice, sharesByFolder } from './derive.ts'
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
