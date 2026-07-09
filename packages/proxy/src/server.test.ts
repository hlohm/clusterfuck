import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, type Server } from 'node:http'
import { ClusterStateManager } from './clusterState.ts'
import { createAuth } from './auth.ts'
import { createHttpServer } from './server.ts'
import { createStaticHandler } from './static.ts'

/**
 * End-to-end over a real socket: a zero-node manager (never started, so no
 * event/poll loops), real auth, and a temp-dir web build.
 */
function startServer(token: string | undefined, webRoot?: string) {
  const manager = new ClusterStateManager([], { clusterId: 'test', label: 'Test' })
  const server = createHttpServer(
    manager,
    'http://localhost:5173',
    createAuth(token),
    webRoot !== undefined ? createStaticHandler(webRoot) : undefined,
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
    expect(await status.json()).toEqual({ required: true, authorized: false })
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
    expect(await (await fetch(`${base}/api/auth`)).json()).toEqual({ required: false, authorized: true })
    expect((await fetch(`${base}/api/login`, { method: 'POST', body: '{"token":"x"}' })).status).toBe(400)
    expect((await fetch(`${base}/api/auth/token`)).status).toBe(404)
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
