export type DeviceId = string
export type FolderId = string

export type DeviceState = 'this-device' | 'connected' | 'disconnected' | 'paused'

/** A rolled-up service/method health count (listen addresses, discovery methods, ...), with the failing ones named for detail-on-selection. */
export interface ServiceHealth {
  total: number
  ok: number
  errors: string[]
}

/**
 * A registered node's own first-hand system info — only it can report this
 * about itself, so it's only ever present on a `managed: true` device (never
 * derivable for a peer known only via another node's config).
 */
export interface DeviceSystemStatus {
  version: string
  uptimeSeconds: number
  ramBytes: number
  /** Listen-address services (TCP, relay, ...). */
  listeners: ServiceHealth
  /** Discovery methods (local, global, ...). */
  discovery: ServiceHealth
}

export interface Device {
  id: DeviceId
  name: string
  state: DeviceState
  /**
   * True when this device is one of our registered proxy nodes — the only
   * devices whose folder config we can read first-hand or edit. A device
   * seen only as a remote peer in other nodes' configs is unmanaged.
   */
  managed: boolean
  systemStatus?: DeviceSystemStatus
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
  /** Every device `deviceId`'s own config shares this folder with (incl. itself). */
  sharedWith: DeviceId[]
}

/**
 * One registered node's own first-hand view of its connection to a peer —
 * like Share, only ever reported by the node whose own connection this is.
 * If the peer is *also* a registered node, it reports its own separate row
 * for the same link (its own in/out are the reverse direction, and its own
 * sample may land at a slightly different moment) — not merged into one row,
 * same "each side's own view, views can disagree" principle as the rest of
 * this model.
 *
 * inBytesTotal/outBytesTotal are cumulative for the *current* connection,
 * not a live rate — but also not a durable all-time total: Syncthing itself
 * only tracks these while a connection is live, so they reset to 0 the
 * moment a peer disconnects (a reconnect, or a Syncthing/proxy restart,
 * starts back at 0, not from where it left off).
 */
export interface Connection {
  /** The registered node reporting this connection. */
  deviceId: DeviceId
  /** The peer it's connected (or has been connected) to. */
  peerId: DeviceId
  connected: boolean
  inBytesTotal: number
  outBytesTotal: number
}

/**
 * A remote device that has tried to connect to one or more registered nodes
 * but isn't configured anywhere yet. Merged across nodes by device ID — the
 * cluster-wide "inbox" so the same device showing up on N nodes reads as one
 * entry, not N.
 */
export interface PendingDevice {
  deviceId: DeviceId
  /** Name the device itself suggested, if any (not necessarily unique or trustworthy). */
  name?: string
  /** Every registered node that has seen this device try to connect. */
  seenOn: { nodeId: DeviceId; time: string; address?: string }[]
}

/**
 * A folder some already-known peer has offered to a registered node, but
 * that node hasn't joined. Merged across nodes by folder ID — the same
 * folder can be offered by different peers on different nodes.
 */
export interface PendingFolder {
  folderId: FolderId
  /** A representative label — offers on different nodes may suggest different ones. */
  label: string
  offers: {
    nodeId: DeviceId
    offeredBy: DeviceId
    time: string
    label: string
    receiveEncrypted: boolean
  }[]
}

export interface ClusterModel {
  id: string
  label: string
  devices: Device[]
  folders: Folder[]
  shares: Share[]
  connections: Connection[]
  pendingDevices: PendingDevice[]
  pendingFolders: PendingFolder[]
}
