import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, type Server } from 'node:http'
import { ClusterStateManager } from './clusterState.ts'
import { createAuth } from './auth.ts'
import { createHttpServer, listenReady } from './server.ts'
import { createStaticHandler } from './static.ts'

/**
 * End-to-end over a real socket: a zero-node manager (never started, so no
 * event/poll loops), real auth, and a temp-dir web build. `auth` accepts
 * either a plain token (the common case) or the full createAuth options.
 */
function startServer(
  auth?: string | Parameters<typeof createAuth>[0],
  webRoot?: string,
  readonly?: boolean,
) {
  const manager = new ClusterStateManager([], { clusterId: 'test', label: 'Test' })
  const authOpts = typeof auth === 'string' || auth === undefined ? { token: auth } : auth
  const server = createHttpServer(
    manager,
    'http://localhost:5173',
    createAuth(authOpts),
    webRoot !== undefined ? createStaticHandler(webRoot) : undefined,
    readonly,
  )
  server.listen(0)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { server, base: `http://127.0.0.1:${address.port}` }
}

let running: Server | undefined
afterEach(() => {
  running?.close()
  running = undefined
})

describe('auth gating over HTTP', () => {
  it('rejects /api/cluster without credentials and accepts the bearer token', async () => {
    const { server, base } = startServer('sekrit')
    running = server

    expect((await fetch(`${base}/api/cluster`)).status).toBe(401)

    const ok = await fetch(`${base}/api/cluster`, { headers: { Authorization: 'Bearer sekrit' } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { id: string }).id).toBe('test')
  })

  it('login exchanges the token for a cookie that then authorizes requests', async () => {
    const { server, base } = startServer('sekrit')
    running = server

    const bad = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ token: 'nope' }) })
    expect(bad.status).toBe(401)

    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ token: 'sekrit' }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!

    const events = await fetch(`${base}/api/cluster`, { headers: { cookie } })
    expect(events.status).toBe(200)
  })

  it('leaves the health/version/auth probes and login reachable without credentials', async () => {
    const { server, base } = startServer('sekrit')
    running = server

    expect((await fetch(`${base}/api/health`)).status).toBe(200)
    expect((await fetch(`${base}/api/version`)).status).toBe(200)
    const status = await fetch(`${base}/api/auth`)
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ required: true, authorized: false, managedByEnv: false })
  })

  it('lets an already-invalid session log out — logout is exempt and clears the cookie', async () => {
    const { server, base } = startServer('sekrit')
    running = server

    // No/stale credential: a just-revoked browser must still be able to
    // clear its cookie rather than being stranded behind the gate.
    const res = await fetch(`${base}/api/logout`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('reveals the token only to an authorized caller', async () => {
    const { server, base } = startServer('sekrit')
    running = server

    expect((await fetch(`${base}/api/auth/token`)).status).toBe(401)
    const ok = await fetch(`${base}/api/auth/token`, { headers: { Authorization: 'Bearer sekrit' } })
    expect(await ok.json()).toEqual({ token: 'sekrit' })
  })

  it('runs fully open when no token is configured, and says so on /api/auth', async () => {
    const { server, base } = startServer(undefined)
    running = server

    expect((await fetch(`${base}/api/cluster`)).status).toBe(200)
    expect(await (await fetch(`${base}/api/auth`)).json()).toEqual({
      required: false,
      authorized: true,
      managedByEnv: false,
    })
    expect((await fetch(`${base}/api/login`, { method: 'POST', body: '{"token":"x"}' })).status).toBe(400)
    expect((await fetch(`${base}/api/auth/token`)).status).toBe(404)
  })
})

describe('GUI token management (PUT /api/auth/token)', () => {
  it('initialises auth from the open state, generating a token, and signs the caller in', async () => {
    const persisted: string[] = []
    const { server, base } = startServer({ persist: (t) => persisted.push(t) })
    running = server

    // Open: the PUT is reachable with no credentials to bootstrap auth.
    const res = await fetch(`${base}/api/auth/token`, { method: 'PUT', body: '{}' })
    expect(res.status).toBe(200)
    const token = ((await res.json()) as { token: string }).token
    expect(token.length).toBeGreaterThanOrEqual(16)
    expect(persisted).toEqual([token])

    // Now gated: the returned cookie authorizes, no credential does not.
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!
    expect((await fetch(`${base}/api/cluster`)).status).toBe(401)
    expect((await fetch(`${base}/api/cluster`, { headers: { cookie } })).status).toBe(200)
    // And the generated token works as a bearer.
    expect(
      (await fetch(`${base}/api/cluster`, { headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(200)
  })

  it('accepts an explicit token and rejects one that is too short', async () => {
    const { server, base } = startServer()
    running = server

    expect((await fetch(`${base}/api/auth/token`, { method: 'PUT', body: '{"token":"short"}' })).status).toBe(400)

    const ok = await fetch(`${base}/api/auth/token`, {
      method: 'PUT',
      body: JSON.stringify({ token: 'a-nice-long-explicit-token' }),
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { token: string }).token).toBe('a-nice-long-explicit-token')
  })

  it('requires an authorized caller to rotate once auth is enabled', async () => {
    const { server, base } = startServer('the-existing-token')
    running = server

    // Enabled + no credential: the gate blocks the rotate.
    expect((await fetch(`${base}/api/auth/token`, { method: 'PUT', body: '{}' })).status).toBe(401)

    const rotated = await fetch(`${base}/api/auth/token`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer the-existing-token' },
      body: JSON.stringify({ token: 'the-rotated-token-value' }),
    })
    expect(rotated.status).toBe(200)

    // Rotation revokes the old token; the new one works.
    expect(
      (await fetch(`${base}/api/cluster`, { headers: { Authorization: 'Bearer the-existing-token' } })).status,
    ).toBe(401)
    expect(
      (await fetch(`${base}/api/cluster`, { headers: { Authorization: 'Bearer the-rotated-token-value' } })).status,
    ).toBe(200)
  })

  it('answers 500 and keeps the old token active when persisting fails', async () => {
    const { server, base } = startServer({
      token: 'the-existing-token',
      persist: () => {
        throw new Error('disk full')
      },
    })
    running = server

    const res = await fetch(`${base}/api/auth/token`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer the-existing-token' },
      body: JSON.stringify({ token: 'the-would-be-new-token' }),
    })
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toContain('persist')

    // The rotation did not happen: old token still works, new one doesn't.
    expect(
      (await fetch(`${base}/api/cluster`, { headers: { Authorization: 'Bearer the-existing-token' } })).status,
    ).toBe(200)
    expect(
      (await fetch(`${base}/api/cluster`, { headers: { Authorization: 'Bearer the-would-be-new-token' } })).status,
    ).toBe(401)

    // Bootstrapping from open fails the same way — the proxy stays open
    // instead of enabling a token that a restart would silently drop.
    const openServer = startServer({
      persist: () => {
        throw new Error('disk full')
      },
    })
    try {
      const boot = await fetch(`${openServer.base}/api/auth/token`, { method: 'PUT', body: '{}' })
      expect(boot.status).toBe(500)
      expect((await fetch(`${openServer.base}/api/cluster`)).status).toBe(200)
    } finally {
      openServer.server.close()
    }
  })

  it('refuses to change an env-managed token (409) but still reports and reveals it', async () => {
    const { server, base } = startServer({ token: 'env-token-value', managedByEnv: true })
    running = server

    const status = await (await fetch(`${base}/api/auth`)).json()
    expect(status).toEqual({ required: true, authorized: false, managedByEnv: true })

    const res = await fetch(`${base}/api/auth/token`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer env-token-value' },
      body: '{}',
    })
    expect(res.status).toBe(409)
  })
})

describe('request body size cap', () => {
  const oversized = `{"token":"${'x'.repeat(1024 * 1024 + 64)}"}`

  it('answers 413 on the unauthenticated login and token-bootstrap routes', async () => {
    // Open proxy: the PUT is reachable with no credentials — the cap is what
    // keeps an anonymous caller from buffering arbitrary data into memory.
    const open = startServer()
    running = open.server
    const put = await fetch(`${open.base}/api/auth/token`, { method: 'PUT', body: oversized })
    expect(put.status).toBe(413)
    // Nothing was applied: the proxy is still open.
    expect((await fetch(`${open.base}/api/cluster`)).status).toBe(200)
    open.server.close()

    const gated = startServer('sekrit')
    running = gated.server
    const login = await fetch(`${gated.base}/api/login`, { method: 'POST', body: oversized })
    expect(login.status).toBe(413)
  })

  it('caps chunked transfers, which carry no Content-Length to pre-check', async () => {
    const { server, base } = startServer('sekrit')
    running = server

    const port = Number(new URL(base).port)
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/login', method: 'POST' },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      // The server may tear the socket down as soon as it has answered —
      // writes racing that teardown are expected, not a test failure.
      req.on('error', reject)
      const chunk = 'y'.repeat(64 * 1024)
      let sent = 0
      const writeMore = () => {
        while (sent < 1024 * 1024 + 128 * 1024) {
          sent += chunk.length
          if (!req.write(chunk)) {
            req.once('drain', writeMore)
            return
          }
        }
        req.end()
      }
      writeMore()
    }).catch((err: unknown) => {
      // An ECONNRESET/EPIPE here means the server cut the upload off — the
      // cap worked; only a completed non-413 response is a real failure.
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET' || (err as NodeJS.ErrnoException).code === 'EPIPE') {
        return 413
      }
      throw err
    })
    expect(status).toBe(413)
  })
})

