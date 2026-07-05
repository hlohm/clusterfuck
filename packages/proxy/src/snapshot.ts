import type { FolderState } from '@clusterfuck/shared'
import type { NodeSnapshot } from './aggregate.ts'
import type { SyncthingClient } from './syncthing/client.ts'

function mapFolderState(dbState: string, hasErrors: boolean, needFiles: number): FolderState {
  if (hasErrors) return 'error'
  switch (dbState) {
    case 'scanning':
      return 'scanning'
    case 'syncing':
    case 'sync-preparing':
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
  const [status, config, connectionsRes, pendingDevicesRes, pendingFoldersRes] = await Promise.all([
    client.systemStatus(),
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
      const hasErrors = Boolean(errors?.errors?.length)
      const needFiles = dbStatus?.needFiles ?? 0
      const globalFiles = dbStatus?.globalFiles ?? 0

      return {
        id: f.id,
        label: f.label,
        type: f.type,
        state: f.paused ? ('paused' as const) : mapFolderState(dbStatus?.state ?? 'idle', hasErrors, needFiles),
        completionPct:
          globalFiles > 0 ? Math.round(((globalFiles - needFiles) / globalFiles) * 100) : 100,
        outOfSyncItems: needFiles > 0 ? needFiles : undefined,
        errorMessage: hasErrors ? errors!.errors![0]!.error : undefined,
        sharedWith: f.devices.map((d) => d.deviceID),
      }
    }),
  )

  const connections: NodeSnapshot['connections'] = {}
  for (const [deviceId, info] of Object.entries(connectionsRes.connections)) {
    connections[deviceId] = { connected: info.connected, paused: info.paused }
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
  }
}
