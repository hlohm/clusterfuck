import { loadNodeConfig } from './config.ts'
import { ClusterStateManager } from './clusterState.ts'
import { createHttpServer } from './server.ts'

const port = Number(process.env.PORT ?? 4000)
const webOrigin = process.env.CLUSTERFUCK_WEB_ORIGIN ?? 'http://localhost:5173'

const nodes = loadNodeConfig()
const manager = new ClusterStateManager(nodes, { clusterId: 'live', label: 'Live cluster' })
const server = createHttpServer(manager, webOrigin)

manager.start().catch((err: unknown) => {
  console.error('[clusterfuck-proxy] failed to start cluster state manager:', err)
  process.exit(1)
})

server.listen(port, () => {
  console.log(`[clusterfuck-proxy] listening on http://localhost:${port}`)
})
