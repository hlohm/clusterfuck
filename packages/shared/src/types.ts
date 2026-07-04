export type DeviceId = string
export type FolderId = string

export type DeviceState = 'this-device' | 'connected' | 'disconnected' | 'paused'

export interface Device {
  id: DeviceId
  name: string
  state: DeviceState
}

export type FolderType = 'sendreceive' | 'sendonly' | 'receiveonly' | 'receiveencrypted'

export type FolderState = 'idle' | 'scanning' | 'syncing' | 'paused' | 'error' | 'out-of-sync'

export interface Folder {
  id: FolderId
  label: string
}

/**
 * One device's participation in one folder. Type/state belong to this
 * participation, not to a device pair: e.g. a trusted sender can see a folder
 * as sendreceive while an untrusted peer's own copy of the same folder is
 * receiveencrypted. Asymmetry across devices is expected, not a bug.
 */
export interface Share {
  folderId: FolderId
  deviceId: DeviceId
  type: FolderType
  state: FolderState
  completionPct?: number
  outOfSyncItems?: number
  errorMessage?: string
}

export interface ClusterModel {
  id: string
  label: string
  devices: Device[]
  folders: Folder[]
  shares: Share[]
}
