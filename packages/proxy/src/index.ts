import { join } from 'node:path'
import { createAuth } from './auth.ts'
import { loadNodeConfig } from './config.ts'
import { ClusterStateManager } from './clusterState.ts'
import { createHttpServer } from './server.ts'
import { createStaticHandler } from './static.ts'

const port = Number(process.env.PORT ?? 4000)
const webOrigin = process.env.CLUSTERFUCK_WEB_ORIGIN ?? 'http://localhost:5173'

const auth = createAuth(process.env.CLUSTERFUCK_TOKEN)
if (!auth.enabled) {
  console.warn(
    '[clusterfuck-proxy] WARNING: no CLUSTERFUCK_TOKEN set — the proxy is UNAUTHENTICATED. ' +
      'Anyone who can reach this port can read and mutate every registered node. ' +
      'Set CLUSTERFUCK_TOKEN before exposing it beyond a trusted network.',
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

const nodes = loadNodeConfig()
const manager = new ClusterStateManager(nodes, { clusterId: 'live', label: 'Live cluster' })
const server = createHttpServer(manager, webOrigin, auth, staticHandler)

manager.start().catch((err: unknown) => {
  console.error('[clusterfuck-proxy] failed to start cluster state manager:', err)
  process.exit(1)
})

server.listen(port, () => {
  console.log(`[clusterfuck-proxy] listening on http://localhost:${port}`)
})
