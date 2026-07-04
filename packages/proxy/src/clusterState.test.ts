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
function installFakeCluster(delayMs = 0) {
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

  it('rejects adding a share for a device the node has no config entry for', async () => {
    const { manager, calls } = installFakeCluster()
    await (manager as unknown as { refresh(): Promise<void> }).refresh()
    calls.length = 0

    await expect(manager.addShare('DEVICE-A', 'f1', 'DEVICE-UNKNOWN')).rejects.toBeInstanceOf(
      InvalidTargetError,
    )
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
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
