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

/**
 * File-versioning strategies Syncthing supports for a folder. `none` is our
 * normalization of Syncthing's own empty-string type (`""` = "No File
 * Versioning") — every other value is passed through to/from Syncthing as-is.
 */
export const VERSIONING_TYPES = ['none', 'trashcan', 'simple', 'staggered', 'external'] as const
export type VersioningType = (typeof VERSIONING_TYPES)[number]

export function isVersioningType(value: unknown): value is VersioningType {
  return (VERSIONING_TYPES as readonly unknown[]).includes(value)
}

/**
 * One share's file-versioning config — a property of the folder *on a given
 * device*, like `type`, so it lives on `Share` rather than `Folder` (each node
 * can version its own copy differently). `params` are Syncthing's own raw
 * key/value knobs, kept verbatim (all values are strings, e.g. `{ keep: "5",
 * cleanoutDays: "0" }` for `simple`, `{ maxAge: "0" }` in *seconds* for
 * `staggered`, `{ command: "..." }` for `external`) — the meaning of each key
 * depends on `type`. `cleanupIntervalS` is the shared housekeeping interval,
 * preserved on round-trip.
 */
export interface FolderVersioning {
  type: VersioningType
  params: Record<string, string>
  cleanupIntervalS?: number
}

/** The units Syncthing accepts for a folder's minimum-free-disk-space threshold. */
export const MIN_DISK_FREE_UNITS = ['%', 'kB', 'MB', 'GB', 'TB'] as const
export type MinDiskFreeUnit = (typeof MIN_DISK_FREE_UNITS)[number]

export function isMinDiskFreeUnit(value: unknown): value is MinDiskFreeUnit {
  return (MIN_DISK_FREE_UNITS as readonly unknown[]).includes(value)
}

/**
 * One share's advanced folder options — like `versioning`, a property of the
 * folder *on a given device* (each node scans and guards its own copy), so it
 * lives on `Share` rather than `Folder`.
 */
export interface FolderAdvancedOptions {
  /**
   * Full-rescan interval in seconds; 0 disables periodic rescans (the
   * watcher, if enabled, still picks changes up as they happen).
   */
  rescanIntervalS: number
  /** Filesystem watcher (inotify & friends) — notices changes without waiting for a rescan. */
  fsWatcherEnabled: boolean
  /** How long the watcher batches changes before acting, in seconds. */
  fsWatcherDelayS: number
  /**
   * Stop syncing into the folder when its disk's free space drops below this;
   * `value: 0` disables the check. `unit` is Syncthing's own string — kept
   * verbatim on read, restricted to MIN_DISK_FREE_UNITS on write.
   */
  minDiskFree: { value: number; unit: string }
}

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
  /**
   * This node's own label for the folder. `Folder.label` is just a
   * representative pick; keeping each node's value here is what makes label
   * drift detectable. Live aggregation always populates it; fixtures may
   * omit it (treated as agreeing with `Folder.label`).
   */
  label?: string
  type: FolderType
  state: FolderState
  completionPct?: number
  outOfSyncItems?: number
  /**
   * Items this node tried to pull for the folder and failed on (permission
   * errors, ignored-then-deleted files, ...). A count only — the per-item
   * paths/errors are an on-demand payload (FolderFailedItems), not model
   * state, same reasoning as ignore patterns.
   */
  failedItems?: number
  errorMessage?: string
  /**
   * This node's file-versioning config for its own copy of the folder. Live
   * aggregation always populates it (defaulting to `{ type: 'none' }` when
   * versioning is off); fixtures may omit it, so treat absent as "none".
   */
  versioning?: FolderVersioning
  /**
   * This node's advanced options for its own copy of the folder. Live
   * aggregation always populates it (falling back to Syncthing's defaults for
   * any field a node omits); fixtures may leave it out.
   */
  advanced?: FolderAdvancedOptions
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
  /**
   * Live transfer rate in bytes/sec, estimated by the proxy from the change
   * in the cumulative totals between refresh cycles (Syncthing's REST API
   * only exposes the counters). Absent until two samples far enough apart
   * exist, and absent while disconnected; 0 after a counter reset.
   */
  inBps?: number
  outBps?: number
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

