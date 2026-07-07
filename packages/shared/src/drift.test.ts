import { describe, expect, it } from 'vitest'
import { detectDrift } from './drift.ts'
import type { ClusterModel, Share } from './types.ts'

function share(overrides: Partial<Share> & Pick<Share, 'deviceId'>): Share {
  return {
    folderId: 'f1',
    type: 'sendreceive',
    state: 'idle',
    sharedWith: ['a', 'b'],
    ...overrides,
  }
}

function cluster(shares: Share[], overrides: Partial<ClusterModel> = {}): ClusterModel {
  return {
    id: 'c1',
    label: 'Test',
    devices: [
      { id: 'a', name: 'alpha', state: 'connected', managed: true },
      { id: 'b', name: 'beta', state: 'connected', managed: true },
      { id: 'c', name: 'gamma', state: 'connected', managed: true },
      { id: 'x', name: 'roamer', state: 'disconnected', managed: false },
    ],
    folders: [{ id: 'f1', label: 'Folder 1' }],
    shares,
    connections: [],
    pendingDevices: [],
    pendingFolders: [],
    ...overrides,
  }
}

describe('detectDrift: clean clusters', () => {
  it('finds nothing in a symmetric, identically-configured folder', () => {
    const c = cluster([share({ deviceId: 'a' }), share({ deviceId: 'b' })])
    expect(detectDrift(c)).toEqual([])
  })

  it('finds nothing for an empty cluster or a folder with no shares', () => {
    expect(detectDrift(cluster([]))).toEqual([])
  })
})

describe('detectDrift: label drift', () => {
  it('reports differing labels with the majority as the suggested rename target', () => {
    const c = cluster([
      share({ deviceId: 'a', label: 'Photos', sharedWith: ['a', 'b', 'c'] }),
      share({ deviceId: 'b', label: 'Photos', sharedWith: ['a', 'b', 'c'] }),
      share({ deviceId: 'c', label: 'photos-old', sharedWith: ['a', 'b', 'c'] }),
    ])

    const findings = detectDrift(c).filter((f) => f.kind === 'label')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('info')
    expect(findings[0]!.message).toContain('“Photos” (alpha, beta)')
    expect(findings[0]!.message).toContain('“photos-old” (gamma)')
    expect(findings[0]!.suggestion).toContain('“Photos” on gamma')
  })

  it('treats a share without its own label as agreeing with the folder label', () => {
    const c = cluster([
      share({ deviceId: 'a', label: 'Folder 1' }),
      share({ deviceId: 'b' }), // no label -> counts as "Folder 1"
    ])
    expect(detectDrift(c).filter((f) => f.kind === 'label')).toEqual([])
  })
})

describe('detectDrift: versioning drift', () => {
  it('reports differing versioning configs as info (legal but worth knowing)', () => {
    const c = cluster([
      share({ deviceId: 'a', versioning: { type: 'simple', params: { keep: '5' } } }),
      share({ deviceId: 'b', versioning: { type: 'none', params: {} } }),
    ])

    const findings = detectDrift(c).filter((f) => f.kind === 'versioning')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('info')
    expect(findings[0]!.message).toContain('simple (1)')
    expect(findings[0]!.message).toContain('none (1)')
  })

  it('treats an absent versioning block as none, so none-vs-absent is not drift', () => {
    const c = cluster([
      share({ deviceId: 'a', versioning: { type: 'none', params: {} } }),
      share({ deviceId: 'b' }),
    ])
    expect(detectDrift(c).filter((f) => f.kind === 'versioning')).toEqual([])
  })

  it('same type with different params is still drift', () => {
    const c = cluster([
      share({ deviceId: 'a', versioning: { type: 'simple', params: { keep: '5' } } }),
      share({ deviceId: 'b', versioning: { type: 'simple', params: { keep: '10' } } }),
    ])
    expect(detectDrift(c).filter((f) => f.kind === 'versioning')).toHaveLength(1)
  })
})

describe('detectDrift: type pathologies', () => {
  it('flags all-sendonly (no reader) and all-receiveonly (no writer) as warnings', () => {
    const allSend = cluster([
      share({ deviceId: 'a', type: 'sendonly' }),
      share({ deviceId: 'b', type: 'sendonly' }),
    ])
    expect(detectDrift(allSend).map((f) => f.kind)).toContain('no-reader')

    const allReceive = cluster([
      share({ deviceId: 'a', type: 'receiveonly' }),
      share({ deviceId: 'b', type: 'receiveonly' }),
    ])
    expect(detectDrift(allReceive).map((f) => f.kind)).toContain('no-writer')
  })

  it('does not flag normal asymmetry or encrypted relays', () => {
    const normal = cluster([
      share({ deviceId: 'a', type: 'sendonly' }),
      share({ deviceId: 'b', type: 'receiveonly' }),
    ])
    expect(detectDrift(normal).filter((f) => f.kind === 'no-reader' || f.kind === 'no-writer')).toEqual([])

    // sendonly + encrypted relay: the relay is not a "reader" in the trusted
    // sense, but one trusted sendonly node alone is below the 2-trusted bar.
    const withRelay = cluster([
      share({ deviceId: 'a', type: 'sendonly' }),
      share({ deviceId: 'b', type: 'receiveencrypted' }),
    ])
    expect(detectDrift(withRelay).filter((f) => f.kind === 'no-reader')).toEqual([])

    // All-encrypted is pure relay storage — fine.
    const allEncrypted = cluster([
      share({ deviceId: 'a', type: 'receiveencrypted' }),
      share({ deviceId: 'b', type: 'receiveencrypted' }),
    ])
    expect(detectDrift(allEncrypted)).toEqual([])
  })
})

describe('detectDrift: asymmetric shares', () => {
  it('flags A sharing with a managed B that does not share back', () => {
    const c = cluster([
      share({ deviceId: 'a', sharedWith: ['a', 'b'] }),
      share({ deviceId: 'b', sharedWith: ['b'] }),
    ])

    const findings = detectDrift(c).filter((f) => f.kind === 'asymmetric-share')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.message).toBe(
      "alpha shares the folder with beta, but beta doesn't share it back",
    )
    expect(findings[0]!.deviceIds).toEqual(['a', 'b'])
  })

  it('flags A sharing with a managed B that does not have the folder at all', () => {
    const c = cluster([share({ deviceId: 'a', sharedWith: ['a', 'b'] })])

    const findings = detectDrift(c).filter((f) => f.kind === 'missing-folder')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.message).toContain("beta doesn't have the folder at all")
    expect(findings[0]!.suggestion).toContain('pending')
  })

  it('skips unmanaged peers — no first-hand view of their config', () => {
    const c = cluster([share({ deviceId: 'a', sharedWith: ['a', 'x'] })])
    expect(detectDrift(c)).toEqual([])
  })
})

describe('detectDrift: ordering', () => {
  it('sorts warnings before infos', () => {
    const c = cluster([
      share({ deviceId: 'a', label: 'X', sharedWith: ['a', 'b'] }),
      share({ deviceId: 'b', label: 'Y', sharedWith: ['b'] }), // label drift (info) + asymmetry (warning)
    ])

    const severities = detectDrift(c).map((f) => f.severity)
    expect(severities).toEqual([...severities].sort((x, y) => (x === 'warning' ? -1 : 1) - (y === 'warning' ? -1 : 1)))
    expect(severities[0]).toBe('warning')
  })
})
