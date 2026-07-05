import { describe, expect, it } from 'vitest'
import { aggregateCluster, type NodeSnapshot } from './aggregate.ts'

function snapshot(overrides: Partial<NodeSnapshot>): NodeSnapshot {
  return {
    nodeId: 'st-a',
    myID: 'DEVICE-A',
    devices: [],
    folders: [],
    connections: {},
    pendingDevices: [],
    pendingFolders: [],
    systemStatus: {
      version: 'v1.27.0',
      uptimeSeconds: 3600,
      ramBytes: 30_000_000,
      listeners: { total: 1, ok: 1, errors: [] },
      discovery: { total: 1, ok: 1, errors: [] },
    },
    ...overrides,
  }
}

describe('aggregateCluster', () => {
  it('merges devices and folders seen across multiple nodes', () => {
    const a = snapshot({
      nodeId: 'st-a',
      myID: 'DEVICE-A',
      devices: [
        { deviceId: 'DEVICE-A', name: 'st-a', paused: false },
        { deviceId: 'DEVICE-B', name: 'st-b', paused: false },
      ],
      folders: [
        {
          id: 'spectrum',
          label: 'Spectrum',
          type: 'sendreceive',
          state: 'idle',
          sharedWith: ['DEVICE-A', 'DEVICE-B'],
        },
      ],
      connections: {
        'DEVICE-B': { connected: true, paused: false, inBytesTotal: 1000, outBytesTotal: 2000 },
      },
    })
    const b = snapshot({
      nodeId: 'st-b',
      myID: 'DEVICE-B',
      devices: [
        { deviceId: 'DEVICE-A', name: 'st-a', paused: false },
        { deviceId: 'DEVICE-B', name: 'st-b', paused: false },
      ],
      folders: [
        {
          id: 'spectrum',
          label: 'Spectrum',
          type: 'sendreceive',
          state: 'syncing',
          sharedWith: ['DEVICE-A', 'DEVICE-B'],
        },
      ],
      connections: {
        'DEVICE-A': { connected: true, paused: false, inBytesTotal: 500, outBytesTotal: 250 },
      },
    })

    const model = aggregateCluster([a, b], 'live', 'Live cluster')

    expect(model.devices).toHaveLength(2)
    expect(model.folders).toEqual([{ id: 'spectrum', label: 'Spectrum' }])
    expect(model.shares).toHaveLength(2)
    expect(model.shares.find((s) => s.deviceId === 'DEVICE-A')?.state).toBe('idle')
    expect(model.shares.find((s) => s.deviceId === 'DEVICE-B')?.state).toBe('syncing')
    // One Connection row per (reporting node, peer) — not merged, even
    // though both rows describe the same physical A<->B link.
    expect(model.connections).toEqual([
      { deviceId: 'DEVICE-A', peerId: 'DEVICE-B', connected: true, inBytesTotal: 1000, outBytesTotal: 2000 },
      { deviceId: 'DEVICE-B', peerId: 'DEVICE-A', connected: true, inBytesTotal: 500, outBytesTotal: 250 },
    ])
  })

  it("gives systemStatus only to a snapshot's own myID, never to a peer seen only via its config", () => {
    const a = snapshot({
      nodeId: 'st-a',
      myID: 'DEVICE-A',
      devices: [
        { deviceId: 'DEVICE-A', name: 'st-a', paused: false },
        // DEVICE-ROAMER is only ever seen as a peer here, never registered
        // as a node of its own — no snapshot in this test has myID ===
        // 'DEVICE-ROAMER', so it has no first-hand system status to report.
        { deviceId: 'DEVICE-ROAMER', name: 'roamer', paused: false },
      ],
      systemStatus: {
        version: 'v1.27.0',
        uptimeSeconds: 111,
        ramBytes: 1,
        listeners: { total: 1, ok: 1, errors: [] },
        discovery: { total: 1, ok: 1, errors: [] },
      },
    })

    const model = aggregateCluster([a], 'live', 'Live cluster')

    const self = model.devices.find((d) => d.id === 'DEVICE-A')!
    expect(self.managed).toBe(true)
    expect(self.systemStatus).toEqual({
      version: 'v1.27.0',
      uptimeSeconds: 111,
      ramBytes: 1,
      listeners: { total: 1, ok: 1, errors: [] },
      discovery: { total: 1, ok: 1, errors: [] },
    })

    const roamer = model.devices.find((d) => d.id === 'DEVICE-ROAMER')!
    expect(roamer.managed).toBe(false)
    expect(roamer.systemStatus).toBeUndefined()
  })

  it('reconciles device state: paused beats connected beats disconnected', () => {
    const a = snapshot({
      nodeId: 'st-a',
      myID: 'DEVICE-A',
      connections: {
        'DEVICE-B': { connected: true, paused: false, inBytesTotal: 0, outBytesTotal: 0 },
        'DEVICE-C': { connected: false, paused: false, inBytesTotal: 0, outBytesTotal: 0 },
      },
    })
    const b = snapshot({
      nodeId: 'st-b',
      myID: 'DEVICE-B',
      devices: [{ deviceId: 'DEVICE-B', name: 'st-b', paused: true }],
    })

    const model = aggregateCluster([a, b], 'live', 'Live cluster')
    const byId = Object.fromEntries(model.devices.map((d) => [d.id, d.state]))

    expect(byId['DEVICE-B']).toBe('paused') // explicit pause wins even though a sees it connected
    expect(byId['DEVICE-C']).toBe('disconnected') // no view ever reports it connected
  })

  it('produces no share for a device only ever seen as a remote peer', () => {
    const a = snapshot({
      nodeId: 'st-a',
      myID: 'DEVICE-A',
      devices: [{ deviceId: 'DEVICE-C', name: 'st-c (unregistered)', paused: false }],
      folders: [
        { id: 'spectrum', label: 'Spectrum', type: 'sendreceive', state: 'idle', sharedWith: ['DEVICE-A'] },
      ],
    })

    const model = aggregateCluster([a], 'live', 'Live cluster')

    expect(model.devices.map((d) => d.id)).toContain('DEVICE-C')
    expect(model.shares.some((s) => s.deviceId === 'DEVICE-C')).toBe(false)
    expect(model.devices.find((d) => d.id === 'DEVICE-A')?.managed).toBe(true)
    expect(model.devices.find((d) => d.id === 'DEVICE-C')?.managed).toBe(false)
  })

  it('merges a pending device seen by multiple nodes into one entry', () => {
    const a = snapshot({
      nodeId: 'st-a',
      myID: 'DEVICE-A',
      pendingDevices: [{ deviceId: 'DEVICE-NEW', time: '2026-01-01T00:00:00Z', address: '1.2.3.4:22000' }],
    })
    const b = snapshot({
      nodeId: 'st-b',
      myID: 'DEVICE-B',
      pendingDevices: [{ deviceId: 'DEVICE-NEW', name: 'suggested-name', time: '2026-01-01T00:05:00Z' }],
    })

    const model = aggregateCluster([a, b], 'live', 'Live cluster')

    expect(model.pendingDevices).toHaveLength(1)
    const pending = model.pendingDevices[0]!
    expect(pending.deviceId).toBe('DEVICE-NEW')
    expect(pending.name).toBe('suggested-name') // picked up from whichever view offered one
    expect(pending.seenOn.map((s) => s.nodeId).sort()).toEqual(['st-a', 'st-b'])
  })

  it('groups pending folder offers from different nodes/peers under one folder entry', () => {
    const a = snapshot({
      nodeId: 'st-a',
      myID: 'DEVICE-A',
      pendingFolders: [
        { folderId: 'recipes', offeredBy: 'DEVICE-X', time: '2026-01-01T00:00:00Z', label: 'Recipes', receiveEncrypted: false },
      ],
    })
    const b = snapshot({
      nodeId: 'st-b',
      myID: 'DEVICE-B',
      pendingFolders: [
        { folderId: 'recipes', offeredBy: 'DEVICE-Y', time: '2026-01-01T00:10:00Z', label: 'Recipes', receiveEncrypted: true },
      ],
    })

    const model = aggregateCluster([a, b], 'live', 'Live cluster')

    expect(model.pendingFolders).toHaveLength(1)
    const pending = model.pendingFolders[0]!
    expect(pending.folderId).toBe('recipes')
    expect(pending.offers).toHaveLength(2)
    expect(pending.offers.map((o) => o.offeredBy).sort()).toEqual(['DEVICE-X', 'DEVICE-Y'])
  })
})