/** Syncthing's per-device compression settings (what to compress on the wire). */
export const COMPRESSION_LEVELS = ['metadata', 'always', 'never'] as const
export type CompressionLevel = (typeof COMPRESSION_LEVELS)[number]

export function isCompressionLevel(value: unknown): value is CompressionLevel {
  return (COMPRESSION_LEVELS as readonly unknown[]).includes(value)
}

/**
 * The editable options of one device *entry* — i.e. how one registered node
 * has a peer configured, not a property of the peer itself. Every field maps
 * 1:1 to Syncthing's device config. `compression` is kept verbatim on read
 * and restricted to COMPRESSION_LEVELS on write (same stance as
 * FolderAdvancedOptions' minDiskFree unit).
 */
export interface DeviceOptions {
  name: string
  /** Dial addresses; `dynamic` means discovery. */
  addresses: string[]
  compression: string
  /** This peer may introduce its own peers to us. */
  introducer: boolean
  /** Automatically accept folders this peer offers. */
  autoAcceptFolders: boolean
  /** Per-device send rate limit in KiB/s; 0 = unlimited. */
  maxSendKbps: number
  /** Per-device receive rate limit in KiB/s; 0 = unlimited. */
  maxRecvKbps: number
}

/** One registered node's own configuration of the device; `error` set when it couldn't be read. */
export interface NodeDeviceOptions {
  /** The registered node whose config this entry lives in (its own device ID). */
  nodeId: DeviceId
  options?: DeviceOptions
  error?: string
}

/**
 * How every registered node currently configures one device — on-demand, not
 * part of ClusterModel: entries can differ per node and only matter when a
 * device is being edited.
 */
export interface DeviceOptionsView {
  deviceId: DeviceId
  nodes: NodeDeviceOptions[]
}

/**
 * One raw Syncthing event as observed on one registered node — an entry of
 * the cluster-wide event log. `data` is Syncthing's own payload, untouched.
 */
export interface ClusterEvent {
  /** The registered node the event happened on (its own device ID). */
  nodeId: DeviceId
  /** Syncthing's per-node event id — unique per node, not across the cluster. */
  id: number
  type: string
  time: string
  data: unknown
}

/** The merged event log, newest first — on-demand, bounded, in-memory (like the changes feed). */
export interface EventLogView {
  events: ClusterEvent[]
}

/** One completion sample; `t` is epoch milliseconds. */
export interface CompletionPoint {
  t: number
  pct: number
}

/** One share's recent completion history — the data behind an overview sparkline. */
export interface ShareCompletionSeries {
  folderId: FolderId
  deviceId: DeviceId
  points: CompletionPoint[]
}

/**
 * Recent completion history for every share, sampled by the proxy on its
 * refresh cycle (bounded, in-memory — a sparkline's worth, not a metrics
 * store). On-demand, not part of ClusterModel.
 */
export interface CompletionHistoryView {
  series: ShareCompletionSeries[]
}

export type UpgradeNodeStatus =
  | 'pending'
  | 'checking'
  | 'up-to-date'
  | 'upgrading'
  | 'done'
  | 'failed'
  /** Not attempted because an earlier node failed — the run aborts rather than risking the rest. */
  | 'skipped'
  /**
   * Only a new major version (e.g. 1.x → 2.x) is available — a normal sweep
   * never installs it silently; a run started with includeMajor does.
   */
  | 'major-available'

export interface UpgradeNodeProgress {
  /** The registered node's own device ID. */
  nodeId: DeviceId
  status: UpgradeNodeStatus
  /** Human detail for the current status (error text for failed, wait note while upgrading, ...). */
  detail?: string
  fromVersion?: string
  toVersion?: string
}

/**
 * One cluster upgrade sweep — nodes upgraded strictly one at a time, each
 * health-checked back to reachability before the next starts. Kept on the
 * proxy (in memory, one run at a time) and polled by the UI; a failure
 * aborts the run so at most one node is ever in a bad state.
 */
