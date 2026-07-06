import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchNodeSnapshot } from './snapshot.ts'
import { SyncthingClient } from './syncthing/client.ts'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Minimal fetch mock covering exactly what fetchNodeSnapshot needs, with hooks to override /rest/system/status and /rest/system/connections. */
function installClient(
  statusOverrides: Record<string, unknown> = {},
  connections: Record<string, unknown> = {},
) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(input)
    if (url.pathname === '/rest/system/status') {
      return jsonResponse({
        myID: 'DEVICE-A',
        uptime: 12_345,
        alloc: 42_000_000,
        connectionServiceStatus: { 'tcp://0.0.0.0:22000': { error: null } },
        discoveryStatus: { 'IPv4 local': { error: null } },
        ...statusOverrides,
      })
    }
    if (url.pathname === '/rest/system/version') {
      return jsonResponse({ version: 'v1.27.3' })
    }
    if (url.pathname === '/rest/config') {
      return jsonResponse({ devices: [], folders: [] })
    }
    if (url.pathname === '/rest/system/connections') {
      return jsonResponse({ connections })
    }
    if (url.pathname === '/rest/cluster/pending/devices' || url.pathname === '/rest/cluster/pending/folders') {
      return jsonResponse({})
    }
    throw new Error(`unexpected fetch in snapshot test: ${url.href}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return new SyncthingClient({ id: 'st-a', url: 'http://a.test', apiKey: 'ka' })
}

describe('fetchNodeSnapshot systemStatus derivation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives version, uptime, and RAM from systemStatus + systemVersion', async () => {
    const client = installClient()
    const snap = await fetchNodeSnapshot(client, 'st-a')

    expect(snap.systemStatus.version).toBe('v1.27.3')
    expect(snap.systemStatus.uptimeSeconds).toBe(12_345)
    expect(snap.systemStatus.ramBytes).toBe(42_000_000)
  })

  it('summarizes listeners/discovery into a total/ok count plus the actual errors', async () => {
    const client = installClient({
      connectionServiceStatus: {
        'tcp://0.0.0.0:22000': { error: null },
        'relay://relays.syncthing.net': { error: 'dial tcp: connection refused' },
      },
    })
    const snap = await fetchNodeSnapshot(client, 'st-a')

    expect(snap.systemStatus.listeners).toEqual({
      total: 2,
      ok: 1,
      errors: ['dial tcp: connection refused'],
    })
  })

  it('degrades discovery to zero-total (not a thrown error) on a pre-1.18.0 node with no discoveryStatus field', async () => {
    const client = installClient({ discoveryStatus: undefined })
    const snap = await fetchNodeSnapshot(client, 'st-a')

    expect(snap.systemStatus.discovery).toEqual({ total: 0, ok: 0, errors: [] })
  })

  it('degrades to an empty version string, without failing the whole snapshot, if /rest/system/version fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input)
      if (url.pathname === '/rest/system/version') {
        return new Response('nope', { status: 500 })
      }
      if (url.pathname === '/rest/system/status') {
        return jsonResponse({
          myID: 'DEVICE-A',
          uptime: 1,
          alloc: 1,
          connectionServiceStatus: {},
          discoveryStatus: {},
        })
      }
      if (url.pathname === '/rest/config') return jsonResponse({ devices: [], folders: [] })
      if (url.pathname === '/rest/system/connections') return jsonResponse({ connections: {} })
      if (url.pathname === '/rest/cluster/pending/devices' || url.pathname === '/rest/cluster/pending/folders') {
        return jsonResponse({})
      }
      throw new Error(`unexpected fetch: ${url.href}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new SyncthingClient({ id: 'st-a', url: 'http://a.test', apiKey: 'ka' })

    const snap = await fetchNodeSnapshot(client, 'st-a')

    expect(snap.systemStatus.version).toBe('')
    expect(snap.myID).toBe('DEVICE-A')
  })
})

describe('fetchNodeSnapshot versioning', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function installWithFolder(versioning: unknown) {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input)
      if (url.pathname === '/rest/system/status') {
        return jsonResponse({ myID: 'DEVICE-A', uptime: 1, alloc: 1, connectionServiceStatus: {}, discoveryStatus: {} })
      }
      if (url.pathname === '/rest/system/version') return jsonResponse({ version: 'v1' })
      if (url.pathname === '/rest/config') {
        return jsonResponse({
          devices: [],
          folders: [
            { id: 'f1', label: 'F1', type: 'sendreceive', paused: false, devices: [{ deviceID: 'DEVICE-A' }], versioning },
          ],
        })
      }
      if (url.pathname === '/rest/system/connections') return jsonResponse({ connections: {} })
      if (url.pathname === '/rest/db/status') {
        return jsonResponse({ state: 'idle', needFiles: 0, needItems: 0, globalFiles: 10, errors: 0 })
      }
      if (url.pathname === '/rest/folder/errors') return jsonResponse({ folder: 'f1', errors: [] })
      if (url.pathname === '/rest/cluster/pending/devices' || url.pathname === '/rest/cluster/pending/folders') {
        return jsonResponse({})
      }
      throw new Error(`unexpected fetch in snapshot test: ${url.href}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return new SyncthingClient({ id: 'st-a', url: 'http://a.test', apiKey: 'ka' })
  }

  it('normalizes a configured versioning block, dropping fields we do not model', async () => {
    const client = installWithFolder({
      type: 'staggered',
      params: { maxAge: '2592000' },
      cleanupIntervalS: 3600,
      fsPath: '',
      fsType: 'basic',
    })
    const snap = await fetchNodeSnapshot(client, 'st-a')

    expect(snap.folders[0]!.versioning).toEqual({
      type: 'staggered',
      params: { maxAge: '2592000' },
      cleanupIntervalS: 3600,
    })
  })

  it("maps Syncthing's empty-string type (versioning off), and an absent block, to none", async () => {
    expect((await fetchNodeSnapshot(installWithFolder({ type: '', params: {} }), 'st-a')).folders[0]!.versioning).toEqual({
      type: 'none',
      params: {},
    })
    vi.unstubAllGlobals()
    expect((await fetchNodeSnapshot(installWithFolder(undefined), 'st-a')).folders[0]!.versioning).toEqual({
      type: 'none',
      params: {},
    })
  })
})

describe('fetchNodeSnapshot connections', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('copies inBytesTotal/outBytesTotal through alongside connected/paused', async () => {
    const client = installClient(undefined, {
      'DEVICE-B': { connected: true, paused: false, inBytesTotal: 1000, outBytesTotal: 2000 },
    })
    const snap = await fetchNodeSnapshot(client, 'st-a')

    expect(snap.connections['DEVICE-B']).toEqual({
      connected: true,
      paused: false,
      inBytesTotal: 1000,
      outBytesTotal: 2000,
    })
  })
})
