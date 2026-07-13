import { join } from 'node:path'
import { createAuth } from './auth.ts'
import { loadAuthToken, saveAuthToken } from './authStore.ts'
import { loadNodeConfig } from './config.ts'
import { ClusterStateManager } from './clusterState.ts'
import { createHttpServer, listenReady } from './server.ts'
import { createStaticHandler } from './static.ts'

const port = Number(process.env.PORT ?? 4000)
const webOrigin = process.env.CLUSTERFUCK_WEB_ORIGIN ?? 'http://localhost:5173'
if (webOrigin === '*') {
  // Every web request is credentialed now (the auth cookie), and browsers
  // reject Allow-Origin '*' combined with credentials — so a wildcard here
  // silently breaks every cross-origin fetch. It was never a documented
  // value, but fail loudly rather than mysteriously.
  console.warn(
    "[clusterfuck-proxy] WARNING: CLUSTERFUCK_WEB_ORIGIN='*' cannot work with credentialed " +
      'requests (browsers reject it) — set the exact origin the web app is served from.',
  )
}

// Token precedence: CLUSTERFUCK_TOKEN env (authoritative) > persisted auth
// file > none (open). A non-env-managed token set/rotated from the GUI is
// persisted back to the file. A persist failure must propagate: setToken
// aborts without changing the active token, and the PUT route answers 500 —
// swallowing it here would hand the caller a token that silently reverts on
// the next restart.
const loaded = loadAuthToken()
const auth = createAuth({
  token: loaded.token,
  managedByEnv: loaded.managedByEnv,
  persist: saveAuthToken,
})
if (!auth.enabled) {
  console.warn(
    '[clusterfuck-proxy] WARNING: no auth token set — the proxy is UNAUTHENTICATED. ' +
      'Anyone who can reach this port can read and mutate every registered node. ' +
      'Set a token from the app (Settings) or via CLUSTERFUCK_TOKEN before exposing it ' +
      'beyond a trusted network.',
  )
}

const webDist = process.env.CLUSTERFUCK_WEB_DIST ?? join(import.meta.dirname, '../../web/dist')
const staticHandler = createStaticHandler(webDist)
if (staticHandler === undefined) {
  console.log(
    `[clusterfuck-proxy] no web build at ${webDist} — serving the API only ` +
      '(run `pnpm build` to serve the app from this process, or set CLUSTERFUCK_WEB_DIST)',
  )
}

// Read-only deployment mode: every mutating /api route answers 403. For
// dashboard-style instances, and for provably-safe soaks against a real
// cluster (ROADMAP "live-cluster hardening" Tier 2).
const readonly = ['1', 'true', 'yes'].includes(
  (process.env.CLUSTERFUCK_READONLY ?? '').toLowerCase(),
)
if (readonly) {
  console.log('[clusterfuck-proxy] CLUSTERFUCK_READONLY is set — all mutation routes answer 403')
}

const nodes = loadNodeConfig()
const manager = new ClusterStateManager(nodes, { clusterId: 'live', label: 'Live cluster' })
const server = createHttpServer(manager, webOrigin, auth, staticHandler, readonly)

// This entry point also runs esbuild-bundled inside Electron's main process
// (packages/desktop), where process.exit() would kill the whole app with no
// window and no dialog — there, fatal errors are the host's to present, via
// the exported `ready` promise below.
const embedded = Boolean(process.versions.electron)

manager.start().catch((err: unknown) => {
  console.error('[clusterfuck-proxy] failed to start cluster state manager:', err)
  // Embedded: stay up. The window is already open (or opening) against a
  // healthy listener — a visible app with an empty model and this log beats
  // an app that silently vanishes.
  if (!embedded) process.exit(1)
})

/**
 * Resolves once the proxy is listening; rejects if the port can't be bound.
 * The desktop app awaits this to show bind failures in its own dialog.
 */
export const ready: Promise<void> = listenReady(server, port).then(() => {
  // Report the bound port, not the requested one — they differ for PORT=0.
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  console.log(`[clusterfuck-proxy] listening on http://localhost:${bound}`)
})

ready.catch((err: unknown) => {
  console.error('[clusterfuck-proxy] failed to start:', err instanceof Error ? err.message : err)
  if (!embedded) process.exit(1)
})
