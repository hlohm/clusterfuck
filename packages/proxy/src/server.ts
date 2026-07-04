import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { InvalidTargetError, NotManagedError, type ClusterStateManager } from './clusterState.ts'
import { SYNCTHING_FOLDER_TYPES, type SyncthingFolderType } from './syncthing/types.ts'

/** Sentinel thrown by readJsonBody so the handler can answer 400, not 502. */
class BodyParseError extends Error {}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new BodyParseError('request body is not valid JSON')
  }
}

function isFolderType(value: unknown): value is SyncthingFolderType {
  return (SYNCTHING_FOLDER_TYPES as readonly unknown[]).includes(value)
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
  // One subscription serializes each new model once and fans the same frame
  // out to every SSE client, instead of stringifying per client per change.
  const sseClients = new Set<ServerResponse>()
  manager.subscribe((model) => {
    if (sseClients.size === 0) return
    const frame = `data: ${JSON.stringify(model)}\n\n`
    for (const client of sseClients) client.write(frame)
  })

  return createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    handleRequest(req, res, manager, sseClients).catch((err: unknown) => {
      console.error('[clusterfuck-proxy] unhandled request error:', err)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
    })
  })
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  manager: ClusterStateManager,
  sseClients: Set<ServerResponse>,
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
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
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
        const body = (await readJsonBody(req)) as { type?: unknown } | undefined
        if (!isFolderType(body?.type)) {
          sendJson(res, 400, {
            error: `type must be one of: ${SYNCTHING_FOLDER_TYPES.join(', ')}`,
          })
          return
        }
        await manager.setFolderType(deviceId, folderId, body.type)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && parts.length === 6 && parts[5] === 'shares') {
        const body = (await readJsonBody(req)) as { deviceId?: unknown } | undefined
        if (typeof body?.deviceId !== 'string' || body.deviceId === '') {
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
    if (err instanceof BodyParseError || err instanceof InvalidTargetError) {
      sendJson(res, 400, { error: err.message })
      return
    }
    if (err instanceof NotManagedError) {
      sendJson(res, 409, { error: err.message })
      return
    }
    const message = (err as Error).message
    console.error('[clusterfuck-proxy] mutation failed:', message)
    sendJson(res, 502, { error: message })
    return
  }

  res.statusCode = 404
  res.end('not found')
}
