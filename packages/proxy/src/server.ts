import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { NotManagedError, type ClusterStateManager } from './clusterState.ts'
import type { SyncthingFolderType } from './syncthing/types.ts'

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Minimal HTTP surface: no framework, hand-matched routes. Read-only routes
 * from Phase 2 plus Phase 3's per-node/per-folder mutation routes — no
 * cluster-wide actions and no auth, per the confirmed Phase 3 decisions.
 */
export function createHttpServer(manager: ClusterStateManager, allowedOrigin: string): Server {
  return createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    handleRequest(req, res, manager).catch((err: unknown) => {
      console.error('[clusterfuck-proxy] unhandled request error:', err)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
    })
  })
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  manager: ClusterStateManager,
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', 'http://internal')
  const parts = url.pathname.split('/').filter(Boolean)

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  if (url.pathname === '/api/health' && method === 'GET') {
    res.end('ok')
    return
  }

  if (url.pathname === '/api/cluster' && method === 'GET') {
    sendJson(res, 200, manager.getModel())
    return
  }

  if (url.pathname === '/api/events' && method === 'GET') {
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

  try {
    // POST /api/devices/:deviceId/pause|resume
    if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'devices') {
      const deviceId = decodeURIComponent(parts[2]!)
      const action = parts[3]
      if (action === 'pause' || action === 'resume') {
        await manager.setDevicePaused(deviceId, action === 'pause')
        sendJson(res, 200, { ok: true })
        return
      }
    }

    // /api/folders/:folderId/devices/:deviceId[/...] — :deviceId is the
    // registered node's own Syncthing device ID (same value as a Share's
    // deviceId), identifying whose folder config we're editing.
    if (parts.length >= 5 && parts[0] === 'api' && parts[1] === 'folders' && parts[3] === 'devices') {
      const folderId = decodeURIComponent(parts[2]!)
      const deviceId = decodeURIComponent(parts[4]!)

      if (method === 'POST' && parts.length === 6 && parts[5] === 'rescan') {
        await manager.rescanFolder(deviceId, folderId)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && parts.length === 6 && (parts[5] === 'pause' || parts[5] === 'resume')) {
        await manager.setFolderPaused(deviceId, folderId, parts[5] === 'pause')
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'PATCH' && parts.length === 5) {
        const body = (await readJsonBody(req)) as { type?: SyncthingFolderType } | undefined
        if (!body?.type) {
          sendJson(res, 400, { error: 'type is required' })
          return
        }
        await manager.setFolderType(deviceId, folderId, body.type)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && parts.length === 6 && parts[5] === 'shares') {
        const body = (await readJsonBody(req)) as { deviceId?: string } | undefined
        if (!body?.deviceId) {
          sendJson(res, 400, { error: 'deviceId is required' })
          return
        }
        await manager.addShare(deviceId, folderId, body.deviceId)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'DELETE' && parts.length === 7 && parts[5] === 'shares') {
        const targetDeviceId = decodeURIComponent(parts[6]!)
        await manager.removeShare(deviceId, folderId, targetDeviceId)
        sendJson(res, 200, { ok: true })
        return
      }
    }
  } catch (err) {
    if (err instanceof NotManagedError) {
      sendJson(res, 409, { error: err.message })
      return
    }
    console.error('[clusterfuck-proxy] mutation failed:', (err as Error).message)
    sendJson(res, 502, { error: 'upstream request failed' })
    return
  }

  res.statusCode = 404
  res.end('not found')
}
