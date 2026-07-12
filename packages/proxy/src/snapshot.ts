import {
  isVersioningType,
  type FolderAdvancedOptions,
  type FolderState,
  type FolderVersioning,
  type ServiceHealth,
} from '@clusterfuck/shared'
import type { NodeSnapshot } from './aggregate.ts'
import type { SyncthingClient } from './syncthing/client.ts'
import type { ConfigFolder, ConfigFolderVersioning } from './syncthing/types.ts'

/** connectionServiceStatus/discoveryStatus are both `{ [name]: { error: string | null } }` — roll each up to a count plus the actual failures, matching folder health's "roll up, keep detail on selection" convention. */
function summarizeServiceStatus(status: Record<string, { error: string | null }> | undefined): ServiceHealth {
  const entries = Object.values(status ?? {})
  const errors = entries.flatMap((e) => (e.error ? [e.error] : []))
  return { total: entries.length, ok: entries.length - errors.length, errors }
}

/**
 * Normalizes Syncthing's raw versioning block into the model shape. Always
 * returns a value (Syncthing's empty-string type — versioning off — becomes
 * `none`), so a live share always carries its current versioning config for
 * the detail panel and editor to read.
 */
function mapVersioning(v: ConfigFolderVersioning | undefined): FolderVersioning {
  const type = isVersioningType(v?.type) ? v.type : 'none'
  return { type, params: v?.params ?? {}, cleanupIntervalS: v?.cleanupIntervalS }
}

/**
 * A folder's advanced options as the model shape. /rest/config normally
 * returns every field, so the fallbacks (Syncthing's own defaults) only kick
 * in for a node that omits one — better a documented default than a hole.
 */
function mapAdvanced(f: ConfigFolder): FolderAdvancedOptions {
  return {
    rescanIntervalS: f.rescanIntervalS ?? 3600,
    fsWatcherEnabled: f.fsWatcherEnabled ?? true,
    fsWatcherDelayS: f.fsWatcherDelayS ?? 10,
    minDiskFree: f.minDiskFree ?? { value: 1, unit: '%' },
  }
}

function mapFolderState(dbState: string, hasErrors: boolean, needFiles: number): FolderState {
  if (hasErrors) return 'error'
  switch (dbState) {
    // 'stopped' is Syncthing halting the folder over a folder-level problem
    // (missing marker/path), not a pause — both are error states here.
    case 'error':
    case 'stopped':
      return 'error'
    case 'scanning':
    case 'scan-waiting':
      return 'scanning'
    case 'syncing':
    case 'sync-preparing':
    case 'sync-waiting':
      return 'syncing'
    default:
      return needFiles > 0 ? 'out-of-sync' : 'idle'
  }
}

/** Fetches one node's full state and shapes it into a NodeSnapshot. */
export async function fetchNodeSnapshot(
  client: SyncthingClient,
  nodeId: string,
): Promise<NodeSnapshot> {
  const [status, version, config, connectionsRes, pendingDevicesRes, pendingFoldersRes] = await Promise.all([
    client.systemStatus(),
    // System status is supplementary detail, not core topology — degrade to
    // an empty version string rather than failing the whole snapshot. Unlike
    // pendingDevices/pendingFolders below, there's no known version cutoff
    // this endpoint predates, so a failure here more likely means a real
    // problem specific to this one call (still log it, even though the
    // snapshot as a whole shouldn't fail over it).
    client.systemVersion().catch((err: unknown) => {
      console.error(`[clusterfuck-proxy] systemVersion failed for ${nodeId}:`, (err as Error).message)
      return { version: '' }
    }),
    client.config(),
    client.connections(),
    // Added in Syncthing 1.13.0 — degrade to "none pending" rather than
    // failing the whole snapshot on an older or momentarily flaky node.
    client.pendingDevices().catch(() => ({})),
    client.pendingFolders().catch(() => ({})),
  ])

  const myID = status.myID
  const ownFolders = config.folders.filter((f) => f.devices.some((d) => d.deviceID === myID))

  const folders = await Promise.all(
    ownFolders.map(async (f) => {
      const [dbStatus, errors] = await Promise.all([
        client.dbStatus(f.id).catch(() => undefined),
        client.folderErrors(f.id).catch(() => undefined),
      ])
      // Two distinct error channels: /rest/db/status' `error` is folder-level
      // (missing marker/path — the folder is stopped), /rest/folder/errors are
      // per-file pull failures. Either one makes the share an error; the
      // folder-level message wins since it explains why nothing syncs at all.
      const folderError = dbStatus?.error || undefined
      const pullError = errors?.errors?.[0]?.error
      const errorMessage = folderError ?? pullError
      const needFiles = dbStatus?.needFiles ?? 0
      const globalFiles = dbStatus?.globalFiles ?? 0
      // Newer Syncthings report the failed-pull count as pullErrors, older
      // ones as errors; the /rest/folder/errors list length is the fallback
      // when db/status itself couldn't be read.
      const failedItems = dbStatus?.pullErrors ?? dbStatus?.errors ?? errors?.errors?.length ?? 0

      return {
        id: f.id,
        label: f.label,
        type: f.type,
        state: f.paused
          ? ('paused' as const)
          : mapFolderState(dbStatus?.state ?? 'idle', errorMessage !== undefined, needFiles),
        completionPct:
          globalFiles > 0 ? Math.round(((globalFiles - needFiles) / globalFiles) * 100) : 100,
        outOfSyncItems: needFiles > 0 ? needFiles : undefined,
        failedItems: failedItems > 0 ? failedItems : undefined,
        errorMessage,
        versioning: mapVersioning(f.versioning),
        advanced: mapAdvanced(f),
        sharedWith: f.devices.map((d) => d.deviceID),
      }
    }),
  )

  const connections: NodeSnapshot['connections'] = {}
  for (const [deviceId, info] of Object.entries(connectionsRes.connections)) {
    // Syncthing 1.x lists the local device itself as a permanently
    // not-connected entry; 2.x dropped it. Normalize to the 2.x shape: the
    // self entry is not a connection, and counting it would push a false
    // "not connected" vote onto this node's own aggregated state and emit a
    // self-loop connection edge.
    if (deviceId === myID) continue
    connections[deviceId] = {
      connected: info.connected,
      paused: info.paused,
      inBytesTotal: info.inBytesTotal,
      outBytesTotal: info.outBytesTotal,
    }
  }

  const pendingDevices: NodeSnapshot['pendingDevices'] = Object.entries(pendingDevicesRes).map(
    ([deviceId, info]) => ({ deviceId, name: info.name, time: info.time, address: info.address }),
  )

  const pendingFolders: NodeSnapshot['pendingFolders'] = Object.entries(pendingFoldersRes).flatMap(
    ([folderId, folder]) =>
      Object.entries(folder.offeredBy).map(([offeredBy, offer]) => ({
        folderId,
        offeredBy,
        time: offer.time,
        label: offer.label,
        receiveEncrypted: offer.receiveEncrypted,
      })),
  )

  return {
    nodeId,
    myID,
    devices: config.devices.map((d) => ({ deviceId: d.deviceID, name: d.name, paused: d.paused })),
    folders,
    connections,
    pendingDevices,
    pendingFolders,
    systemStatus: {
      version: version.version,
      uptimeSeconds: status.uptime,
      ramBytes: status.alloc,
      listeners: summarizeServiceStatus(status.connectionServiceStatus),
      discovery: summarizeServiceStatus(status.discoveryStatus),
    },
  }
}
