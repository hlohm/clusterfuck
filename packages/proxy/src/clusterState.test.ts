import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClusterStateManager, InvalidTargetError, NotManagedError } from './clusterState.ts'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Two-node fake cluster: st-a (DEVICE-A) and st-b (DEVICE-B), each sharing
 * folder f1 with the other. Mocks global.fetch so ClusterStateManager's real
 * REST client code runs unmodified against canned responses.
 */
function installFakeCluster() {
  const calls: { method: string; url: string }[] = []
  let folderTypeOnA: 'sendreceive' | 'sendonly' = 'sendreceive'

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url: url.pathname + url.search })
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
})
