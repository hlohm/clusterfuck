import { describe, expect, it } from 'vitest'
import { validateCluster } from './validate.ts'
import type { ClusterModel } from './types.ts'

function baseCluster(): ClusterModel {
  return {
    id: 'c1',
    label: 'Test',
    devices: [{ id: 'a', name: 'A', state: 'connected', managed: true }],
    folders: [{ id: 'f1', label: 'Folder 1' }],
    shares: [{ folderId: 'f1', deviceId: 'a', type: 'sendreceive', state: 'idle', sharedWith: ['a'] }],
    pendingDevices: [],
    pendingFolders: [],
  }
}

describe('validateCluster', () => {
  it('accepts a well-formed cluster', () => {
    expect(validateCluster(baseCluster())).toEqual([])
  })

  it('flags a share referencing an unknown device', () => {
    const cluster = baseCluster()
    cluster.shares.push({
      folderId: 'f1',
      deviceId: 'ghost',
      type: 'sendreceive',
      state: 'idle',
      sharedWith: ['a', 'ghost'],
    })
    const errors = validateCluster(cluster)
    expect(errors.some((e) => e.message.includes('unknown device'))).toBe(true)
  })

  it('flags a share referencing an unknown folder', () => {
    const cluster = baseCluster()
    cluster.shares.push({
      folderId: 'ghost',
      deviceId: 'a',
      type: 'sendreceive',
      state: 'idle',
      sharedWith: ['a'],
    })
    const errors = validateCluster(cluster)
    expect(errors.some((e) => e.message.includes('unknown folder'))).toBe(true)
  })

  it('flags a share owned by an unmanaged device', () => {
    const cluster = baseCluster()
    cluster.devices.push({ id: 'peer', name: 'Peer', state: 'connected', managed: false })
    cluster.shares.push({
      folderId: 'f1',
      deviceId: 'peer',
      type: 'sendreceive',
      state: 'idle',
      sharedWith: ['peer'],
    })
    const errors = validateCluster(cluster)
    expect(errors.some((e) => e.message.includes('unmanaged device "peer"'))).toBe(true)
  })

  it('flags a sharedWith entry referencing an unknown device', () => {
    const cluster = baseCluster()
    cluster.shares[0]!.sharedWith = ['a', 'ghost']
    const errors = validateCluster(cluster)
    expect(errors.some((e) => e.message.includes('unknown device "ghost" in sharedWith'))).toBe(true)
  })

  it('flags a share whose own device is missing from sharedWith', () => {
    const cluster = baseCluster()
    cluster.shares[0]!.sharedWith = []
    const errors = validateCluster(cluster)
    expect(errors.some((e) => e.message.includes('missing its own device in sharedWith'))).toBe(true)
  })

  it('flags a duplicate (folder, device) share pair', () => {
    const cluster = baseCluster()
    cluster.shares.push({
      folderId: 'f1',
      deviceId: 'a',
      type: 'sendonly',
      state: 'idle',
      sharedWith: ['a'],
    })
    const errors = validateCluster(cluster)
    expect(errors.some((e) => e.message.includes('Duplicate share'))).toBe(true)
  })
})