describe('read-only mode', () => {
  it('answers 403 on every mutating route, before routing even matches', async () => {
    const { server, base } = startServer(undefined, undefined, true)
    running = server

    expect((await fetch(`${base}/api/cluster`)).status).toBe(200)

    const paused = await fetch(`${base}/api/devices/SOME-DEVICE/pause`, { method: 'POST' })
    expect(paused.status).toBe(403)
    expect(((await paused.json()) as { error: string }).error).toContain('read-only')
    // Even routes that mutate only the proxy itself (token rotation) are
    // blocked — a read-only instance is fully immutable.
    expect((await fetch(`${base}/api/auth/token`, { method: 'PUT', body: '{}' })).status).toBe(403)
  })

  it('still allows the login/logout handshake and every read', async () => {
    const { server, base } = startServer('sekrit-token-value', undefined, true)
    running = server

    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ token: 'sekrit-token-value' }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!

    expect((await fetch(`${base}/api/cluster`, { headers: { cookie } })).status).toBe(200)
    expect((await fetch(`${base}/api/auth/token`, { headers: { cookie } })).status).toBe(200)
    expect((await fetch(`${base}/api/logout`, { method: 'POST' })).status).toBe(200)
    // The auth gate still wins over the read-only gate: no credential -> 401.
    expect((await fetch(`${base}/api/devices/X/pause`, { method: 'POST' })).status).toBe(401)
    // And with a credential, mutation is 403, not attempted.
    expect((await fetch(`${base}/api/devices/X/pause`, { method: 'POST', headers: { cookie } })).status).toBe(403)
  })
})

