import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, getJson, notifyUnauthorized, setUnauthorizedListener } from './http'

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  setUnauthorizedListener(undefined)
  vi.unstubAllGlobals()
})

describe('shared http helpers', () => {
  it('sends credentials and surfaces the proxy error body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(400, { error: 'nope' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(call('POST', '/api/x', { a: 1 })).rejects.toThrow('nope')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include' })
  })

  it('notifies the unauthorized listener on any 401 — the session-expiry hook', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { error: 'authentication required' })))
    const onUnauthorized = vi.fn()
    setUnauthorizedListener(onUnauthorized)

    await expect(getJson('/api/cluster')).rejects.toThrow('authentication required')
    await expect(call('DELETE', '/api/devices/x')).rejects.toThrow()
    expect(onUnauthorized).toHaveBeenCalledTimes(2)
  })

  it('does not notify on non-401 failures or on success', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedListener(onUnauthorized)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(500, { error: 'boom' })))
    await expect(call('POST', '/api/x')).rejects.toThrow('boom')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { ok: true })))
    await call('POST', '/api/x')

    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('notifyUnauthorized lets non-fetch callers (the SSE probe) trigger the same hook', () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedListener(onUnauthorized)
    notifyUnauthorized()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
