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

/** GET /rest/system/upgrade — whether a newer release exists for this node. */
export interface UpgradeCheckResponse {
  /** The version this node is currently running. */
  running: string
  latest: string
  newer: boolean
  majorNewer: boolean
}

export interface ConfigDevice {
  deviceID: string
  name: string
  paused: boolean
  /** Dial addresses; `["dynamic"]` means discovery. */
  addresses?: string[]
  compression?: string
  introducer?: boolean
  autoAcceptFolders?: boolean
  /** KiB/s; 0 = unlimited. */
  maxSendKbps?: number
  maxRecvKbps?: number
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

/**
 * A folder's file-versioning config as Syncthing stores it. `type` is an
 * empty string when versioning is off; `params` values are always strings.
 * `fsPath`/`fsType` and any other fields we don't touch are round-tripped
 * verbatim on edit (GET-modify-PUT), so this stays a partial view.
 */
export interface ConfigFolderVersioning {
  type: string
  params: Record<string, string>
  cleanupIntervalS?: number
  fsPath?: string
  fsType?: string
}

export interface ConfigFolder {
  id: string
  label: string
  type: SyncthingFolderType
  paused: boolean
  devices: ConfigFolderDevice[]
  versioning?: ConfigFolderVersioning
  /** Filesystem path on the owning node. Only set when creating a folder. */
  path?: string
  /** Full-rescan interval in seconds; 0 disables periodic rescans. */
  rescanIntervalS?: number
  fsWatcherEnabled?: boolean
  /** Watcher batching delay in seconds. */
  fsWatcherDelayS?: number
  /** Free-space floor for accepting sync writes; value 0 disables the check. */
  minDiskFree?: { value: number; unit: string }
}

export interface ConfigResponse {
  devices: ConfigDevice[]
  folders: ConfigFolder[]
}

/** Subset of GET/PATCH /rest/config/options — the node-global knobs we touch. KiB/s; 0 = unlimited. */
export interface ConfigOptions {
  maxSendKbps?: number
  maxRecvKbps?: number
}

export interface ConnectionInfo {
  connected: boolean
  paused: boolean
  /** Cumulative for the current connection only — resets to 0 on disconnect, not a durable all-time total or a live rate. */
  inBytesTotal: number
  outBytesTotal: number
}

export interface ConnectionsResponse {
  connections: Record<string, ConnectionInfo>
}

/**
 * One entry of GET /rest/db/browse's nested tree. `type` is
 * FILE_INFO_TYPE_FILE / FILE_INFO_TYPE_DIRECTORY (plus symlink variants);
 * directories carry `children`.
 */
export interface DbBrowseItem {
  name: string
  type: string
  children?: DbBrowseItem[]
}

export interface DbStatusResponse {
  /**
   * Folder service state. Known values include 'idle', 'scanning',
   * 'scan-waiting', 'syncing', 'sync-waiting', 'sync-preparing', 'cleaning',
   * 'clean-waiting', 'error', and 'stopped' — kept as string since the set
   * varies across Syncthing versions; unrecognized values fall back to idle
   * in mapFolderState.
   */
  state: string
  /** Folder-level error (e.g. "folder marker missing") — distinct from /rest/folder/errors' per-file pull errors. */
  error?: string
  needFiles: number
  needItems: number
  globalFiles: number
  errors: number
  /** Count of items the last pull failed on — newer Syncthings report it here; older ones only in `errors`. */
  pullErrors?: number
}

/**
 * GET/POST /rest/db/ignores. `ignore` are the raw `.stignore` lines; `expanded`
 * is the fully-resolved list. Both are null when the folder has no `.stignore`.
 */
export interface DbIgnoresResponse {
  ignore: string[] | null
  expanded: string[] | null
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

/**
 * Payload of the /rest/events/disk stream's LocalChangeDetected /
 * RemoteChangeDetected events. `folder` vs `folderID` varies across 1.x
 * versions, so both are modeled.
 */
export interface DiskEventData {
  action: string
  folder?: string
  folderID?: string
  label?: string
  path: string
  type: string
  modifiedBy?: string
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