export interface UpgradeRun {
  running: boolean
  /** True when the run stopped early because a node failed. */
  aborted: boolean
  startedAt: string
  finishedAt?: string
  nodes: UpgradeNodeProgress[]
}

/**
 * One observed file/directory change — an entry of the cluster-wide
 * recent-changes feed. Sourced from Syncthing's disk-events stream on each
 * registered node; the proxy keeps a bounded in-memory buffer (nothing is
 * persisted), merged across nodes and served on demand.
 */
export interface RecentChange {
  /** The registered node that observed the change (its own device ID). */
  nodeId: DeviceId
  folderId: FolderId
  /** Folder-relative path of the changed item. */
  path: string
  /** Syncthing's action verbatim: added / modified / deleted. */
  action: string
  /** Syncthing's item type verbatim: file / dir. */
  itemType: string
  /** Whether the change happened on the observing node itself or came in from a peer. */
  origin: 'local' | 'remote'
  /** For remote changes: the device the change came from. */
  modifiedBy?: DeviceId
  time: string
}

/** The merged recent-changes feed, newest first — on-demand, not part of ClusterModel. */
export interface RecentChangesView {
  changes: RecentChange[]
}

/**
 * One registered node's global (whole-process) bandwidth limits, in KiB/s;
 * 0 = unlimited. Distinct from DeviceOptions' per-device limits: these cap
 * the node's total traffic. `error` set when the node couldn't be read.
 */
export interface NodeBandwidthLimits {
  /** The registered node's own device ID. */
  nodeId: DeviceId
  maxSendKbps?: number
  maxRecvKbps?: number
  error?: string
}

/** Every registered node's global bandwidth limits — on-demand, not part of ClusterModel. */
export interface BandwidthLimitsView {
  nodes: NodeBandwidthLimits[]
}

/**
 * One node's `.stignore` patterns for a folder — the raw lines, not the
 * expanded form. `error` is set (and `patterns` empty) when that node's
 * patterns couldn't be read.
 */
export interface NodeIgnorePatterns {
  /** The node's own Syncthing device ID — the same value as a Share's `deviceId`. */
  deviceId: DeviceId
  patterns: string[]
  error?: string
}

/**
 * One node's failed sync items for a folder — the files it tried to pull and
 * couldn't, each with Syncthing's own error string. `error` is set (and
 * `items` empty) when that node's list couldn't be read at all.
 */
export interface NodeFailedItems {
  deviceId: DeviceId
  items: { path: string; error: string }[]
  error?: string
}

/**
 * Every sharing node's failed items for one folder — on-demand, like
 * FolderIgnores: the model carries only the per-share `failedItems` count,
 * and the paths/errors are fetched when a folder is inspected.
 */
export interface FolderFailedItems {
  folderId: FolderId
  nodes: NodeFailedItems[]
}

/**
 * One node's conflict copies for a folder — files Syncthing renamed to
 * `*.sync-conflict-<date>-<time>-<device>*` when both sides changed them.
 * Found by walking the node's own view of the folder tree, so `paths` are
 * folder-relative. `error` is set (and `paths` empty) when the walk failed.
 */
export interface NodeConflicts {
  deviceId: DeviceId
  paths: string[]
  error?: string
}

/** Every sharing node's conflict copies for one folder — on-demand; a tree walk is far too heavy for the aggregated model. */
export interface FolderConflicts {
  folderId: FolderId
  nodes: NodeConflicts[]
}

/**
 * Every sharing node's ignore patterns for one folder — an on-demand payload,
 * deliberately NOT part of `ClusterModel`: `.stignore` lists are per-node, can
 * be large, and change independently of topology, so they're fetched per
 * folder only when asked rather than aggregated into (and pushed on) every SSE
 * snapshot. One entry per registered node that shares the folder, so the UI
 * can both edit each node's patterns and diff them across nodes.
 */
export interface FolderIgnores {
  folderId: FolderId
  nodes: NodeIgnorePatterns[]
}
