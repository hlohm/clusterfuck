// Subset of the Syncthing 1.x REST API response shapes actually consumed by
// the proxy. Not exhaustive — extend as new fields are needed. See
// https://docs.syncthing.net/dev/rest.html. Syncthing 2.x renames/reshapes
// some of these; this proxy targets 1.x until we know which version is
// actually deployed.

export interface SystemStatusResponse {
  myID: string
  uptime: number
  /** Bytes currently allocated by the Go runtime — the "RAM used" figure Syncthing's own GUI shows. */
  alloc: number
  /**
   * Keyed by listen address (e.g. "tcp://0.0.0.0:22000"); null error means
   * that listener is up.
   */
  connectionServiceStatus: Record<string, { error: string | null }>
  /**
   * Keyed by discovery method name; null error means that method is
   * working. Added in Syncthing 1.18.0 — a node older than that has no such
   * field, so this can't be assumed present (see systemVersion()).
   */
  discoveryStatus?: Record<string, { error: string | null }>
}

export interface SystemVersionResponse {
  version: string
}

export interface ConfigDevice {
  deviceID: string
  name: string
  paused: boolean
}

export interface ConfigFolderDevice {
  deviceID: string
  /**
   * Set on the trusted sender's own share entry for an untrusted peer — the
   * peer's own copy of the folder is then `receiveencrypted` and never sees
   * the plaintext. Write-only from our side: never read back into the
   * normalized model, which only ever sees `sharedWith` device ids.
   */
  encryptionPassword?: string
}

export const SYNCTHING_FOLDER_TYPES = [
  'sendreceive',
  'sendonly',
  'receiveonly',
  'receiveencrypted',
] as const

export type SyncthingFolderType = (typeof SYNCTHING_FOLDER_TYPES)[number]

export interface ConfigFolder {
  id: string
  label: string
  type: SyncthingFolderType
  paused: boolean
  devices: ConfigFolderDevice[]
  /** Filesystem path on the owning node. Only set when creating a folder. */
  path?: string
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

/** GET /rest/cluster/pending/devices — keyed by the connecting device's own ID. */
export interface PendingDevicesResponse {
  [deviceID: string]: { time: string; name?: string; address?: string }
}

/** GET /rest/cluster/pending/folders — keyed by folder ID, then by offering device. */
export interface PendingFoldersResponse {
  [folderID: string]: {
    offeredBy: {
      [deviceID: string]: {
        time: string
        label: string
        receiveEncrypted: boolean
        remoteEncrypted: boolean
      }
    }
  }
}
