import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import type { Auth } from './auth.ts'
import type { StaticHandler } from './static.ts'
import {
  COMPRESSION_LEVELS,
  isCompressionLevel,
  isMinDiskFreeUnit,
  isVersioningType,
  MIN_DISK_FREE_UNITS,
  VERSIONING_TYPES,
} from '@clusterfuck/shared'
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

/** A plain object whose every value is a string — Syncthing's versioning params shape. */
function isStringMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  )
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Minimal HTTP surface: no framework, hand-matched routes. Read-only routes
 * from Phase 2, the mutation routes from Phase 3 on, optional shared-token
 * auth (Phase 5 foundations), and static serving of the built SPA so
 * production is one process on one origin.
 */
export function createHttpServer(
  manager: ClusterStateManager,
  allowedOrigin: string,
  auth: Auth,
  staticHandler?: StaticHandler,
): Server {
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
    // Cookies across a split-origin deployment need the explicit opt-in.
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    handleRequest(req, res, manager, sseClients, auth, staticHandler).catch((err: unknown) => {
      console.error('[clusterfuck-proxy] unhandled request error:', err)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
    })
  })
}

/**
 * Routes reachable without credentials when auth is on: the login handshake
 * (logout included — clearing a cookie needs no valid session, and gating it
 * would strand a browser whose session was just revoked), and the
 * health/version probes monitoring needs. Everything else under /api —
 * including the SSE stream — requires the token or the cookie.
 */
