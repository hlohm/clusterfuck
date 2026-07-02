import type { ClusterModel, DeviceId, FolderId, FolderState, Share } from './types'

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
  const [first, ...rest] = sharesByDevice(cluster, deviceId)
  if (!first) return undefined

  return rest.reduce<Share>(
    (worst, current) =>
      FOLDER_STATE_SEVERITY[current.state] > FOLDER_STATE_SEVERITY[worst.state] ? current : worst,
    first,
  ).state
}
