import type {
  ClusterModel,
  Connection,
  Device,
  DeviceId,
  DeviceState,
  DeviceSystemStatus,
  Folder,
  FolderAdvancedOptions,
  FolderId,
  FolderState,
  FolderType,
  FolderVersioning,
  PendingDevice,
  PendingFolder,
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
    failedItems?: number
    errorMessage?: string
    /** This node's own file-versioning config for the folder (normalized; see snapshot.ts). */
    versioning?: FolderVersioning
    /** This node's own advanced options for the folder (rescan/watcher/min disk free). */
    advanced?: FolderAdvancedOptions
    /** Every device this node's own config shares this folder with (incl. itself). */
    sharedWith: DeviceId[]
  }[]
  /** Per-remote-device connection state, as seen from this node. */
  connections: Record<DeviceId, { connected: boolean; paused: boolean; inBytesTotal: number; outBytesTotal: number }>
  /** Remote devices that have tried to connect to this node but aren't configured. */
  pendingDevices: { deviceId: DeviceId; name?: string; time: string; address?: string }[]
  /** Folders an already-known peer has offered to this node, not yet joined. */
  pendingFolders: {
    folderId: FolderId
    offeredBy: DeviceId
    time: string
    label: string
    receiveEncrypted: boolean
  }[]
  /** This node's own version/uptime/RAM/listener/discovery status — first-hand, so it only ever applies to myID. */
  systemStatus: DeviceSystemStatus
}

interface DeviceAcc {
  name: string
  managed: boolean
  connectedViews: boolean[]
  pausedViews: boolean[]
  systemStatus?: DeviceSystemStatus
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
 * - Connections/transfer totals: like Share, first-hand only — one row per
 *   (reporting node, peer), never merged/summed across snapshots even when
 *   the peer is itself a registered node reporting its own reverse-direction
 *   row for the same link (see the shared Connection type's doc comment).
 */
export function aggregateCluster(
  snapshots: NodeSnapshot[],
  clusterId: string,
  label: string,
): ClusterModel {
  const devices = new Map<DeviceId, DeviceAcc>()
  const folders = new Map<FolderId, string>()
  const shares: Share[] = []
  const connections: Connection[] = []
  const pendingDevices = new Map<DeviceId, PendingDevice>()
  const pendingFolders = new Map<FolderId, PendingFolder>()

  const upsertDevice = (id: DeviceId, name: string) => {
    const existing = devices.get(id)
    if (existing) {
      if (name) existing.name = name
    } else {
      devices.set(id, { name: name || id, managed: false, connectedViews: [], pausedViews: [] })
    }
  }

  for (const snap of snapshots) {
    upsertDevice(snap.myID, snap.nodeId)
    devices.get(snap.myID)!.managed = true
    devices.get(snap.myID)!.systemStatus = snap.systemStatus

    for (const d of snap.devices) {
      upsertDevice(d.deviceId, d.name)
      devices.get(d.deviceId)!.pausedViews.push(d.paused)
    }

    for (const [deviceId, conn] of Object.entries(snap.connections)) {
      upsertDevice(deviceId, '')
      const acc = devices.get(deviceId)!
      acc.connectedViews.push(conn.connected)
      acc.pausedViews.push(conn.paused)
      connections.push({
        deviceId: snap.myID,
        peerId: deviceId,
        connected: conn.connected,
        inBytesTotal: conn.inBytesTotal,
        outBytesTotal: conn.outBytesTotal,
      })
    }

    for (const f of snap.folders) {
      const existingLabel = folders.get(f.id)
      if (!existingLabel) folders.set(f.id, f.label || f.id)

      shares.push({
        folderId: f.id,
        deviceId: snap.myID,
        label: f.label,
        type: f.type,
        state: f.state,
        completionPct: f.completionPct,
        outOfSyncItems: f.outOfSyncItems,
        failedItems: f.failedItems,
        errorMessage: f.errorMessage,
        versioning: f.versioning,
        advanced: f.advanced,
        sharedWith: f.sharedWith,
      })
    }

    for (const pd of snap.pendingDevices) {
      const seen = { nodeId: snap.nodeId, time: pd.time, address: pd.address }
      const existing = pendingDevices.get(pd.deviceId)
      if (existing) {
        existing.seenOn.push(seen)
        if (pd.name && !existing.name) existing.name = pd.name
      } else {
        pendingDevices.set(pd.deviceId, { deviceId: pd.deviceId, name: pd.name, seenOn: [seen] })
      }
    }

    for (const pf of snap.pendingFolders) {
      const offer = {
        nodeId: snap.nodeId,
        offeredBy: pf.offeredBy,
        time: pf.time,
        label: pf.label,
        receiveEncrypted: pf.receiveEncrypted,
      }
      const existing = pendingFolders.get(pf.folderId)
      if (existing) {
        existing.offers.push(offer)
      } else {
        pendingFolders.set(pf.folderId, { folderId: pf.folderId, label: pf.label, offers: [offer] })
      }
    }
  }

  const deviceList: Device[] = [...devices].map(([id, acc]) => ({
    id,
    name: acc.name || id,
    state: reconcileDeviceState(acc),
    managed: acc.managed,
    systemStatus: acc.systemStatus,
  }))

  const folderList: Folder[] = [...folders].map(([id, folderLabel]) => ({
    id,
    label: folderLabel,
  }))

  return {
    id: clusterId,
    label,
    devices: deviceList,
    folders: folderList,
    shares,
    connections,
    pendingDevices: [...pendingDevices.values()],
    pendingFolders: [...pendingFolders.values()],
  }
}

function reconcileDeviceState(acc: DeviceAcc): DeviceState {
  if (acc.pausedViews.some(Boolean)) return 'paused'
  if (acc.connectedViews.some(Boolean)) return 'connected'
  return 'disconnected'
}
