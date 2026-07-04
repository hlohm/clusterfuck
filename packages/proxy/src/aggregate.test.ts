import { describe, expect, it } from 'vitest'
import { aggregateCluster, type NodeSnapshot } from './aggregate.ts'

function snapshot(overrides: Partial<NodeSnapshot>): NodeSnapshot {
  return {
    nodeId: 'st-a',
    myID: 'DEVICE-A',
    devices: [],
    folders: [],
    connections: {},
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
      connections: { 'DEVICE-B': { connected: true, paused: false } },
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
      connections: { 'DEVICE-A': { connected: true, paused: false } },
    })

    const model = aggregateCluster([a, b], 'live', 'Live cluster')

    expect(model.devices).toHaveLength(2)
    expect(model.folders).toEqual([{ id: 'spectrum', label: 'Spectrum' }])
    expect(model.shares).toHaveLength(2)
    expect(model.shares.find((s) => s.deviceId === 'DEVICE-A')?.state).toBe('idle')
    expect(model.shares.find((s) => s.deviceId === 'DEVICE-B')?.state).toBe('syncing')
  })

  it('reconciles device state: paused beats connected beats disconnected', () => {
    const a = snapshot({
      nodeId: 'st-a',
      myID: 'DEVICE-A',
      connections: {
        'DEVICE-B': { connected: true, paused: false },
        'DEVICE-C': { connected: false, paused: false },
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
})
