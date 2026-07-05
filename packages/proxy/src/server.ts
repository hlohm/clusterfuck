import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { InvalidTargetError, NotManagedError, type ClusterStateManager } from './clusterState.ts'
import { SYNCTHING_FOLDER_TYPES, type SyncthingFolderType } from './syncthing/types.ts'
import { PROXY_VERSION } from './version.ts'

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

  // Cheap way to tell a stale running process apart from a freshly deployed
  // one — compare this against the frontend build's own version.
  if (url.pathname === '/api/version' && method === 'GET') {
    sendJson(res, 200, { version: PROXY_VERSION })
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
    // POST /api/devices — add a device to the named registered nodes' configs
    if (method === 'POST' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'devices') {
      const body = (await readJsonBody(req)) as
        | { deviceId?: unknown; name?: unknown; nodes?: unknown }
        | undefined
      if (typeof body?.deviceId !== 'string' || body.deviceId === '') {
        sendJson(res, 400, { error: 'deviceId is required' })
        return
      }
      if (!Array.isArray(body.nodes) || !body.nodes.every((n) => typeof n === 'string')) {
        sendJson(res, 400, { error: 'nodes must be an array of registered node device IDs' })
        return
      }
      await manager.addDevice(
        body.deviceId,
        typeof body.name === 'string' && body.name !== '' ? body.name : undefined,
        body.nodes,
      )
      sendJson(res, 200, { ok: true })
      return
    }

    // POST /api/folders — create a folder on (and shared among) the named nodes
    if (method === 'POST' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'folders') {
      const body = (await readJsonBody(req)) as
        | { folderId?: unknown; label?: unknown; path?: unknown; type?: unknown; devices?: unknown }
        | undefined
      if (typeof body?.folderId !== 'string' || body.folderId === '') {
        sendJson(res, 400, { error: 'folderId is required' })
        return
      }
      if (!Array.isArray(body.devices) || !body.devices.every((d) => typeof d === 'string')) {
        sendJson(res, 400, { error: 'devices must be an array of registered node device IDs' })
        return
      }
      const type = body.type ?? 'sendreceive'
      if (!isFolderType(type)) {
        sendJson(res, 400, {
          error: `type must be one of: ${SYNCTHING_FOLDER_TYPES.join(', ')}`,
        })
        return
      }
      await manager.createFolder(
        {
          id: body.folderId,
          label: typeof body.label === 'string' && body.label !== '' ? body.label : body.folderId,
          path: typeof body.path === 'string' && body.path !== '' ? body.path : `~/${body.folderId}`,
          type,
        },
        body.devices,
      )
      sendJson(res, 200, { ok: true })
      return
    }

    // POST /api/devices/:deviceId/pause|resume — ":deviceId" of "all" means
    // every device on every registered node (cluster-wide), not a literal id.
    if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'devices') {
      const rawId = parts[2]!
      const action = parts[3]
      if (action === 'pause' || action === 'resume') {
        if (rawId === 'all') {
          await manager.setAllDevicesPaused(action === 'pause')
        } else {
          await manager.setDevicePaused(decodeURIComponent(rawId), action === 'pause')
        }
        sendJson(res, 200, { ok: true })
        return
      }
    }

    // POST /api/folders/all/pause|resume — cluster-wide, every folder on every registered node
    if (
      method === 'POST' &&
      parts.length === 4 &&
      parts[0] === 'api' &&
      parts[1] === 'folders' &&
      parts[2] === 'all'
    ) {
      const action = parts[3]
      if (action === 'pause' || action === 'resume') {
        await manager.setAllFoldersPaused(action === 'pause')
        sendJson(res, 200, { ok: true })
        return
      }
    }

    // DELETE /api/devices/:deviceId — remove as a peer from every registered node that has it
    if (method === 'DELETE' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'devices') {
      const deviceId = decodeURIComponent(parts[2]!)
      await manager.removeDevice(deviceId)
      sendJson(res, 200, { ok: true })
      return
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

      // Removes the folder from this one node's config only — not cluster-wide.
      if (method === 'DELETE' && parts.length === 5) {
        await manager.removeFolder(deviceId, folderId)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && parts.length === 6 && parts[5] === 'shares') {
        const body = (await readJsonBody(req)) as
          | { deviceId?: unknown; encryptionPassword?: unknown }
          | undefined
        if (typeof body?.deviceId !== 'string' || body.deviceId === '') {
          sendJson(res, 400, { error: 'deviceId is required' })
          return
        }
        if (body.encryptionPassword !== undefined && typeof body.encryptionPassword !== 'string') {
          sendJson(res, 400, { error: 'encryptionPassword must be a string' })
          return
        }
        // Pass the field through as-is (not `|| undefined`) — an explicit
        // empty string is how a caller clears an already-set password, and
        // coercing it away would make that silently impossible.
        await manager.addShare(deviceId, folderId, body.deviceId, body.encryptionPassword)
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

  // Logged, not silent: an unmatched API path/method is usually a client/
  // proxy version mismatch (e.g. a newer frontend calling a route an older
  // running proxy process doesn't have yet) — this is the fastest way to
  // tell the two apart from a generic 404 in the browser.
  console.error(`[clusterfuck-proxy] no route for ${method} ${url.pathname}`)
  res.statusCode = 404
  res.end('not found')
}
