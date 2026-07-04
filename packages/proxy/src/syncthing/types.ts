// Subset of the Syncthing 1.x REST API response shapes actually consumed by
// the proxy. Not exhaustive — extend as new fields are needed. See
// https://docs.syncthing.net/dev/rest.html. Syncthing 2.x renames/reshapes
// some of these; this proxy targets 1.x until we know which version is
// actually deployed.

export interface SystemStatusResponse {
  myID: string
}

export interface ConfigDevice {
  deviceID: string
  name: string
  paused: boolean
}

export interface ConfigFolderDevice {
  deviceID: string
}

export type SyncthingFolderType = 'sendreceive' | 'sendonly' | 'receiveonly' | 'receiveencrypted'

export interface ConfigFolder {
  id: string
  label: string
  type: SyncthingFolderType
  paused: boolean
  devices: ConfigFolderDevice[]
}

export interface ConfigResponse {
  devices: ConfigDevice[]
  folders: ConfigFolder[]
}

export interface ConnectionInfo {
  connected: boolean
  paused: boolean
}

export interface ConnectionsResponse {
  connections: Record<string, ConnectionInfo>
}

export interface DbStatusResponse {
  state: 'idle' | 'scanning' | 'syncing' | 'sync-preparing' | 'error'
  needFiles: number
  needItems: number
  globalFiles: number
  errors: number
}

export interface FolderError {
  path: string
  error: string
}

export interface FolderErrorsResponse {
  folder: string
  errors: FolderError[] | null
}

export interface SyncthingEvent {
  id: number
  type: string
  time: string
  data: unknown
}
