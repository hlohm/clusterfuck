import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClusterStateManager, InvalidTargetError, NotManagedError } from './clusterState.ts'

async function refreshed(manager: ClusterStateManager): Promise<void> {
  await (manager as unknown as { refresh(): Promise<void> }).refresh()
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Two-node fake cluster: st-a (DEVICE-A) and st-b (DEVICE-B), each sharing
 * folder f1 with the other. Mocks global.fetch so ClusterStateManager's real
 * REST client code runs unmodified against canned responses. `delayMs`
 * (default 0) delays every response, to give a test room to run something
 * else while a refresh cycle is still in flight.
 */
function installFakeCluster(delayMs = 0, failOn?: { host: string; pathname: string }) {
  const calls: { method: string; url: string; host: string; body?: string }[] = []
  let folderTypeOnA: 'sendreceive' | 'sendonly' = 'sendreceive'

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const url = new URL(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({
      method,
      url: url.pathname + url.search,
      host: url.host,
      body: init?.body !== undefined ? String(init.body) : undefined,
    })
    const base = `${url.protocol}//${url.host}`

    if (failOn && url.host === failOn.host && url.pathname === failOn.pathname) {
      return new Response('nope', { status: 500 })
    }

    if (url.pathname === '/rest/system/status') {
      return jsonResponse({ myID: base.includes('a.test') ? 'DEVICE-A' : 'DEVICE-B' })
    }
    if (url.pathname === '/rest/config') {
      return jsonResponse({
        devices: [
          { deviceID: 'DEVICE-A', name: 'st-a', paused: false },
          { deviceID: 'DEVICE-B', name: 'st-b', paused: false },
        ],
        folders: [
          {
            id: 'f1',
            label: 'F1',
            type: base.includes('a.test') ? folderTypeOnA : 'sendreceive',
            paused: false,
            devices: [{ deviceID: 'DEVICE-A' }, { deviceID: 'DEVICE-B' }],
          },
        ],
      })
    }
    if (url.pathname === '/rest/system/connections') {
      return jsonResponse({ connections: {} })
    }
    if (url.pathname === '/rest/db/status') {
      return jsonResponse({ state: 'idle', needFiles: 0, needItems: 0, globalFiles: 10, errors: 0 })
    }
    if (url.pathname === '/rest/folder/errors') {
      return jsonResponse({ folder: 'f1', errors: [] })
    }
    if (url.pathname === '/rest/system/pause' || url.pathname === '/rest/system/resume') {
      return jsonResponse({})
    }
    if (url.pathname === '/rest/cluster/pending/devices' && method === 'GET') {
      // Seen on both nodes, so aggregation should merge it into one entry.
      return jsonResponse({
        'DEVICE-PENDING': { time: '2026-01-01T00:00:00Z', name: 'new-phone', address: '10.0.0.5:22000' },
      })
    }
    if (url.pathname === '/rest/cluster/pending/folders' && method === 'GET') {
      // Only offered on st-a, by DEVICE-B.
      return jsonResponse(
        base.includes('a.test')
          ? {
              'f2-pending': {
                offeredBy: {
                  'DEVICE-B': { time: '2026-01-01T00:00:00Z', label: 'F2', receiveEncrypted: false },
                },
              },
              'f3-encrypted': {
                offeredBy: {
                  'DEVICE-B': { time: '2026-01-01T00:00:00Z', label: 'F3', receiveEncrypted: true },
                },
              },
            }
          : {},
      )
    }
    if (url.pathname === '/rest/cluster/pending/devices' && method === 'DELETE') {
      return jsonResponse({})
    }
    if (url.pathname === '/rest/cluster/pending/folders' && method === 'DELETE') {
      return jsonResponse({})
    }
    if (
      (url.pathname === '/rest/config/devices' || url.pathname === '/rest/config/folders') &&
      method === 'POST'
    ) {
      return jsonResponse({})
    }
    if (url.pathname.startsWith('/rest/config/devices/') && method === 'DELETE') {
      return jsonResponse({})
    }
    if (url.pathname === '/rest/config/folders/f1' && method === 'DELETE') {
      return jsonResponse({})
    }
    if (url.pathname === '/rest/config/folders/f1' && method === 'GET') {
      return jsonResponse({
        id: 'f1',
        label: 'F1',
        type: base.includes('a.test') ? folderTypeOnA : 'sendreceive',
        paused: false,
        devices: [{ deviceID: 'DEVICE-A' }, { deviceID: 'DEVICE-B' }],
      })
    }
    if (url.pathname === '/rest/config/folders/f1' && method === 'PUT') {
      if (base.includes('a.test')) {
        const body = JSON.parse(String(init?.body)) as { type: 'sendreceive' | 'sendonly' }
        folderTypeOnA = body.type
      }
      return jsonResponse({})
    }
    throw new Error(`unexpected fetch: ${method} ${url.href}`)
  })

  vi.stubGlobal('fetch', fetchMock)

  const manager = new ClusterStateManager(
    [
      { id: 'st-a', url: 'http://a.test', apiKey: 'ka' },
      { id: 'st-b', url: 'http://b.test', apiKey: 'kb' },
    ],
    { clusterId: 'live', label: 'Live cluster' },
  )

  return { manager, calls }
}

