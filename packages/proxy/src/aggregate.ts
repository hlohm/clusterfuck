import type {
  ClusterModel,
  Device,
  DeviceId,
  DeviceState,
  Folder,
  FolderId,
  FolderState,
  FolderType,
  Share,
} from '@clusterfuck/shared'

/**
 * One registered node's own view of the cluster, gathered directly from its
 * REST API. `myID` is that node's own device ID — the only device whose
 * folder type/state we can know first-hand from this snapshot.
 */
export interface NodeSnapshot {
  nodeId: string
  myID: DeviceId
  /** Devices this node's config knows about (including itself, usually). */
  devices: { deviceId: DeviceId; name: string; paused: boolean }[]
  /** This node's own folders, with the type/state as seen from here. */
  folders: {
    id: FolderId
    label: string
    type: FolderType
    state: FolderState
    completionPct?: number
    outOfSyncItems?: number
    errorMessage?: string
  }[]
  /** Per-remote-device connection state, as seen from this node. */
  connections: Record<DeviceId, { connected: boolean; paused: boolean }>
}

interface DeviceAcc {
  name: string
  connectedViews: boolean[]
  pausedViews: boolean[]
}

/**
 * Merges each registered node's own snapshot into one normalized
 * ClusterModel. Reconciliation policy (documented per CLAUDE.md's "multi-node
 * truth" note — views disagree and must be merged, not just picked):
 *
 * - Device state: paused wins if *any* view reports it paused (explicit
 *   intent); else connected wins if *any* view currently sees a live
 *   connection (optimistic union — a link being up from one side is enough
 *   to call the device reachable); else disconnected.
 * - Folder type/state/completion: only known first-hand from a device's own
 *   node. A device only visible as a remote peer in another node's config
 *   (not itself a registered/reachable node) still appears in the graph as a
 *   Device for topology completeness, but gets no Share rows — we have no
 *   first-hand data on its own copy of any folder.
 */
export function aggregateCluster(
  snapshots: NodeSnapshot[],
  clusterId: string,
  label: string,
): ClusterModel {
  const devices = new Map<DeviceId, DeviceAcc>()
  const folders = new Map<FolderId, string>()
  const shares: Share[] = []

  const upsertDevice = (id: DeviceId, name: string) => {
    const existing = devices.get(id)
    if (existing) {
      if (name) existing.name = name
    } else {
      devices.set(id, { name: name || id, connectedViews: [], pausedViews: [] })
    }
  }

  for (const snap of snapshots) {
    upsertDevice(snap.myID, snap.nodeId)

    for (const d of snap.devices) {
      upsertDevice(d.deviceId, d.name)
      devices.get(d.deviceId)!.pausedViews.push(d.paused)
    }

    for (const [deviceId, conn] of Object.entries(snap.connections)) {
      upsertDevice(deviceId, '')
      const acc = devices.get(deviceId)!
      acc.connectedViews.push(conn.connected)
      acc.pausedViews.push(conn.paused)
    }

    for (const f of snap.folders) {
      const existingLabel = folders.get(f.id)
      if (!existingLabel) folders.set(f.id, f.label || f.id)

      shares.push({
        folderId: f.id,
        deviceId: snap.myID,
        type: f.type,
        state: f.state,
        completionPct: f.completionPct,
        outOfSyncItems: f.outOfSyncItems,
        errorMessage: f.errorMessage,
      })
    }
  }

  const deviceList: Device[] = [...devices].map(([id, acc]) => ({
    id,
    name: acc.name || id,
    state: reconcileDeviceState(acc),
  }))

  const folderList: Folder[] = [...folders].map(([id, folderLabel]) => ({
    id,
    label: folderLabel,
  }))

  return { id: clusterId, label, devices: deviceList, folders: folderList, shares }
}

function reconcileDeviceState(acc: DeviceAcc): DeviceState {
  if (acc.pausedViews.some(Boolean)) return 'paused'
  if (acc.connectedViews.some(Boolean)) return 'connected'
  return 'disconnected'
}
