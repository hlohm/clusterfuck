import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClusterStateManager, InvalidTargetError, NotManagedError } from './clusterState.ts'
import { loadNodeConfig } from './config.ts'

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
function installFakeCluster(
  delayMs = 0,
  failOn?: { host: string; pathname: string; reject?: boolean },
) {
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
      // reject simulates a connection-level failure (ECONNREFUSED, socket
      // dropped) as opposed to an HTTP error response.
      if (failOn.reject) throw new TypeError('fetch failed')
      return new Response('nope', { status: 500 })
    }

    if (url.pathname === '/rest/system/status') {
      return jsonResponse({
        myID: base.includes('a.test') ? 'DEVICE-A' : 'DEVICE-B',
        uptime: 3600,
        alloc: 30_000_000,
        connectionServiceStatus: { 'tcp://0.0.0.0:22000': { error: null } },
        discoveryStatus: { 'IPv4 local': { error: null } },
      })
    }
    if (url.pathname === '/rest/system/version') {
      return jsonResponse({ version: 'v1.27.0' })
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
    if (url.pathname === '/rest/db/scan' && method === 'POST') {
      return jsonResponse({})
    }
    if (url.pathname === '/rest/config/options' && method === 'GET') {
      return jsonResponse({ maxSendKbps: 1000, maxRecvKbps: 0, listenAddresses: ['default'] })
    }
    if (url.pathname === '/rest/config/options' && method === 'PATCH') {
      return jsonResponse({})
    }
    if (
      (url.pathname === '/rest/system/restart' || url.pathname === '/rest/system/shutdown') &&
      method === 'POST'
    ) {
      return jsonResponse({})
    }
    if (url.pathname === '/rest/system/upgrade' && method === 'GET') {
      return jsonResponse({ running: 'v1.27.0', latest: 'v1.27.0', newer: false, majorNewer: false })
    }
    if (url.pathname === '/rest/system/upgrade' && method === 'POST') {
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
    if (url.pathname.startsWith('/rest/config/devices/') && method === 'GET') {
      const deviceID = decodeURIComponent(url.pathname.split('/').pop()!)
      return jsonResponse({
        deviceID,
        name: deviceID === 'DEVICE-A' ? 'st-a' : 'st-b',
        paused: false,
        addresses: ['dynamic'],
        compression: 'metadata',
        introducer: false,
        autoAcceptFolders: false,
        maxSendKbps: 0,
        maxRecvKbps: 0,
      })
    }
    if (url.pathname.startsWith('/rest/config/devices/') && method === 'PATCH') {
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
    if (url.pathname === '/qr/' && method === 'GET') {
      // Fake PNG bytes tagged with the rendering host + text, so a test can
      // assert which node served it and for what content.
      return new Response(`png:${url.host}:${url.searchParams.get('text')}`, { status: 200 })
    }
    if (url.pathname === '/rest/db/browse' && method === 'GET') {
      // One conflict copy on st-a only, nested a level down.
      return jsonResponse(
        base.includes('a.test')
          ? [
              {
                name: 'docs',
                type: 'FILE_INFO_TYPE_DIRECTORY',
                children: [
                  { name: 'plan.sync-conflict-20260701-093015-ABCDEF1.md', type: 'FILE_INFO_TYPE_FILE' },
                ],
              },
              { name: 'readme.md', type: 'FILE_INFO_TYPE_FILE' },
            ]
          : [{ name: 'readme.md', type: 'FILE_INFO_TYPE_FILE' }],
      )
    }
    if (url.pathname === '/rest/db/ignores' && method === 'GET') {
      // Different patterns per node so a test can exercise the cross-node diff.
      const ignore = base.includes('a.test') ? ['*.tmp'] : ['*.bak']
      return jsonResponse({ ignore, expanded: ignore })
    }
    if (url.pathname === '/rest/db/ignores' && method === 'POST') {
      return jsonResponse({ ignore: [], expanded: [] })
    }
    if ((url.pathname === '/rest/db/override' || url.pathname === '/rest/db/revert') && method === 'POST') {
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

/**
 * Minimal one-node fake cluster for addNode/removeNode tests — these care
 * about node *lifecycle* (does a newly-added client get polled, does a
 * removed one stop being referenced), not folder/share semantics already
 * covered by installFakeCluster's own suite above. /rest/events always
 * resolves to an empty batch so the event loop addNode/start() kick off
 * doesn't trigger extra refreshes of its own — every test explicitly calls
 * manager.stop() before returning so that loop doesn't run past the test.
 */
function installAddNodeFakeCluster() {
  const calls: { method: string; url: string; host: string }[] = []
  const myIdByHost: Record<string, string> = { 'a.test': 'DEVICE-A' }
  const unreachableHosts = new Set<string>()

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url: url.pathname + url.search, host: url.host })

    if (unreachableHosts.has(url.host)) {
      return new Response('nope', { status: 500 })
    }
    if (url.pathname === '/rest/system/status') {
      return jsonResponse({
        myID: myIdByHost[url.host] ?? 'UNKNOWN',
        uptime: 3600,
        alloc: 30_000_000,
        connectionServiceStatus: { 'tcp://0.0.0.0:22000': { error: null } },
        discoveryStatus: { 'IPv4 local': { error: null } },
      })
    }
    if (url.pathname === '/rest/system/version') {
      return jsonResponse({ version: 'v1.27.0' })
    }
    if (url.pathname === '/rest/config') {
      return jsonResponse({ devices: [], folders: [] })
    }
    if (url.pathname === '/rest/system/connections') {
      return jsonResponse({ connections: {} })
    }
    if (url.pathname === '/rest/db/status') {
      return jsonResponse({ state: 'idle', needFiles: 0, needItems: 0, globalFiles: 0, errors: 0 })
    }
    if (url.pathname === '/rest/folder/errors') {
      return jsonResponse({ folder: '', errors: [] })
    }
    if (url.pathname === '/rest/cluster/pending/devices' || url.pathname === '/rest/cluster/pending/folders') {
      return jsonResponse({})
    }
    if (url.pathname === '/rest/events' || url.pathname === '/rest/events/disk') {
      return jsonResponse([])
    }
    throw new Error(`unexpected fetch in addNode fake cluster: ${method} ${url.href}`)
  })

  vi.stubGlobal('fetch', fetchMock)

  const manager = new ClusterStateManager(
    [{ id: 'st-a', url: 'http://a.test', apiKey: 'ka' }],
    { clusterId: 'live', label: 'Live cluster' },
  )

  return { manager, calls, myIdByHost, unreachableHosts }
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

  it('overrides a sendonly folder on the one node addressed, not cluster-wide', async () => {
    const { manager, calls } = installFakeCluster()
    await (manager as unknown as { refresh(): Promise<void> }).refresh()
    calls.length = 0

    await manager.overrideFolder('DEVICE-A', 'f1')

    const overrideCalls = calls.filter((c) => c.url.startsWith('/rest/db/override'))
    expect(overrideCalls).toHaveLength(1)
    expect(overrideCalls[0]!.url).toBe('/rest/db/override?folder=f1')
    expect(overrideCalls[0]!.host).toBe('a.test')
  })

  it('reverts a receiveonly folder on the one node addressed', async () => {
    const { manager, calls } = installFakeCluster()
    await (manager as unknown as { refresh(): Promise<void> }).refresh()
    calls.length = 0

    await manager.revertFolder('DEVICE-B', 'f1')

    const revertCalls = calls.filter((c) => c.url.startsWith('/rest/db/revert'))
    expect(revertCalls).toHaveLength(1)
    expect(revertCalls[0]!.url).toBe('/rest/db/revert?folder=f1')
    expect(revertCalls[0]!.host).toBe('b.test')
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

  it('sets folder versioning, mapping "none" back to Syncthing\'s empty-string type', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.setFolderVersioning('DEVICE-A', 'f1', {
      type: 'simple',
      params: { keep: '5', cleanoutDays: '0' },
    })
    let put = calls.find((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    let folder = JSON.parse(put!.body!) as { versioning: { type: string; params: Record<string, string> } }
    expect(folder.versioning.type).toBe('simple')
    expect(folder.versioning.params).toEqual({ keep: '5', cleanoutDays: '0' })
    expect(put!.host).toBe('a.test')

    calls.length = 0
    await manager.setFolderVersioning('DEVICE-A', 'f1', { type: 'none', params: {} })
    put = calls.find((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    folder = JSON.parse(put!.body!) as { versioning: { type: string; params: Record<string, string> } }
    // 'none' is our label; Syncthing's own "versioning off" is the empty string.
    expect(folder.versioning.type).toBe('')
    expect(folder.versioning.params).toEqual({})
  })

  it('renames a folder on one node via updateFolder, leaving the type untouched', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.updateFolder('DEVICE-A', 'f1', { label: 'Ledger' })

    const put = calls.find((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    const folder = JSON.parse(put!.body!) as { label: string; type: string }
    expect(put!.host).toBe('a.test')
    expect(folder.label).toBe('Ledger')
    expect(folder.type).toBe('sendreceive')
  })

  it('sets advanced options on the folder config without disturbing the rest of it', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.setFolderAdvanced('DEVICE-A', 'f1', {
      rescanIntervalS: 0,
      fsWatcherEnabled: false,
      fsWatcherDelayS: 30,
      minDiskFree: { value: 500, unit: 'MB' },
    })

    const put = calls.find((c) => c.method === 'PUT' && c.url === '/rest/config/folders/f1')
    const folder = JSON.parse(put!.body!) as Record<string, unknown>
    expect(put!.host).toBe('a.test')
    expect(folder.rescanIntervalS).toBe(0)
    expect(folder.fsWatcherEnabled).toBe(false)
    expect(folder.fsWatcherDelayS).toBe(30)
    expect(folder.minDiskFree).toEqual({ value: 500, unit: 'MB' })
    // The GET-modify-PUT must carry the untouched fields through.
    expect(folder.id).toBe('f1')
    expect(folder.devices).toEqual([{ deviceID: 'DEVICE-A' }, { deviceID: 'DEVICE-B' }])
  })

  it("reads every node's global bandwidth limits, keyed by its own device ID", async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)

    const view = await manager.getBandwidthLimits()

    expect(view.nodes).toEqual([
      { nodeId: 'DEVICE-A', maxSendKbps: 1000, maxRecvKbps: 0 },
      { nodeId: 'DEVICE-B', maxSendKbps: 1000, maxRecvKbps: 0 },
    ])
  })

  it('sets bandwidth limits on one node or on every node, via the options PATCH', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.setBandwidthLimits('DEVICE-B', { maxSendKbps: 500, maxRecvKbps: 250 })
    let patches = calls.filter((c) => c.method === 'PATCH' && c.url === '/rest/config/options')
    expect(patches.map((c) => c.host)).toEqual(['b.test'])
    expect(JSON.parse(patches[0]!.body!)).toEqual({ maxSendKbps: 500, maxRecvKbps: 250 })

    calls.length = 0
    await manager.setBandwidthLimits(undefined, { maxSendKbps: 0, maxRecvKbps: 0 })
    patches = calls.filter((c) => c.method === 'PATCH' && c.url === '/rest/config/options')
    expect(patches.map((c) => c.host).sort()).toEqual(['a.test', 'b.test'])
  })

  it('runs an upgrade sweep across the registered nodes and rejects a second concurrent one', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    const run = manager.startUpgradeAll()
    expect(run.running).toBe(true)
    expect(run.nodes.map((n) => n.nodeId)).toEqual(['DEVICE-A', 'DEVICE-B'])
    expect(() => manager.startUpgradeAll()).toThrow(InvalidTargetError)

    await manager.waitForUpgradeIdle()

    // The fake reports both nodes as already current, so no POSTs happen.
    expect(run.running).toBe(false)
    expect(run.nodes.every((n) => n.status === 'up-to-date')).toBe(true)
    expect(calls.some((c) => c.method === 'POST' && c.url === '/rest/system/upgrade')).toBe(false)
  })

  it('rescans every folder on every registered node in one batch', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.rescanAllFolders()

    const scans = calls.filter((c) => c.method === 'POST' && c.url.startsWith('/rest/db/scan'))
    expect(scans.map((c) => `${c.host}${c.url}`).sort()).toEqual([
      'a.test/rest/db/scan?folder=f1',
      'b.test/rest/db/scan?folder=f1',
    ])
  })

  it('restarts/shuts down exactly the named node', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.restartNode('DEVICE-B', 'restart')
    await manager.restartNode('DEVICE-A', 'shutdown')

    const restarts = calls.filter((c) => c.url === '/rest/system/restart')
    const shutdowns = calls.filter((c) => c.url === '/rest/system/shutdown')
    expect(restarts.map((c) => c.host)).toEqual(['b.test'])
    expect(shutdowns.map((c) => c.host)).toEqual(['a.test'])
  })

  it('tolerates the connection dropping mid-restart, but still surfaces a real HTTP error', async () => {
    // Syncthing can exit before the response makes it out — that's a success.
    const dropped = installFakeCluster(0, { host: 'a.test', pathname: '/rest/system/restart', reject: true })
    await refreshed(dropped.manager)
    await expect(dropped.manager.restartNode('DEVICE-A', 'restart')).resolves.toBeUndefined()

    // An explicit error response (e.g. 403) is a real failure, not a race.
    const denied = installFakeCluster(0, { host: 'a.test', pathname: '/rest/system/restart' })
    await refreshed(denied.manager)
    await expect(denied.manager.restartNode('DEVICE-A', 'restart')).rejects.toThrow('HTTP 500')
  })

  it('relays a device-ID QR from the first reachable node, falling back when one fails', async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)
    expect((await manager.getDeviceQr('DEVICE-B')).toString()).toBe('png:a.test:DEVICE-B')

    const failing = installFakeCluster(0, { host: 'a.test', pathname: '/qr/' })
    await refreshed(failing.manager)
    expect((await failing.manager.getDeviceQr('DEVICE-B')).toString()).toBe('png:b.test:DEVICE-B')
  })

  it('refuses to render a QR for text that is not a device in the model', async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)

    await expect(manager.getDeviceQr('https://evil.example/phish')).rejects.toThrow(InvalidTargetError)
  })

  it("reads device options from every referencing node — never the device's own self-entry", async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)

    const view = await manager.getDeviceOptions('DEVICE-B')

    // st-b's own config also lists DEVICE-B (its self-entry), but only st-a
    // *references* it as a peer — same scope as pause/remove.
    expect(view.deviceId).toBe('DEVICE-B')
    expect(view.nodes).toEqual([
      {
        nodeId: 'DEVICE-A',
        options: {
          name: 'st-b',
          addresses: ['dynamic'],
          compression: 'metadata',
          introducer: false,
          autoAcceptFolders: false,
          maxSendKbps: 0,
          maxRecvKbps: 0,
        },
      },
    ])
  })

  it('patches device options on every referencing node, leaving unmodeled fields to the element PATCH', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.setDeviceOptions('DEVICE-B', {
      name: 'backup box',
      addresses: ['tcp://10.0.0.9:22000'],
      compression: 'always',
      introducer: true,
      autoAcceptFolders: false,
      maxSendKbps: 1000,
      maxRecvKbps: 0,
    })

    const patches = calls.filter((c) => c.method === 'PATCH' && c.url === '/rest/config/devices/DEVICE-B')
    expect(patches).toHaveLength(1)
    expect(patches[0]!.host).toBe('a.test')
    const body = JSON.parse(patches[0]!.body!) as Record<string, unknown>
    expect(body.name).toBe('backup box')
    expect(body.addresses).toEqual(['tcp://10.0.0.9:22000'])
    expect(body.maxSendKbps).toBe(1000)
    // paused deliberately absent: the PATCH must not touch fields we don't model.
    expect('paused' in body).toBe(false)
  })

  it("scans every sharing node's tree for conflict copies, reporting folder-relative paths per node", async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)

    const res = await manager.getFolderConflicts('f1')

    expect(res.folderId).toBe('f1')
    const byDevice = Object.fromEntries(res.nodes.map((n) => [n.deviceId, n.paths]))
    expect(byDevice['DEVICE-A']).toEqual(['docs/plan.sync-conflict-20260701-093015-ABCDEF1.md'])
    expect(byDevice['DEVICE-B']).toEqual([])
  })

  it("reads every sharing node's failed items, capturing a per-node error instead of failing the whole call", async () => {
    const { manager } = installFakeCluster(0, { host: 'b.test', pathname: '/rest/folder/errors' })
    await refreshed(manager)

    const res = await manager.getFolderFailedItems('f1')

    const a = res.nodes.find((n) => n.deviceId === 'DEVICE-A')
    const b = res.nodes.find((n) => n.deviceId === 'DEVICE-B')
    expect(a).toEqual({ deviceId: 'DEVICE-A', items: [] })
    expect(b!.items).toEqual([])
    expect(b!.error).toContain('HTTP 500')
  })

  it("reads every sharing node's ignore patterns, keyed by that node's own device ID", async () => {
    const { manager } = installFakeCluster()
    await refreshed(manager)

    const res = await manager.getFolderIgnores('f1')

    expect(res.folderId).toBe('f1')
    const byDevice = Object.fromEntries(res.nodes.map((n) => [n.deviceId, n.patterns]))
    expect(byDevice['DEVICE-A']).toEqual(['*.tmp'])
    expect(byDevice['DEVICE-B']).toEqual(['*.bak'])
  })

  it('sets ignore patterns on the node identified by its device ID', async () => {
    const { manager, calls } = installFakeCluster()
    await refreshed(manager)
    calls.length = 0

    await manager.setFolderIgnores('DEVICE-A', 'f1', ['*.tmp', '/build'])

    const post = calls.find((c) => c.method === 'POST' && c.url === '/rest/db/ignores?folder=f1')
    expect(post!.host).toBe('a.test')
    expect(JSON.parse(post!.body!)).toEqual({ ignore: ['*.tmp', '/build'] })
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

  // addNode/removeNode call persist() unconditionally, which writes to
  // whatever CLUSTERFUCK_CONFIG resolves to — the real default cluster.json
  // path if unset. Every test here points it at an isolated temp file so
  // running the suite can never clobber a real local dev config.
  describe('addNode / removeNode', () => {
    let dir: string
    let prevEnv: string | undefined

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'clusterfuck-clusterstate-test-'))
      prevEnv = process.env.CLUSTERFUCK_CONFIG
      process.env.CLUSTERFUCK_CONFIG = join(dir, 'cluster.json')
    })

    afterEach(() => {
      if (prevEnv === undefined) delete process.env.CLUSTERFUCK_CONFIG
      else process.env.CLUSTERFUCK_CONFIG = prevEnv
      rmSync(dir, { recursive: true, force: true })
    })

    it('registers a new client and its snapshot appears in the model immediately', async () => {
      const { manager, calls, myIdByHost } = installAddNodeFakeCluster()
      await refreshed(manager)
      calls.length = 0
      myIdByHost['c.test'] = 'DEVICE-C'

      await manager.addNode({ id: 'st-c', url: 'http://c.test', apiKey: 'kc' })

      expect(calls.some((c) => c.host === 'c.test' && c.url === '/rest/system/status')).toBe(true)
      expect(manager.getModel().devices.some((d) => d.id === 'DEVICE-C')).toBe(true)

      manager.stop()
    })

    it('rejects registering a node id that is already registered', async () => {
      const { manager } = installAddNodeFakeCluster()
      await refreshed(manager)

      await expect(
        manager.addNode({ id: 'st-a', url: 'http://other.test', apiKey: 'x' }),
      ).rejects.toBeInstanceOf(InvalidTargetError)

      manager.stop()
    })

    // Regression: addNode used to push+persist unconditionally, so a
    // typo'd URL/apiKey would still resolve successfully — doRefresh's
    // per-node fetch failures are caught and logged, not thrown, so the
    // bad registration would silently never surface anywhere. Registering
    // should fail fast instead.
    it('rejects registering a node it cannot connect to, and never adds or persists it', async () => {
      const { manager, calls, unreachableHosts } = installAddNodeFakeCluster()
      await refreshed(manager)
      unreachableHosts.add('unreachable.test')
      calls.length = 0

      await expect(
        manager.addNode({ id: 'st-bad', url: 'http://unreachable.test', apiKey: 'kbad' }),
      ).rejects.toThrow()

      expect(manager.getModel().devices.some((d) => d.name === 'st-bad')).toBe(false)
      await expect(manager.removeNode('st-bad')).rejects.toBeInstanceOf(NotManagedError)

      manager.stop()
    })

    // Regression: addNode's only uniqueness check used to be on the label
    // (nodeId), so the same physical node could be registered twice under
    // two different labels — doubling its polling and (via aggregateCluster,
    // which doesn't dedup Share rows) duplicating every one of its shares in
    // the model.
    it('rejects registering the same physical node again under a different id', async () => {
      const { manager, myIdByHost } = installAddNodeFakeCluster()
      await refreshed(manager)
      // Same myID ("DEVICE-A") as the already-registered st-a, reachable at
      // a different host/label — simulating an aliased URL or a typo'd retry.
      myIdByHost['alias-of-a.test'] = 'DEVICE-A'

      await expect(
        manager.addNode({ id: 'st-a-alias', url: 'http://alias-of-a.test', apiKey: 'ka2' }),
      ).rejects.toBeInstanceOf(InvalidTargetError)

      expect(manager.getModel().devices.filter((d) => d.id === 'DEVICE-A')).toHaveLength(1)

      manager.stop()
    })

    it('persists the full node list, including the new apiKey, after addNode', async () => {
      const { manager, myIdByHost } = installAddNodeFakeCluster()
      await refreshed(manager)
      myIdByHost['c.test'] = 'DEVICE-C'

      await manager.addNode({ id: 'st-c', url: 'http://c.test', apiKey: 'kc' })

      const saved = JSON.parse(readFileSync(process.env.CLUSTERFUCK_CONFIG!, 'utf-8')) as {
        nodes: { id: string; url: string; apiKey: string }[]
      }
      expect(saved.nodes.map((n) => n.id).sort()).toEqual(['st-a', 'st-c'])
      expect(saved.nodes.find((n) => n.id === 'st-c')).toEqual({
        id: 'st-c',
        url: 'http://c.test',
        apiKey: 'kc',
      })

      manager.stop()
    })

    it('stops fetching from a removed node on the next refresh', async () => {
      const { manager, calls } = installAddNodeFakeCluster()
      await refreshed(manager)
      calls.length = 0

      await manager.removeNode('st-a')
      calls.length = 0
      await refreshed(manager)

      expect(calls.some((c) => c.host === 'a.test')).toBe(false)

      manager.stop()
    })

    it('removing the last registered node clears the model instead of freezing on stale data', async () => {
      const { manager } = installAddNodeFakeCluster()
      await refreshed(manager)
      expect(manager.getModel().devices.length).toBeGreaterThan(0)

      await manager.removeNode('st-a')

      expect(manager.getModel().devices).toEqual([])

      manager.stop()
    })

    // End-to-end version of the config.test.ts round-trip: goes through the
    // actual removeNode -> persist() -> saveNodeConfig() call chain (via
    // toConfig() on whatever's left in this.clients), not a bare
    // saveNodeConfig([]) call — this is what would have caught the original
    // crash-on-restart bug if it had been written before that fix landed.
    it('a proxy restart after removing the last node loads the persisted (empty) config without throwing', async () => {
      const { manager } = installAddNodeFakeCluster()
      await refreshed(manager)

      await manager.removeNode('st-a')
      manager.stop()

      expect(() => loadNodeConfig()).not.toThrow()
      expect(loadNodeConfig()).toEqual([])
    })

    it("removes a node by its own Syncthing device ID (the id the web UI actually has, via Device.id)", async () => {
      const { manager } = installAddNodeFakeCluster()
      await refreshed(manager)
      expect(manager.getModel().devices.some((d) => d.id === 'DEVICE-A')).toBe(true)

      await manager.removeNode('DEVICE-A')

      expect(manager.getModel().devices).toEqual([])

      manager.stop()
    })

    it('rejects removing a node that was never registered', async () => {
      const { manager } = installAddNodeFakeCluster()
      await refreshed(manager)

      await expect(manager.removeNode('st-nonexistent')).rejects.toBeInstanceOf(NotManagedError)

      manager.stop()
    })
  })
})