describe('ClusterStateManager mutations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pauses a device only on registered nodes that reference it, not itself', async () => {
    const { manager, calls } = installFakeCluster()
    await (manager as unknown as { refresh(): Promise<void> }).refresh()
    calls.length = 0

    await manager.setDevicePaused('DEVICE-B', true)

    const pauseCalls = calls.filter((c) => c.url.startsWith('/rest/system/pause'))
    expect(pauseCalls).toHaveLength(1)
    expect(pauseCalls[0]!.url).toBe('/rest/system/pause?device=DEVICE-B')
  })

  it('throws NotManagedError for a device no registered node references', async () => {
    const { manager } = installFakeCluster()
    await (manager as unknown as { refresh(): Promise<void> }).refresh()

    await expect(manager.setDevicePaused('DEVICE-UNKNOWN', true)).rejects.toBeInstanceOf(
      NotManagedError,
    )
  })

  it('adds a device only on the selected nodes', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.addDevice('DEVICE-NEW', 'newbie', ['DEVICE-A'])

    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/rest/config/devices')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.host).toBe('a.test')
    expect(JSON.parse(posts[0]!.body!)).toEqual({ deviceID: 'DEVICE-NEW', name: 'newbie' })
  })

  it('creates a folder on every selected node, shared among all of them', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.createFolder(
      { id: 'f2', label: 'F2', path: '~/f2', type: 'sendreceive' },
      ['DEVICE-A', 'DEVICE-B'],
    )

    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/rest/config/folders')
    expect(posts.map((p) => p.host).sort()).toEqual(['a.test', 'b.test'])
    for (const post of posts) {
      const folder = JSON.parse(post.body!) as { id: string; path: string; devices: { deviceID: string }[] }
      expect(folder.id).toBe('f2')
      expect(folder.path).toBe('~/f2')
      expect(folder.devices).toEqual([{ deviceID: 'DEVICE-A' }, { deviceID: 'DEVICE-B' }])
    }
  })

  it('rejects creating on an unmanaged target and requires at least one target', async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)

    await expect(
      manager.addDevice('DEVICE-NEW', undefined, ['DEVICE-UNKNOWN']),
    ).rejects.toBeInstanceOf(NotManagedError)
    await expect(
      manager.createFolder({ id: 'f2', label: 'F2', path: '~/f2', type: 'sendreceive' }, []),
    ).rejects.toBeInstanceOf(InvalidTargetError)
  })

  it('rejects creating a folder shared with fewer than two distinct nodes', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await expect(
      manager.createFolder({ id: 'f2', label: 'F2', path: '~/f2', type: 'sendreceive' }, [
        'DEVICE-A',
      ]),
    ).rejects.toBeInstanceOf(InvalidTargetError)
    // A duplicated id is only one *distinct* node, so this must be rejected too.
    await expect(
      manager.createFolder({ id: 'f2', label: 'F2', path: '~/f2', type: 'sendreceive' }, [
        'DEVICE-A',
        'DEVICE-A',
      ]),
    ).rejects.toBeInstanceOf(InvalidTargetError)
    expect(calls.some((c) => c.method === 'POST' && c.url === '/rest/config/folders')).toBe(false)
  })

  it('de-duplicates repeated target ids instead of double-posting to the same node', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.addDevice('DEVICE-NEW', undefined, ['DEVICE-A', 'DEVICE-A'])

    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/rest/config/devices')
    expect(posts).toHaveLength(1)
  })

  it('removes a device only from nodes that reference it, not itself', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.removeDevice('DEVICE-B')

    const deletes = calls.filter((c) => c.method === 'DELETE' && c.url.startsWith('/rest/config/devices/'))
    expect(deletes).toHaveLength(1)
    expect(deletes[0]!.url).toBe('/rest/config/devices/DEVICE-B')
    expect(deletes[0]!.host).toBe('a.test') // st-a references DEVICE-B; st-b IS DEVICE-B
  })

  it('rejects removing a device no registered node references', async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)

    await expect(manager.removeDevice('DEVICE-UNKNOWN')).rejects.toBeInstanceOf(NotManagedError)
  })

  it('removes a folder from one node only, not cluster-wide', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.removeFolder('DEVICE-A', 'f1')

    const deletes = calls.filter((c) => c.method === 'DELETE' && c.url === '/rest/config/folders/f1')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]!.host).toBe('a.test')
  })

  it('pauses every device on every node, skipping each node\'s own self-entry', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.setAllDevicesPaused(true)

    const pauseCalls = calls.filter((c) => c.method === 'POST' && c.url.startsWith('/rest/system/pause'))
    expect(pauseCalls).toHaveLength(2)
    expect(pauseCalls.find((c) => c.host === 'a.test')?.url).toBe('/rest/system/pause?device=DEVICE-B')
    expect(pauseCalls.find((c) => c.host === 'b.test')?.url).toBe('/rest/system/pause?device=DEVICE-A')
  })

  it('pauses every folder on every node that has it — cluster-wide', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.setAllFoldersPaused(true)

    const puts = calls.filter((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    expect(puts.map((p) => p.host).sort()).toEqual(['a.test', 'b.test'])
    for (const put of puts) {
      const folder = JSON.parse(put.body!) as { paused: boolean }
      expect(folder.paused).toBe(true)
    }
  })

  it('a bulk action still refreshes and reports which node failed, not all-or-nothing', async () => {
    const { manager, calls } = installFakeCluster(0, { host: 'b.test', pathname: '/rest/system/pause' })
    await refreshed(manager)
    calls.length = 0

    await expect(manager.setAllDevicesPaused(true)).rejects.toThrow(/failed on 1\/2/)

    // The node that didn't fail should still have gotten its pause call.
    const pauseCalls = calls.filter((c) => c.method === 'POST' && c.url.startsWith('/rest/system/pause'))
    expect(pauseCalls.find((c) => c.host === 'a.test')).toBeDefined()
    // And a refresh must have happened regardless (a GET /rest/config after the pause attempts).
    expect(calls.some((c) => c.method === 'GET' && c.url === '/rest/config')).toBe(true)
  })

  it('rejects adding a share for a device the node has no config entry for', async () => {
    const { manager, calls } = installFakeCluster()
    await (manager as unknown as { refresh(): Promise<void> }).refresh()
    calls.length = 0

    await expect(manager.addShare('DEVICE-A', 'f1', 'DEVICE-UNKNOWN')).rejects.toBeInstanceOf(
      InvalidTargetError,
    )
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('adds a share with an encryption password for an untrusted peer', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.addShare('DEVICE-A', 'f1', 'DEVICE-B', 'hunter2')

    const putCall = calls.find((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    const folder = JSON.parse(putCall!.body!) as { devices: { deviceID: string; encryptionPassword?: string }[] }
    expect(folder.devices.find((d) => d.deviceID === 'DEVICE-B')?.encryptionPassword).toBe('hunter2')
  })

  it('adding a share with no password omits encryptionPassword entirely', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    // DEVICE-B is already on f1's device list in the fake cluster; re-adding
    // it without a password must not introduce an encryptionPassword key.
    await manager.addShare('DEVICE-A', 'f1', 'DEVICE-B')

    const putCall = calls.find((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    const folder = JSON.parse(putCall!.body!) as { devices: { deviceID: string; encryptionPassword?: string }[] }
    expect(folder.devices.find((d) => d.deviceID === 'DEVICE-B')).not.toHaveProperty('encryptionPassword')
  })

  it('an explicit empty-string password clears a previously-set one', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)

    await manager.addShare('DEVICE-A', 'f1', 'DEVICE-B', 'hunter2')
    calls.length = 0
    await manager.addShare('DEVICE-A', 'f1', 'DEVICE-B', '')

    const putCall = calls.find((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    const folder = JSON.parse(putCall!.body!) as { devices: { deviceID: string; encryptionPassword?: string }[] }
    expect(folder.devices.find((d) => d.deviceID === 'DEVICE-B')?.encryptionPassword).toBe('')
  })

  it('re-adding an already-shared device updates its encryption password', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    // DEVICE-B is already shared on f1 (no password); calling addShare again
    // with a password should set it on the existing entry, not duplicate it.
    await manager.addShare('DEVICE-A', 'f1', 'DEVICE-B', 'newpassword')

    const putCall = calls.find((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    const folder = JSON.parse(putCall!.body!) as { devices: { deviceID: string; encryptionPassword?: string }[] }
    const entries = folder.devices.filter((d) => d.deviceID === 'DEVICE-B')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.encryptionPassword).toBe('newpassword')
  })

  it('edits a folder on the node identified by its own device ID, not the config label', async () => {
    const { manager, calls } = installFakeCluster()
    await (manager as unknown as { refresh(): Promise<void> }).refresh()
    calls.length = 0

    await manager.setFolderType('DEVICE-A', 'f1', 'sendonly')

    const getCall = calls.find(
      (c) => c.method === 'GET' && c.url === '/rest/config/folders/f1',
    )
    const putCall = calls.find(
      (c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1',
    )
    expect(getCall).toBeDefined()
    expect(putCall).toBeDefined()

    const model = manager.getModel()
    expect(model.shares.find((s) => s.deviceId === 'DEVICE-A')?.type).toBe('sendonly')
  })

  it('surfaces a pending device merged across nodes, and a pending folder scoped to the node it was offered on', async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)

    const model = manager.getModel()
    expect(model.pendingDevices).toHaveLength(1)
    expect(model.pendingDevices[0]!.deviceId).toBe('DEVICE-PENDING')
    expect(model.pendingDevices[0]!.seenOn.map((s) => s.nodeId).sort()).toEqual(['st-a', 'st-b'])

    expect(model.pendingFolders).toHaveLength(2)
    const f2 = model.pendingFolders.find((f) => f.folderId === 'f2-pending')!
    expect(f2.offers).toEqual([
      { nodeId: 'st-a', offeredBy: 'DEVICE-B', time: '2026-01-01T00:00:00Z', label: 'F2', receiveEncrypted: false },
    ])
    const f3 = model.pendingFolders.find((f) => f.folderId === 'f3-encrypted')!
    expect(f3.offers[0]!.receiveEncrypted).toBe(true)
  })

  it('dismisses a pending device on every node currently reporting it', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.dismissPendingDevice('DEVICE-PENDING')

    const deletes = calls.filter(
      (c) => c.method === 'DELETE' && c.url === '/rest/cluster/pending/devices?device=DEVICE-PENDING',
    )
    expect(deletes.map((d) => d.host).sort()).toEqual(['a.test', 'b.test'])
  })

  it('accepting a pending folder posts it only to the node it was offered on, sharing with the offering device', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.acceptPendingFolder('DEVICE-A', 'f2-pending', 'DEVICE-B', {
      label: 'F2',
      path: '~/f2-pending',
      type: 'sendreceive',
    })

    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/rest/config/folders')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.host).toBe('a.test')
    const folder = JSON.parse(posts[0]!.body!) as { id: string; devices: { deviceID: string }[] }
    expect(folder.id).toBe('f2-pending')
    expect(folder.devices).toEqual([{ deviceID: 'DEVICE-A' }, { deviceID: 'DEVICE-B' }])
  })

  it('rejects accepting a pending folder with an offeredBy that never actually offered it', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await expect(
      manager.acceptPendingFolder('DEVICE-A', 'f2-pending', 'DEVICE-WRONG', {
        label: 'F2',
        path: '~/f2-pending',
        type: 'sendreceive',
      }),
    ).rejects.toBeInstanceOf(InvalidTargetError)
    expect(calls.some((c) => c.method === 'POST' && c.url === '/rest/config/folders')).toBe(false)
  })

  it('rejects accepting an encrypted pending folder offer as any type other than receiveencrypted', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await expect(
      manager.acceptPendingFolder('DEVICE-A', 'f3-encrypted', 'DEVICE-B', {
        label: 'F3',
        path: '~/f3-encrypted',
        type: 'sendreceive',
      }),
    ).rejects.toBeInstanceOf(InvalidTargetError)
    expect(calls.some((c) => c.method === 'POST' && c.url === '/rest/config/folders')).toBe(false)

    // The correct type is accepted fine.
    await manager.acceptPendingFolder('DEVICE-A', 'f3-encrypted', 'DEVICE-B', {
      label: 'F3',
      path: '~/f3-encrypted',
      type: 'receiveencrypted',
    })
    expect(calls.some((c) => c.method === 'POST' && c.url === '/rest/config/folders')).toBe(true)
  })

  it('dismisses a pending folder on one node, optionally scoped to one offering device', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.dismissPendingFolder('DEVICE-A', 'f2-pending', 'DEVICE-B')

    const deletes = calls.filter(
      (c) => c.method === 'DELETE' && c.url.startsWith('/rest/cluster/pending/folders'),
    )
    expect(deletes).toHaveLength(1)
    expect(deletes[0]!.host).toBe('a.test')
    expect(deletes[0]!.url).toBe('/rest/cluster/pending/folders?folder=f2-pending&device=DEVICE-B')
  })

  it('dismissing a pending folder with no offeredBy narrows to no single device', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.dismissPendingFolder('DEVICE-A', 'f2-pending')

    const deletes = calls.filter(
      (c) => c.method === 'DELETE' && c.url.startsWith('/rest/cluster/pending/folders'),
    )
    expect(deletes).toHaveLength(1)
    expect(deletes[0]!.url).toBe('/rest/cluster/pending/folders?folder=f2-pending')
  })

  it("a mutation's own refresh reflects its write even if a slower refresh cycle was already running", async () => {
    // Regression test: refresh() used to coalesce onto whatever cycle was
    // already in flight, even one that started (and read its snapshots)
    // before this mutation's write landed — resolving "success" while the
    // model still showed the pre-mutation state.
    const { manager } = installFakeCluster(20)
    await refreshed(manager)

    const staleRefresh = (manager as unknown as { refresh(): Promise<void> }).refresh()
    // Give the stale cycle's fetches a head start so it's genuinely in
    // flight (and its snapshots reflect the pre-mutation type) once the
    // mutation's own writes complete below.
    await new Promise((resolve) => setTimeout(resolve, 5))

    await manager.setFolderType('DEVICE-A', 'f1', 'sendonly')
    await staleRefresh

    const model = manager.getModel()
    expect(model.shares.find((s) => s.deviceId === 'DEVICE-A')?.type).toBe('sendonly')
  })
})