describe('static SPA serving', () => {
  function makeWebRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'cf-web-'))
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>cf</title>')
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)')
    return root
  }

  it('serves files, falls back to index.html for app paths, even unauthenticated', async () => {
    const root = makeWebRoot()
    try {
      const { server, base } = startServer('sekrit', root)
      running = server

      const index = await fetch(`${base}/`)
      expect(index.headers.get('content-type')).toContain('text/html')
      expect(index.headers.get('cache-control')).toBe('no-cache')
      expect(await index.text()).toContain('cf')

      // Hashed asset names are immutable content — cache them hard.
      const js = await fetch(`${base}/assets/app.js`)
      expect(js.headers.get('content-type')).toContain('javascript')
      expect(js.headers.get('cache-control')).toContain('immutable')

      // Unknown non-API path -> SPA fallback, so the login screen can load anywhere.
      expect((await fetch(`${base}/some/app/route`)).status).toBe(200)
      // API misses stay hard 404s (the stale-proxy diagnostic).
      expect((await fetch(`${base}/api/definitely-not-a-route`, { headers: { Authorization: 'Bearer sekrit' } })).status).toBe(404)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('hard-404s a missing file with an extension instead of masquerading index.html as it', async () => {
    const root = makeWebRoot()
    try {
      const { server, base } = startServer(undefined, root)
      running = server

      // A stale hashed chunk after a redeploy must fail diagnosably, not
      // parse HTML as JavaScript.
      expect((await fetch(`${base}/assets/index-OLDHASH.js`)).status).toBe(404)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('answers malformed percent-encoding with 404, not a decodeURIComponent 500', async () => {
    const root = makeWebRoot()
    try {
      const { server, base } = startServer(undefined, root)
      running = server

      const port = Number(new URL(base).port)
      for (const path of ['/%', '/%zz', '/%e0%a4']) {
        const status = await new Promise<number>((resolve, reject) => {
          request({ host: '127.0.0.1', port, path }, (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          })
            .on('error', reject)
            .end()
        })
        expect(status, path).toBe(404)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses paths that resolve outside the web root', async () => {
    const root = makeWebRoot()
    try {
      const { server, base } = startServer(undefined, root)
      running = server

      // A plain /%2e%2e/ is neutralized by WHATWG URL parsing itself (it
      // normalizes to a path inside the root). The vector our decode-and-
      // resolve check exists for is %2f-encoded slashes: "%2e%2e%2f" stays
      // one opaque segment through URL parsing and only becomes "../" at
      // our decodeURIComponent. Sent raw — fetch() would normalize the URL
      // client-side and test nothing.
      const port = Number(new URL(base).port)
      const status = await new Promise<number>((resolve, reject) => {
        request(
          { host: '127.0.0.1', port, path: '/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd' },
          (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          },
        )
          .on('error', reject)
          .end()
      })
      expect(status).toBe(404)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('createStaticHandler returns undefined without a build (API-only mode)', () => {
    expect(createStaticHandler('/definitely/not/a/dir')).toBeUndefined()
  })
})

describe('listenReady', () => {
  it('resolves once the port is bound and the server answers', async () => {
    const manager = new ClusterStateManager([], { clusterId: 't', label: 'T' })
    const server = createHttpServer(manager, '*', createAuth({}))
    await listenReady(server, 0)
    const address = server.address()
    expect(address).not.toBeNull()
    server.close()
  })

  // Regression: server.listen() reports a failed bind via an async 'error'
  // event after the call returns — an uncaught exception no caller could
  // catch, which crashed every install with a raw stack (and, embedded in
  // the desktop app, popped Electron's raw error dialog instead of ours).
  it('rejects with a friendly message when the port is already taken', async () => {
    const manager = new ClusterStateManager([], { clusterId: 't', label: 'T' })
    const first = createHttpServer(manager, '*', createAuth({}))
    await listenReady(first, 0)
    const port = (first.address() as { port: number }).port

    const second = createHttpServer(manager, '*', createAuth({}))
    await expect(listenReady(second, port)).rejects.toThrow(/already in use/)

    first.close()
  })
})
