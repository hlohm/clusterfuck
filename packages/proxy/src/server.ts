import { createServer, type Server } from 'node:http'
import type { ClusterStateManager } from './clusterState.ts'

/** Minimal HTTP surface: no framework needed for three read-only routes. */
export function createHttpServer(manager: ClusterStateManager, allowedOrigin: string): Server {
  return createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)

    if (req.url === '/api/health' && req.method === 'GET') {
      res.end('ok')
      return
    }

    if (req.url === '/api/cluster' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(manager.getModel()))
      return
    }

    if (req.url === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify(manager.getModel())}\n\n`)

      const unsubscribe = manager.subscribe((model) => {
        res.write(`data: ${JSON.stringify(model)}\n\n`)
      })
      req.on('close', unsubscribe)
      return
    }

    res.statusCode = 404
    res.end('not found')
  })
}