function isAuthExempt(method: string, pathname: string): boolean {
  return (
    (method === 'GET' &&
      (pathname === '/api/health' || pathname === '/api/version' || pathname === '/api/auth')) ||
    (method === 'POST' && (pathname === '/api/login' || pathname === '/api/logout'))
  )
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  manager: ClusterStateManager,
  sseClients: Set<ServerResponse>,
  auth: Auth,
  staticHandler?: StaticHandler,
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', 'http://internal')
  const parts = url.pathname.split('/').filter(Boolean)
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/')

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    })
    res.end()
    return
  }

  // The auth gate — before any routing. Static files stay reachable (the
  // login screen has to load from somewhere).
  const authorized = auth.isAuthorized(req)
  if (auth.enabled && isApi && !authorized && !isAuthExempt(method, url.pathname)) {
    sendJson(res, 401, { error: 'authentication required' })
    return
  }

  // Whether this deployment needs a login, and whether this caller has one —
  // the SPA's first question on load.
  if (url.pathname === '/api/auth' && method === 'GET') {
    sendJson(res, 200, { required: auth.enabled, authorized })
    return
  }

  // Exchange the shared token for the HttpOnly session cookie (EventSource
  // can't send an Authorization header, but it sends cookies).
  if (url.pathname === '/api/login' && method === 'POST') {
    if (!auth.enabled) {
      sendJson(res, 400, { error: 'authentication is not enabled on this proxy' })
      return
    }
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      sendJson(res, 400, { error: 'request body is not valid JSON' })
      return
    }
    const token = (body as { token?: unknown } | undefined)?.token
    if (typeof token !== 'string' || !auth.tokenMatches(token)) {
      sendJson(res, 401, { error: 'invalid token' })
      return
    }
    auth.setSessionCookie(res)
    sendJson(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/api/logout' && method === 'POST') {
    auth.clearSessionCookie(res)
    sendJson(res, 200, { ok: true })
    return
  }

  // The GUI's "retrieve the token" reveal — authorized callers only (the
  // gate above already enforced that), mirroring Syncthing's own GUI
  // showing its API key in settings. 404 when auth is off: there is no
  // token to reveal.
  if (url.pathname === '/api/auth/token' && method === 'GET') {
    if (!auth.enabled) {
      sendJson(res, 404, { error: 'authentication is not enabled on this proxy' })
      return
    }
    sendJson(res, 200, { token: auth.token })
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

  // The merged recent-changes feed (newest first). In-memory and bounded —
  // a "what just happened" glance, not a persisted audit log.
  if (url.pathname === '/api/changes' && method === 'GET') {
    sendJson(res, 200, manager.getRecentChanges())
    return
  }

  // Recent per-share completion samples — the overview sparklines' data.
  // Same in-memory/bounded stance as /api/changes.
  if (url.pathname === '/api/history/completion' && method === 'GET') {
    sendJson(res, 200, manager.getCompletionHistory())
    return
  }

  // The merged raw event log, newest first. ?types=a,b narrows to those
  // event types, ?node=<device ID> to one node, ?limit=N caps the count.
  // (Distinct from GET /api/events, the SSE model stream.)
  if (url.pathname === '/api/events/log' && method === 'GET') {
    const typesParam = url.searchParams.get('types')
    const limitParam = url.searchParams.get('limit')
    const limit = limitParam !== null ? Number(limitParam) : undefined
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      sendJson(res, 400, { error: 'limit must be a positive integer' })
      return
    }
    sendJson(
      res,
      200,
      manager.getEventLog({
        types: typesParam !== null ? new Set(typesParam.split(',').filter((t) => t !== '')) : undefined,
        nodeId: url.searchParams.get('node') ?? undefined,
        limit,
      }),
    )
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

    // POST /api/nodes — register a new node at runtime (Phase 5's node
    // registration UI), persisted server-side to cluster.json.
    if (method === 'POST' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'nodes') {
      const body = (await readJsonBody(req)) as
        | { id?: unknown; url?: unknown; apiKey?: unknown }
        | undefined
      if (typeof body?.id !== 'string' || body.id === '') {
        sendJson(res, 400, { error: 'id is required' })
        return
      }
      if (typeof body.url !== 'string' || body.url === '') {
        sendJson(res, 400, { error: 'url is required' })
        return
      }
      if (typeof body.apiKey !== 'string' || body.apiKey === '') {
        sendJson(res, 400, { error: 'apiKey is required' })
        return
      }
      await manager.addNode({ id: body.id, url: body.url, apiKey: body.apiKey })
      sendJson(res, 200, { ok: true })
      return
    }

    // DELETE /api/nodes/:id — de-registers a node from this proxy. Doesn't
    // touch that node's own Syncthing config, and doesn't remove it as a
    // peer from any other registered node (see DELETE /api/devices/:id).
    if (method === 'DELETE' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'nodes') {
      await manager.removeNode(decodeURIComponent(parts[2]!))
      sendJson(res, 200, { ok: true })
      return
    }

    // GET /api/upgrade — the current/most recent upgrade sweep (null before
    // the first). POST /api/upgrade — start a sweep: every registered node,
    // one at a time, health-checked; returns immediately, poll the GET.
    if (parts.length === 2 && parts[0] === 'api' && parts[1] === 'upgrade') {
      if (method === 'GET') {
        sendJson(res, 200, { run: manager.getUpgradeRun() ?? null })
        return
      }
      if (method === 'POST') {
        sendJson(res, 200, { run: manager.startUpgradeAll() })
        return
      }
    }

    // GET /api/bandwidth — every registered node's global send/receive caps.
    // PUT /api/bandwidth — set the same caps on every registered node;
    // PUT /api/nodes/:deviceId/bandwidth — on one node.
    if (parts.length >= 2 && parts[0] === 'api') {
      const isGlobal = parts.length === 2 && parts[1] === 'bandwidth'
      const isPerNode = parts.length === 4 && parts[1] === 'nodes' && parts[3] === 'bandwidth'
      if (isGlobal && method === 'GET') {
        sendJson(res, 200, await manager.getBandwidthLimits())
        return
      }
      if ((isGlobal || isPerNode) && method === 'PUT') {
        const body = (await readJsonBody(req)) as
          | { maxSendKbps?: unknown; maxRecvKbps?: unknown }
          | undefined
        const validKbps = (v: unknown): v is number =>
          typeof v === 'number' && Number.isInteger(v) && v >= 0
        if (!validKbps(body?.maxSendKbps) || !validKbps(body.maxRecvKbps)) {
          sendJson(res, 400, { error: 'maxSendKbps and maxRecvKbps must be integers >= 0 (0 = unlimited)' })
          return
        }
        await manager.setBandwidthLimits(
          isPerNode ? decodeURIComponent(parts[2]!) : undefined,
          { maxSendKbps: body.maxSendKbps, maxRecvKbps: body.maxRecvKbps },
        )
        sendJson(res, 200, { ok: true })
        return
      }
    }

    // GET /api/devices/:deviceId/qr — PNG QR of the device ID, relayed from
    // a registered node's own /qr/ endpoint (no QR library in the proxy).
    if (
      method === 'GET' &&
      parts.length === 4 &&
      parts[0] === 'api' &&
      parts[1] === 'devices' &&
      parts[3] === 'qr'
    ) {
      const png = await manager.getDeviceQr(decodeURIComponent(parts[2]!))
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' })
      res.end(png)
      return
    }

    // GET/PUT /api/devices/:deviceId/options — how every referencing
    // registered node has this device configured / apply the same options on
    // all of them (same fan-out scope as pause/remove; never the device's
    // own self-entry).
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'devices' && parts[3] === 'options') {
      const deviceId = decodeURIComponent(parts[2]!)
      if (method === 'GET') {
        sendJson(res, 200, await manager.getDeviceOptions(deviceId))
        return
      }
      if (method === 'PUT') {
        const body = (await readJsonBody(req)) as
          | {
              name?: unknown
              addresses?: unknown
              compression?: unknown
              introducer?: unknown
              autoAcceptFolders?: unknown
              maxSendKbps?: unknown
              maxRecvKbps?: unknown
            }
          | undefined
        if (typeof body?.name !== 'string') {
          sendJson(res, 400, { error: 'name must be a string (may be empty to show the device ID)' })
          return
        }
        if (
          !Array.isArray(body.addresses) ||
          body.addresses.length === 0 ||
          !body.addresses.every((a) => typeof a === 'string' && a !== '')
        ) {
          sendJson(res, 400, {
            error: 'addresses must be a non-empty array of non-empty strings (use ["dynamic"] for discovery)',
          })
          return
        }
        if (!isCompressionLevel(body.compression)) {
          sendJson(res, 400, { error: `compression must be one of: ${COMPRESSION_LEVELS.join(', ')}` })
          return
        }
        if (typeof body.introducer !== 'boolean' || typeof body.autoAcceptFolders !== 'boolean') {
          sendJson(res, 400, { error: 'introducer and autoAcceptFolders must be booleans' })
          return
        }
        const validKbps = (v: unknown): v is number =>
          typeof v === 'number' && Number.isInteger(v) && v >= 0
        if (!validKbps(body.maxSendKbps) || !validKbps(body.maxRecvKbps)) {
          sendJson(res, 400, { error: 'maxSendKbps and maxRecvKbps must be integers >= 0 (0 = unlimited)' })
          return
        }
        await manager.setDeviceOptions(deviceId, {
          name: body.name,
          addresses: body.addresses,
          compression: body.compression,
          introducer: body.introducer,
          autoAcceptFolders: body.autoAcceptFolders,
          maxSendKbps: body.maxSendKbps,
          maxRecvKbps: body.maxRecvKbps,
        })
        sendJson(res, 200, { ok: true })
        return
      }
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

    // POST /api/folders/all/pause|resume|rescan — cluster-wide, every folder on every registered node
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
      if (action === 'rescan') {
        await manager.rescanAllFolders()
        sendJson(res, 200, { ok: true })
        return
      }
    }

    // POST /api/nodes/:deviceId/restart|shutdown — that node's own Syncthing
    // process. :deviceId is the node's own device ID, like every other route.
    if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'nodes') {
      const action = parts[3]
      if (action === 'restart' || action === 'shutdown') {
        await manager.restartNode(decodeURIComponent(parts[2]!), action)
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

    // GET /api/folders/:folderId/ignores|failed-items|conflicts — on-demand
    // per-folder fan-out reads (not part of the model): every sharing node's
    // .stignore patterns / failed pull items / conflict-copy paths.
    if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'folders') {
      const folderId = decodeURIComponent(parts[2]!)
      if (parts[3] === 'ignores') {
        sendJson(res, 200, await manager.getFolderIgnores(folderId))
        return
      }
      if (parts[3] === 'failed-items') {
        sendJson(res, 200, await manager.getFolderFailedItems(folderId))
        return
      }
      if (parts[3] === 'conflicts') {
        sendJson(res, 200, await manager.getFolderConflicts(folderId))
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

      // override (sendonly: push local version out) / revert (receiveonly:
      // discard local-only changes). Syncthing itself rejects the call on a
      // folder of the wrong type; we pass that error through rather than
      // duplicating the type check here.
      if (method === 'POST' && parts.length === 6 && parts[5] === 'override') {
        await manager.overrideFolder(deviceId, folderId)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && parts.length === 6 && parts[5] === 'revert') {
        await manager.revertFolder(deviceId, folderId)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && parts.length === 6 && (parts[5] === 'pause' || parts[5] === 'resume')) {
        await manager.setFolderPaused(deviceId, folderId, parts[5] === 'pause')
        sendJson(res, 200, { ok: true })
        return
      }

      // PATCH body { type?, label? } — at least one; both applied in one
      // config round-trip. label may be empty (Syncthing then shows the id).
      if (method === 'PATCH' && parts.length === 5) {
        const body = (await readJsonBody(req)) as { type?: unknown; label?: unknown } | undefined
        if (body?.type !== undefined && !isFolderType(body.type)) {
          sendJson(res, 400, {
            error: `type must be one of: ${SYNCTHING_FOLDER_TYPES.join(', ')}`,
          })
          return
        }
        if (body?.label !== undefined && typeof body.label !== 'string') {
          sendJson(res, 400, { error: 'label must be a string' })
          return
        }
        if (body?.type === undefined && body?.label === undefined) {
          sendJson(res, 400, { error: 'at least one of type, label is required' })
          return
        }
        await manager.updateFolder(deviceId, folderId, {
          type: body.type as SyncthingFolderType | undefined,
          label: body.label as string | undefined,
        })
        sendJson(res, 200, { ok: true })
        return
      }

      // PUT .../versioning — set this folder's file-versioning config on this
      // node. Sub-resource (not folded into the PATCH above) matching the
      // /shares, /pause, /rescan idiom.
      if (method === 'PUT' && parts.length === 6 && parts[5] === 'versioning') {
        const body = (await readJsonBody(req)) as
          | { type?: unknown; params?: unknown; cleanupIntervalS?: unknown }
          | undefined
        if (!isVersioningType(body?.type)) {
          sendJson(res, 400, { error: `type must be one of: ${VERSIONING_TYPES.join(', ')}` })
          return
        }
        if (body.params !== undefined && !isStringMap(body.params)) {
          sendJson(res, 400, { error: 'params must be an object of string values' })
          return
        }
        if (body.cleanupIntervalS !== undefined && typeof body.cleanupIntervalS !== 'number') {
          sendJson(res, 400, { error: 'cleanupIntervalS must be a number' })
          return
        }
        await manager.setFolderVersioning(deviceId, folderId, {
          type: body.type,
          params: body.params ?? {},
          cleanupIntervalS: body.cleanupIntervalS,
        })
        sendJson(res, 200, { ok: true })
        return
      }

      // PUT .../options — set this folder's advanced options (rescan
      // interval, watcher, min disk free) on this node. Whole-object PUT like
      // /versioning: the client sends all four fields, current values
      // included, so there's no field-level merge to get subtly wrong.
      if (method === 'PUT' && parts.length === 6 && parts[5] === 'options') {
        const body = (await readJsonBody(req)) as
          | {
              rescanIntervalS?: unknown
              fsWatcherEnabled?: unknown
              fsWatcherDelayS?: unknown
              minDiskFree?: unknown
            }
          | undefined
        if (typeof body?.rescanIntervalS !== 'number' || !Number.isFinite(body.rescanIntervalS) || body.rescanIntervalS < 0) {
          sendJson(res, 400, { error: 'rescanIntervalS must be a number >= 0 (0 disables periodic rescans)' })
          return
        }
        if (typeof body.fsWatcherEnabled !== 'boolean') {
          sendJson(res, 400, { error: 'fsWatcherEnabled must be a boolean' })
          return
        }
        if (typeof body.fsWatcherDelayS !== 'number' || !Number.isFinite(body.fsWatcherDelayS) || body.fsWatcherDelayS <= 0) {
          sendJson(res, 400, { error: 'fsWatcherDelayS must be a number > 0' })
          return
        }
        const mdf = body.minDiskFree as { value?: unknown; unit?: unknown } | undefined
        if (
          typeof mdf?.value !== 'number' ||
          !Number.isFinite(mdf.value) ||
          mdf.value < 0 ||
          !isMinDiskFreeUnit(mdf.unit)
        ) {
          sendJson(res, 400, {
            error: `minDiskFree must be { value: number >= 0, unit: one of ${MIN_DISK_FREE_UNITS.join(', ')} }`,
          })
          return
        }
        await manager.setFolderAdvanced(deviceId, folderId, {
          rescanIntervalS: body.rescanIntervalS,
          fsWatcherEnabled: body.fsWatcherEnabled,
          fsWatcherDelayS: body.fsWatcherDelayS,
          minDiskFree: { value: mdf.value, unit: mdf.unit },
        })
        sendJson(res, 200, { ok: true })
        return
      }

      // PUT .../ignores body { patterns: [...] } — replace this folder's
      // .stignore patterns on this node.
      if (method === 'PUT' && parts.length === 6 && parts[5] === 'ignores') {
        const body = (await readJsonBody(req)) as { patterns?: unknown } | undefined
        if (!Array.isArray(body?.patterns) || !body.patterns.every((p) => typeof p === 'string')) {
          sendJson(res, 400, { error: 'patterns must be an array of strings' })
          return
        }
        await manager.setFolderIgnores(deviceId, folderId, body.patterns)
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

    // POST /api/pending/devices/:deviceId/accept — configure it as a peer on the named nodes
    if (
      method === 'POST' &&
      parts.length === 5 &&
      parts[0] === 'api' &&
      parts[1] === 'pending' &&
      parts[2] === 'devices' &&
      parts[4] === 'accept'
    ) {
      const deviceId = decodeURIComponent(parts[3]!)
      const body = (await readJsonBody(req)) as { name?: unknown; nodes?: unknown } | undefined
      if (!Array.isArray(body?.nodes) || !body.nodes.every((n) => typeof n === 'string')) {
        sendJson(res, 400, { error: 'nodes must be an array of registered node device IDs' })
        return
      }
      await manager.addDevice(
        deviceId,
        typeof body.name === 'string' && body.name !== '' ? body.name : undefined,
        body.nodes,
      )
      sendJson(res, 200, { ok: true })
      return
    }

    // DELETE /api/pending/devices/:deviceId — dismiss on every node currently reporting it
    if (
      method === 'DELETE' &&
      parts.length === 4 &&
      parts[0] === 'api' &&
      parts[1] === 'pending' &&
      parts[2] === 'devices'
    ) {
      await manager.dismissPendingDevice(decodeURIComponent(parts[3]!))
      sendJson(res, 200, { ok: true })
      return
    }

    // /api/pending/folders/:folderId/devices/:nodeId[/accept] — :nodeId is
    // the registered node the offer was made to (parts[4] is the literal
    // "devices" segment, matching the /api/folders/:id/devices/:id shape).
    if (
      parts.length >= 6 &&
      parts[0] === 'api' &&
      parts[1] === 'pending' &&
      parts[2] === 'folders' &&
      parts[4] === 'devices'
    ) {
      const folderId = decodeURIComponent(parts[3]!)
      const nodeId = decodeURIComponent(parts[5]!)

      if (method === 'POST' && parts.length === 7 && parts[6] === 'accept') {
        const body = (await readJsonBody(req)) as
          | { offeredBy?: unknown; label?: unknown; path?: unknown; type?: unknown }
          | undefined
        if (typeof body?.offeredBy !== 'string' || body.offeredBy === '') {
          sendJson(res, 400, { error: 'offeredBy is required' })
          return
        }
        if (typeof body.path !== 'string' || body.path === '') {
          sendJson(res, 400, { error: 'path is required' })
          return
        }
        const type = body.type ?? 'sendreceive'
        if (!isFolderType(type)) {
          sendJson(res, 400, { error: `type must be one of: ${SYNCTHING_FOLDER_TYPES.join(', ')}` })
          return
        }
        await manager.acceptPendingFolder(nodeId, folderId, body.offeredBy, {
          label: typeof body.label === 'string' && body.label !== '' ? body.label : folderId,
          path: body.path,
          type,
        })
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'DELETE' && parts.length === 6) {
        const offeredBy = url.searchParams.get('offeredBy') ?? undefined
        await manager.dismissPendingFolder(nodeId, folderId, offeredBy)
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

  // Anything that isn't /api/* falls to the SPA build, when one is present
  // (unknown paths serve index.html — the app owns its own routing).
  if (!isApi && method === 'GET' && staticHandler !== undefined && staticHandler(url.pathname, res)) {
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
