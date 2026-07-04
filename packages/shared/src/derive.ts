import type {
  ClusterModel,
  DeviceId,
  DeviceState,
  FolderId,
  FolderState,
  Share,
} from './types.ts'

export function sharesByFolder(cluster: ClusterModel, folderId: FolderId): Share[] {
  return cluster.shares.filter((s) => s.folderId === folderId)
}

export function sharesByDevice(cluster: ClusterModel, deviceId: DeviceId): Share[] {
  return cluster.shares.filter((s) => s.deviceId === deviceId)
}

/**
 * Worst-state-wins severity, low to high. Used to roll many per-folder states
 * up onto a single node badge; full per-folder detail stays in the panel.
 */
const FOLDER_STATE_SEVERITY: Record<FolderState, number> = {
  idle: 0,
  scanning: 1,
  syncing: 1,
  paused: 2,
  'out-of-sync': 3,
  error: 4,
}

export function folderHealthForDevice(
  cluster: ClusterModel,
  deviceId: DeviceId,
): FolderState | undefined {
  return worstState(sharesByDevice(cluster, deviceId))
}

/** Worst-state rollup across every device's view of one folder. */
export function folderHealth(cluster: ClusterModel, folderId: FolderId): FolderState | undefined {
  return worstState(sharesByFolder(cluster, folderId))
}

function worstState(shares: Share[]): FolderState | undefined {
  const [first, ...rest] = shares
  if (!first) return undefined

  return rest.reduce<Share>(
    (worst, current) =>
      FOLDER_STATE_SEVERITY[current.state] > FOLDER_STATE_SEVERITY[worst.state] ? current : worst,
    first,
  ).state
}

export interface ClusterHealth {
  /** Devices bucketed by state. Every DeviceState key is present (0 when none). */
  deviceCounts: Record<DeviceState, number>
  /** Folders bucketed by their worst share state across all devices. */
  folderCounts: Record<FolderState, number>
  /** Sum of out-of-sync items across all shares. */
  outOfSyncItems: number
  /** Shares that need a look: error, out-of-sync, or paused — worst first. */
  attention: Share[]
}

const ATTENTION_STATES: FolderState[] = ['error', 'out-of-sync', 'paused']

/** One-pass rollup powering the overview dashboard. */
export function clusterHealth(cluster: ClusterModel): ClusterHealth {
  const deviceCounts: Record<DeviceState, number> = {
    'this-device': 0,
    connected: 0,
    disconnected: 0,
    paused: 0,
  }
  for (const device of cluster.devices) deviceCounts[device.state] += 1

  const folderCounts: Record<FolderState, number> = {
    idle: 0,
    scanning: 0,
    syncing: 0,
    paused: 0,
    'out-of-sync': 0,
    error: 0,
  }
  for (const folder of cluster.folders) {
    const health = folderHealth(cluster, folder.id)
    if (health) folderCounts[health] += 1
  }

  const outOfSyncItems = cluster.shares.reduce((sum, s) => sum + (s.outOfSyncItems ?? 0), 0)

  const attention = cluster.shares
    .filter((s) => ATTENTION_STATES.includes(s.state))
    .sort((a, b) => FOLDER_STATE_SEVERITY[b.state] - FOLDER_STATE_SEVERITY[a.state])

  return { deviceCounts, folderCounts, outOfSyncItems, attention }
}
