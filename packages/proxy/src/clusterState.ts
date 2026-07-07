import type {
  ClusterModel,
  DeviceOptions,
  DeviceOptionsView,
  FolderAdvancedOptions,
  FolderConflicts,
  FolderFailedItems,
  FolderIgnores,
  VersioningType,
} from '@clusterfuck/shared'
import { aggregateCluster, type NodeSnapshot } from './aggregate.ts'
import { collectConflictPaths } from './conflicts.ts'
import { fetchNodeSnapshot } from './snapshot.ts'
import { saveNodeConfig } from './config.ts'
import { SyncthingClient, type NodeConfig } from './syncthing/client.ts'
import type { ConfigFolder, SyncthingFolderType } from './syncthing/types.ts'

interface ClientEntry {
  nodeId: string
  client: SyncthingClient
}

/** Thrown when a mutation targets a device/node no registered node can act on. */
export class NotManagedError extends Error {
  constructor(id: string) {
    super(`${id} is not controllable by any registered node`)
  }
}

/** Thrown when a mutation is invalid as requested — the upstream node would reject it. */
export class InvalidTargetError extends Error {}

const RELEVANT_EVENT_TYPES = new Set([
  'StateChanged',
  'FolderSummary',
  'FolderErrors',
  'DeviceConnected',
  'DeviceDisconnected',
  'DevicePaused',
  'DeviceResumed',
  'FolderPaused',
  'FolderResumed',
  'FolderCompletion',
  'PendingDevicesChanged',
  'PendingFoldersChanged',
])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Owns the live ClusterModel: fetches an initial snapshot from every
 * registered node, then keeps it fresh via each node's /rest/events
 * long-poll (fast path) plus a low-frequency full re-poll (backstop, in case
 * an event is missed or a connection drops silently) — the confirmed Phase 2
 * update strategy. Notifies subscribers (SSE clients) on every change.
 */
export class ClusterStateManager {
  private model: ClusterModel
  private snapshots: NodeSnapshot[] = []
  private readonly subscribers = new Set<(model: ClusterModel) => void>()
  private clients: ClientEntry[]
  private readonly clusterId: string
  private readonly label: string
  private readonly pollIntervalMs: number
  private stopped = false
  private refreshInFlight: Promise<void> | undefined
  private mutationChain: Promise<void> = Promise.resolve()

  constructor(
    nodeConfigs: NodeConfig[],
    opts: { clusterId: string; label: string; pollIntervalMs?: number },
  ) {
    this.clients = nodeConfigs.map((n) => ({ nodeId: n.id, client: new SyncthingClient(n) }))
    this.clusterId = opts.clusterId
    this.label = opts.label
    this.pollIntervalMs = opts.pollIntervalMs ?? 45_000
    this.model = this.emptyModel()
  }

  private emptyModel(): ClusterModel {
    return {
      id: this.clusterId,
      label: this.label,
      devices: [],
      folders: [],
      shares: [],
      connections: [],
      pendingDevices: [],
      pendingFolders: [],
    }
  }

  getModel(): ClusterModel {
    return this.model
  }

  subscribe(fn: (model: ClusterModel) => void): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  async start(): Promise<void> {
    await this.refresh()
    for (const entry of this.clients) {
      void this.runEventLoop(entry)
    }
    void this.runPollLoop()
  }

  stop(): void {
    this.stopped = true
  }

  /**
   * Registers a new node at runtime — the Phase 5 registration UI, replacing
   * hand-editing cluster.json. Starts its own event loop immediately
   * (mirrors what start() does for every node at boot, since this one didn't
   * exist yet when start() ran) and persists the full node list back to
   * disk so the file stays in sync and this node survives a restart.
   *
   * Checks connectivity up front: doRefresh()'s per-node fetch failures are
   * caught and logged, not thrown (so one unreachable node never blanks the
   * whole model) — which means without this check, a typo'd URL/apiKey
   * would still persist and report success, and the only symptom would be
   * the node silently never appearing, with no error surfaced anywhere the
   * caller (the Register-node dialog) could show it.
   */
  addNode(config: NodeConfig): Promise<void> {
    return this.enqueueMutation(async () => {
      if (this.clients.some((c) => c.nodeId === config.id)) {
        throw new InvalidTargetError(`${config.id} is already a registered node`)
      }
      const client = new SyncthingClient(config)
      const status = await client.systemStatus()
      // A label collision is caught above, but the same physical node could
      // be registered again under a different label (typo'd/aliased URL) —
      // check the identity Syncthing itself reports, since two ClientEntry
      // objects polling the same node would double its snapshot in the
      // aggregated model (duplicate Share rows per shared folder) and poll
      // it twice forever.
      if (this.snapshots.some((s) => s.myID === status.myID)) {
        throw new InvalidTargetError(`${status.myID} is already registered (as a different node id)`)
      }
      const entry: ClientEntry = { nodeId: config.id, client }
      this.clients.push(entry)
      void this.runEventLoop(entry)
      this.persist()
      await this.refreshAfterMutation()
    })
  }

  /**
   * De-registers a node — splicing it out of this.clients is itself the
   * stop signal its event loop notices on its next iteration (no forced
   * abort of an in-flight long-poll, same as how the manager-wide stop()
   * already works). Only removes it from OUR registry; doesn't touch that
   * node's own Syncthing config, and doesn't remove it as a peer from any
   * OTHER registered node (see removeDevice for that — a different,
   * already-existing action).
   *
   * Accepts either the node's own Syncthing device ID (aggregate.ts sets
   * managed devices' Device.id to snap.myID — what the web UI/every other
   * mutation route already identifies a device by) or the internal
   * registration label (NodeConfig.id, e.g. "st-a") directly.
   */
  removeNode(id: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const nodeId = this.clients.some((c) => c.nodeId === id)
        ? id
        : this.snapshots.find((s) => s.myID === id)?.nodeId
      const index = nodeId !== undefined ? this.clients.findIndex((c) => c.nodeId === nodeId) : -1
      if (index === -1) throw new NotManagedError(id)
      this.clients.splice(index, 1)
      this.persist()
      await this.refreshAfterMutation()
    })
  }

  /**
   * Best-effort: an in-memory add/remove already succeeded by the time this
   * runs, so a disk-write failure is logged, not thrown — the running
   * process keeps working correctly either way, it just won't survive a
   * restart until the underlying problem (e.g. a read-only filesystem) is
   * fixed. Never include this in an HTTP response; it round-trips every
   * registered node's raw apiKey through toConfig().
   */
  private persist(): void {
    try {
      saveNodeConfig(this.clients.map((c) => c.client.toConfig()))
    } catch (err) {
      console.error('[clusterfuck-proxy] failed to persist node config:', (err as Error).message)
    }
  }

  /**
   * Single-flight with coalescing: the N per-node event loops and the poll
   * backstop can all trigger refreshes concurrently. Sharing one in-flight
   * run prevents a stampede of full-cluster re-polls. Callers that don't
   * need a freshness guarantee (the poll/event loops — another cycle is
   * always coming) use this; mutations use refreshAfterMutation() instead,
   * see below.
   */
  private refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight
    const p = this.doRefresh().finally(() => {
      if (this.refreshInFlight === p) this.refreshInFlight = undefined
    })
    this.refreshInFlight = p
    return p
  }

  /**
   * Used right after a mutation's own writes complete. A plain refresh()
   * can coalesce onto a cycle that started (and already read snapshots)
   * before this mutation's writes landed — coalescing into it would resolve
   * "success" while the model, and the next SSE frame, still show the
   * pre-mutation state. Waiting out any in-flight cycle first, then always
   * running one more, guarantees the cycle we wait on started after our own
   * writes landed.
   */
  private async refreshAfterMutation(): Promise<void> {
    if (this.refreshInFlight) {
      await this.refreshInFlight.catch(() => undefined)
    }
    await this.refresh()
  }

  private async doRefresh(): Promise<void> {
    if (this.clients.length === 0) {
      // Genuinely zero registered nodes (e.g. the last one was just removed
      // via removeNode) — unlike a transient all-nodes-unreachable blip,
      // there's no "last known good" worth preserving here. Before runtime
      // removal existed, this branch was unreachable: loadNodeConfig always
      // required 1+ nodes at startup.
      //
      // Skip re-notifying if we're already in this state — this.snapshots
      // is only ever emptied by this same branch, so seeing it already
      // empty here means a previous cycle already applied and broadcast
      // the empty model. Without this, the low-frequency poll backstop
      // (runPollLoop) would push an identical empty SSE frame to every
      // connected browser on every tick for as long as zero nodes stay
      // registered, instead of only once on the actual transition. A
      // brand-new subscriber still gets the current (already empty) model
      // immediately on connect regardless — that's a direct write in
      // server.ts, not this notify path.
      if (this.snapshots.length === 0) return
      this.applyModel([], this.emptyModel())
      return
    }

    const snapshots = await Promise.all(
      this.clients.map(({ nodeId, client }) =>
        fetchNodeSnapshot(client, nodeId).catch((err: unknown) => {
          console.error(`[clusterfuck-proxy] snapshot failed for ${nodeId}:`, (err as Error).message)
          return undefined
        }),
      ),
    )
    const valid = snapshots.filter((s): s is NodeSnapshot => s !== undefined)
    if (valid.length === 0) return // keep last-known-good model rather than blanking it out

    this.applyModel(valid, aggregateCluster(valid, this.clusterId, this.label))
  }

  private applyModel(snapshots: NodeSnapshot[], model: ClusterModel): void {
    this.snapshots = snapshots
    this.model = model
    for (const fn of this.subscribers) fn(this.model)
  }

  /**
   * Serializes mutations. Folder edits are GET-modify-PUT of the whole
   * folder config, so two concurrent edits would clobber each other
   * (last-write-wins over the entire object, not just the changed field).
   */
  private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.mutationChain.then(fn)
    this.mutationChain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /**
   * Looks up the client for the registered node whose *own Syncthing device
   * ID* (not our internal config label) is `deviceId` — i.e. the node a
   * Share's `deviceId` refers to, since aggregation only ever produces Share
   * rows from a node's first-hand view of its own folders.
   */
  private clientForDevice(deviceId: string): SyncthingClient {
    return this.resolveTargets([deviceId])[0]!.client
  }

  /**
   * Every registered node (other than the device's own, if it is one) whose
   * own config lists `deviceId` as a peer — the fan-out target set for any
   * "do this to a device everywhere we can" action (pause, remove, ...).
   */
  private nodesReferencing(deviceId: string): { nodeId: string; client: SyncthingClient }[] {
    return this.clients.filter(({ nodeId }) => {
      const snap = this.snapshots.find((s) => s.nodeId === nodeId)
      if (!snap || snap.myID === deviceId) return false
      return snap.devices.some((d) => d.deviceId === deviceId)
    })
  }

  /**
   * Pauses/resumes *every* registered node's connection to this device — same
   * effect as clicking pause in each of those nodes' own Syncthing GUIs. A
   * device doesn't need to be one of our own registered nodes for this to
   * work, only referenced by at least one registered node's own config.
   */
  setDevicePaused(deviceId: string, paused: boolean): Promise<void> {
    return this.enqueueMutation(async () => {
      const targets = this.nodesReferencing(deviceId)
      if (targets.length === 0) throw new NotManagedError(deviceId)

      // allSettled, not all: if one node fails mid-fan-out the others have
      // already changed state, so always refresh, then report which failed.
      const results = await Promise.allSettled(
        targets.map(({ client }) =>
          paused ? client.pauseDevice(deviceId) : client.resumeDevice(deviceId),
        ),
      )
      await this.finishFanOut(`${paused ? 'pause' : 'resume'} of ${deviceId}`, targets, results)
    })
  }

  /**
   * Removes this device as a peer from every registered node that has it
   * configured — Syncthing also drops it from any folder it was shared on
   * for that node. Same scope as setDevicePaused: every referencing node,
   * never the device's own config (there's no "remove yourself").
   */
  removeDevice(deviceId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const targets = this.nodesReferencing(deviceId)
      if (targets.length === 0) throw new NotManagedError(deviceId)

      const results = await Promise.allSettled(targets.map(({ client }) => client.deleteDevice(deviceId)))
      await this.finishFanOut(`removing device ${deviceId}`, targets, results)
    })
  }

  /**
   * Pauses/resumes every device every registered node knows about (skipping
   * each node's own self-entry). One mutation covering the whole cluster —
   * looping setDevicePaused per device would serialize a full refresh per
   * device instead of one for the whole batch.
   */
  setAllDevicesPaused(paused: boolean): Promise<void> {
    return this.enqueueMutation(async () => {
      const jobs: { label: string; run: () => Promise<void> }[] = []
      for (const snap of this.snapshots) {
        const entry = this.clients.find((c) => c.nodeId === snap.nodeId)
        if (!entry) continue
        const { client } = entry
        for (const d of snap.devices) {
          if (d.deviceId === snap.myID) continue
          jobs.push({
            label: `${snap.nodeId}→${d.deviceId}`,
            run: () => (paused ? client.pauseDevice(d.deviceId) : client.resumeDevice(d.deviceId)),
          })
        }
      }
      await this.runBulk(`${paused ? 'pause' : 'resume'} all devices`, jobs)
    })
  }

  /** Pauses/resumes every folder on every registered node that has it — cluster-wide. */
  setAllFoldersPaused(paused: boolean): Promise<void> {
    return this.enqueueMutation(async () => {
      const jobs: { label: string; run: () => Promise<void> }[] = []
      for (const snap of this.snapshots) {
        const entry = this.clients.find((c) => c.nodeId === snap.nodeId)
        if (!entry) continue
        const { client } = entry
        for (const f of snap.folders) {
          jobs.push({
            label: `${snap.nodeId}/${f.id}`,
            run: () => this.applyFolderPatch(client, f.id, (folder) => (folder.paused = paused)),
          })
        }
      }
      await this.runBulk(`${paused ? 'pause' : 'resume'} all folders`, jobs)
    })
  }

  rescanFolder(deviceId: string, folderId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.clientForDevice(deviceId).rescanFolder(folderId)
      await this.refreshAfterMutation()
    })
  }

  overrideFolder(deviceId: string, folderId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.clientForDevice(deviceId).overrideFolder(folderId)
      await this.refreshAfterMutation()
    })
  }

  revertFolder(deviceId: string, folderId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.clientForDevice(deviceId).revertFolder(folderId)
      await this.refreshAfterMutation()
    })
  }

  /**
   * Reads every registered node's `.stignore` patterns for one folder — an
   * on-demand fan-out (not part of the aggregated model; see FolderIgnores).
   * Read-only, so it's not serialized through the mutation chain. One entry
   * per node whose own config shares the folder (its snapshot lists it), with
   * a per-node `error` captured rather than failing the whole call — the same
   * "one bad node doesn't blank everything" stance as doRefresh.
   */
  async getFolderIgnores(folderId: string): Promise<FolderIgnores> {
    const nodes = await Promise.all(
      this.sharingNodes(folderId).map(async ({ deviceId, client }) => {
        try {
          const res = await client.folderIgnores(folderId)
          return { deviceId, patterns: res.ignore ?? [] }
        } catch (err) {
          return { deviceId, patterns: [], error: (err as Error).message }
        }
      }),
    )
    return { folderId, nodes }
  }

  /**
   * Reads every sharing node's failed (pull-error) items for one folder —
   * the per-item paths/errors behind the model's `failedItems` count. Same
   * on-demand, per-node-error-captured shape as getFolderIgnores.
   */
  async getFolderFailedItems(folderId: string): Promise<FolderFailedItems> {
    const nodes = await Promise.all(
      this.sharingNodes(folderId).map(async ({ deviceId, client }) => {
        try {
          const res = await client.folderErrors(folderId)
          return { deviceId, items: res.errors ?? [] }
        } catch (err) {
          return { deviceId, items: [], error: (err as Error).message }
        }
      }),
    )
    return { folderId, nodes }
  }

  /**
   * Scans every sharing node's view of the folder tree for Syncthing conflict
   * copies (`*.sync-conflict-...`). On demand only — /rest/db/browse returns
   * the whole tree, which is far too heavy for the refresh cycle; the UI puts
   * it behind an explicit button for the same reason.
   */
  async getFolderConflicts(folderId: string): Promise<FolderConflicts> {
    const nodes = await Promise.all(
      this.sharingNodes(folderId).map(async ({ deviceId, client }) => {
        try {
          const tree = await client.dbBrowse(folderId)
          return { deviceId, paths: collectConflictPaths(tree) }
        } catch (err) {
          return { deviceId, paths: [], error: (err as Error).message }
        }
      }),
    )
    return { folderId, nodes }
  }

  /** Every registered node whose own config shares `folderId`, keyed by its own device ID — the read fan-out target set. */
  private sharingNodes(folderId: string): { deviceId: string; client: SyncthingClient }[] {
    return this.clients.flatMap(({ nodeId, client }) => {
      const snap = this.snapshots.find((s) => s.nodeId === nodeId)
      if (!snap || !snap.folders.some((f) => f.id === folderId)) return []
      return [{ deviceId: snap.myID, client }]
    })
  }

  /** Replaces this folder's `.stignore` patterns on one node. */
  setFolderIgnores(deviceId: string, folderId: string, patterns: string[]): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.clientForDevice(deviceId).setFolderIgnores(folderId, patterns)
      // Ignore changes shift what's in/out of sync, so re-poll to reflect the
      // new folder state in the next SSE frame rather than waiting for events.
      await this.refreshAfterMutation()
    })
  }

  /** Removes a folder from one specific registered node's config only — not cluster-wide. */
  removeFolder(deviceId: string, folderId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.clientForDevice(deviceId).deleteFolder(folderId)
      await this.refreshAfterMutation()
    })
  }

  setFolderPaused(deviceId: string, folderId: string, paused: boolean): Promise<void> {
    return this.patchFolder(deviceId, folderId, (f) => {
      f.paused = paused
    })
  }

  setFolderType(deviceId: string, folderId: string, type: SyncthingFolderType): Promise<void> {
    return this.patchFolder(deviceId, folderId, (f) => {
      f.type = type
    })
  }

  /**
   * Sets this folder's file-versioning config on one node. `type: 'none'`
   * maps back to Syncthing's empty-string ("versioning off") and clears the
   * params. Other fields on the existing versioning block (fsPath/fsType,
   * and cleanupIntervalS when the caller doesn't set it) are preserved via
   * the GET-modify-PUT, so we don't clobber knobs we don't model.
   */
  setFolderVersioning(
    deviceId: string,
    folderId: string,
    spec: { type: VersioningType; params: Record<string, string>; cleanupIntervalS?: number },
  ): Promise<void> {
    return this.patchFolder(deviceId, folderId, (f) => {
      f.versioning = {
        ...f.versioning,
        type: spec.type === 'none' ? '' : spec.type,
        params: spec.params,
        ...(spec.cleanupIntervalS !== undefined ? { cleanupIntervalS: spec.cleanupIntervalS } : {}),
      }
    })
  }

  /**
   * Sets this folder's advanced options (rescan interval, watcher, min disk
   * free) on one node. The GET-modify-PUT only touches these four fields, so
   * everything else on the folder config rides through untouched.
   */
  setFolderAdvanced(deviceId: string, folderId: string, opts: FolderAdvancedOptions): Promise<void> {
    return this.patchFolder(deviceId, folderId, (f) => {
      f.rescanIntervalS = opts.rescanIntervalS
      f.fsWatcherEnabled = opts.fsWatcherEnabled
      f.fsWatcherDelayS = opts.fsWatcherDelayS
      f.minDiskFree = opts.minDiskFree
    })
  }

  /**
   * Adds shareDeviceId to this folder on this node, optionally with an
   * encryption password for an untrusted/receiveencrypted peer (the peer's
   * own copy of the folder ends up receiveencrypted; we never see or store
   * that — only this trusted-side share entry carries the password). Also
   * doubles as "set/change the password on an already-shared device", since
   * re-adding an existing device just updates its entry.
   */
  addShare(
    deviceId: string,
    folderId: string,
    shareDeviceId: string,
    encryptionPassword?: string,
  ): Promise<void> {
    return this.patchFolder(deviceId, folderId, (f) => {
      const snap = this.snapshots.find((s) => s.myID === deviceId)
      if (snap && !snap.devices.some((d) => d.deviceId === shareDeviceId)) {
        throw new InvalidTargetError(
          `${shareDeviceId} is not a configured peer on ${snap.nodeId}, so it cannot be added to this folder`,
        )
      }
      const existing = f.devices.find((d) => d.deviceID === shareDeviceId)
      if (existing) {
        if (encryptionPassword !== undefined) existing.encryptionPassword = encryptionPassword
      } else {
        f.devices.push({
          deviceID: shareDeviceId,
          ...(encryptionPassword !== undefined ? { encryptionPassword } : {}),
        })
      }
    })
  }

  removeShare(deviceId: string, folderId: string, shareDeviceId: string): Promise<void> {
    return this.patchFolder(deviceId, folderId, (f) => {
      f.devices = f.devices.filter((d) => d.deviceID !== shareDeviceId)
    })
  }

  /**
   * PNG QR code of a device's ID, rendered by the first reachable registered
   * node's own /qr/ endpoint (any node can render it — the image is a pure
   * function of the text). Restricted to IDs actually in the model so this
   * can't be used as a render-anything proxy. Read-only, not serialized
   * through the mutation chain.
   */
  async getDeviceQr(deviceId: string): Promise<Buffer> {
    const known =
      this.model.devices.some((d) => d.id === deviceId) ||
      this.model.pendingDevices.some((d) => d.deviceId === deviceId)
    if (!known) throw new InvalidTargetError(`${deviceId} is not a device in this cluster`)

    let lastError: Error = new NotManagedError(deviceId)
    for (const { client } of this.clients) {
      try {
        return await client.qrPng(deviceId)
      } catch (err) {
        lastError = err as Error
      }
    }
    throw lastError
  }

  /**
   * How every registered node that references this device currently has it
   * configured — the on-demand read behind the device-options editor. Same
   * fan-out set as pause/remove (never the device's own self-entry), with
   * per-node errors captured rather than failing the whole call.
   */
  async getDeviceOptions(deviceId: string): Promise<DeviceOptionsView> {
    const targets = this.nodesReferencing(deviceId)
    const nodes = await Promise.all(
      targets.map(async ({ nodeId, client }) => {
        const myID = this.snapshots.find((s) => s.nodeId === nodeId)?.myID ?? nodeId
        try {
          const d = await client.deviceConfig(deviceId)
          return {
            nodeId: myID,
            options: {
              name: d.name ?? '',
              addresses: d.addresses ?? ['dynamic'],
              compression: d.compression ?? 'metadata',
              introducer: d.introducer ?? false,
              autoAcceptFolders: d.autoAcceptFolders ?? false,
              maxSendKbps: d.maxSendKbps ?? 0,
              maxRecvKbps: d.maxRecvKbps ?? 0,
            },
          }
        } catch (err) {
          return { nodeId: myID, error: (err as Error).message }
        }
      }),
    )
    return { deviceId, nodes }
  }

  /**
   * Applies the same device options on every registered node that references
   * the device — the write half of getDeviceOptions, same scope as
   * setDevicePaused. Element-scoped PATCH per node (no read-modify-write),
   * so fields we don't model (paused, allowedNetworks, ...) are untouched.
   */
  setDeviceOptions(deviceId: string, options: DeviceOptions): Promise<void> {
    return this.enqueueMutation(async () => {
      const targets = this.nodesReferencing(deviceId)
      if (targets.length === 0) throw new NotManagedError(deviceId)

      const results = await Promise.allSettled(
        targets.map(({ client }) => client.patchDeviceConfig(deviceId, options)),
      )
      await this.finishFanOut(`updating options for ${deviceId}`, targets, results)
    })
  }

  /** Adds a device entry to each named registered node's config. */
  addDevice(deviceId: string, name: string | undefined, targetDeviceIds: string[]): Promise<void> {
    return this.enqueueMutation(async () => {
      const targets = this.resolveTargets(targetDeviceIds)
      const results = await Promise.allSettled(
        targets.map(({ client }) => client.postDevice({ deviceID: deviceId, name })),
      )
      await this.finishFanOut(`adding device ${deviceId}`, targets, results)
    })
  }

  /**
   * Creates a folder on each named registered node, shared among all of
   * them. Same id + same share group everywhere; per-node paths/types can
   * be edited afterwards via the folder-scoped mutations. Requires 2+
   * distinct nodes — a 1-node "shared" folder isn't shared with anyone,
   * which the web dialog already enforces, but the HTTP API must too so a
   * direct call can't create one.
   */
  createFolder(
    spec: { id: string; label: string; path: string; type: SyncthingFolderType },
    targetDeviceIds: string[],
  ): Promise<void> {
    return this.enqueueMutation(async () => {
      const distinctIds = [...new Set(targetDeviceIds)]
      if (distinctIds.length < 2) {
        throw new InvalidTargetError('at least two distinct target nodes are required to share a folder')
      }
      const targets = this.resolveTargets(distinctIds)
      const folder: ConfigFolder = {
        id: spec.id,
        label: spec.label,
        type: spec.type,
        paused: false,
        path: spec.path,
        devices: distinctIds.map((deviceID) => ({ deviceID })),
      }
      const results = await Promise.allSettled(
        targets.map(({ client }) => client.postFolder(folder)),
      )
      await this.finishFanOut(`creating folder ${spec.id}`, targets, results)
    })
  }

  /**
   * Accepts a folder a peer has offered to one specific registered node —
   * the cluster-wide "inbox" from ROADMAP.md Phase 5. Unlike createFolder
   * (fans the same folder out to 2+ nodes at once), this is inherently
   * single-node: the offer was made to nodeId by offeredBy, and there's no
   * multi-node share group to create yet, just this one relationship.
   * offeredBy doesn't need to be a registered node itself — pending folders
   * are offered by already-known peers, which is enough. Requires that this
   * exact (folderId, offeredBy) pair is currently pending on nodeId — same
   * spirit as addShare's peer-must-be-configured check, so a caller can't
   * silently create a share with an arbitrary/wrong device.
   */
  acceptPendingFolder(
    nodeId: string,
    folderId: string,
    offeredBy: string,
    spec: { label: string; path: string; type: SyncthingFolderType },
  ): Promise<void> {
    return this.enqueueMutation(async () => {
      const client = this.clientForDevice(nodeId)
      const snap = this.snapshots.find((s) => s.myID === nodeId)
      const offer = snap?.pendingFolders.find(
        (pf) => pf.folderId === folderId && pf.offeredBy === offeredBy,
      )
      if (!offer) {
        throw new InvalidTargetError(
          `${folderId} is not currently offered by ${offeredBy} on ${nodeId}`,
        )
      }
      // The offer says the sender expects us to hold ciphertext only — any
      // other type would try to sync it as plaintext against an encrypted
      // source. Enforced here too, not just in the UI's disabled selector.
      if (offer.receiveEncrypted && spec.type !== 'receiveencrypted') {
        throw new InvalidTargetError(
          `${folderId} was offered encrypted by ${offeredBy}; it can only be accepted as receiveencrypted`,
        )
      }
      const folder: ConfigFolder = {
        id: folderId,
        label: spec.label,
        type: spec.type,
        paused: false,
        path: spec.path,
        devices: [{ deviceID: nodeId }, { deviceID: offeredBy }],
      }
      await client.postFolder(folder)
      await this.refreshAfterMutation()
    })
  }

  /**
   * Dismisses a pending device on every registered node currently reporting
   * it — doesn't add it anywhere. A no-op (not an error) when it isn't
   * pending anywhere: unlike setDevicePaused/removeDevice (acting on a device
   * by identity, which either exists somewhere or doesn't), "dismiss this
   * suggestion" is idempotent — it having already been dismissed or resolved
   * elsewhere is the desired end state, not a failure.
   */
  dismissPendingDevice(deviceId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const targets = this.clients.filter(({ nodeId }) => {
        const snap = this.snapshots.find((s) => s.nodeId === nodeId)
        return snap?.pendingDevices.some((d) => d.deviceId === deviceId) ?? false
      })
      if (targets.length === 0) return
      const results = await Promise.allSettled(
        targets.map(({ client }) => client.dismissPendingDevice(deviceId)),
      )
      await this.finishFanOut(`dismissing pending device ${deviceId}`, targets, results)
    })
  }

  /** Dismisses one folder offer on one node; `offeredBy` narrows to a single offering peer, matching Syncthing's own API. */
  dismissPendingFolder(nodeId: string, folderId: string, offeredBy?: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.clientForDevice(nodeId).dismissPendingFolder(folderId, offeredBy)
      await this.refreshAfterMutation()
    })
  }

  /**
   * Maps target device IDs to their nodes' clients; rejects unmanaged
   * targets up front and de-duplicates so a repeated id doesn't produce
   * doubled config entries or doubled fan-out calls.
   */
  private resolveTargets(
    targetDeviceIds: string[],
  ): { nodeId: string; client: SyncthingClient }[] {
    if (targetDeviceIds.length === 0) {
      throw new InvalidTargetError('at least one target node is required')
    }
    return [...new Set(targetDeviceIds)].map((deviceId) => {
      const snap = this.snapshots.find((s) => s.myID === deviceId)
      const entry = snap && this.clients.find((c) => c.nodeId === snap.nodeId)
      if (!entry) throw new NotManagedError(deviceId)
      return entry
    })
  }

  /** Shared fan-out epilogue: always refresh, then report which nodes failed. */
  private async finishFanOut(
    what: string,
    targets: { nodeId: string }[],
    results: PromiseSettledResult<void>[],
  ): Promise<void> {
    await this.refreshAfterMutation()
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [targets[i]!.nodeId] : []))
    if (failed.length > 0) {
      throw new Error(
        `${what} failed on ${failed.join(', ')}` +
          (failed.length < targets.length ? ' (applied on the remaining nodes)' : ''),
      )
    }
  }

  /**
   * Bulk epilogue for cluster-wide actions (setAllDevicesPaused,
   * setAllFoldersPaused): runs every job, refreshes once regardless of
   * per-job outcome, then reports failures by label (capped, so one job
   * failing on a 200-device cluster doesn't produce an unreadable error).
   */
  private async runBulk(what: string, jobs: { label: string; run: () => Promise<void> }[]): Promise<void> {
    if (jobs.length === 0) return
    const results = await Promise.allSettled(jobs.map((j) => j.run()))
    await this.refreshAfterMutation()
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [jobs[i]!.label] : []))
    if (failed.length > 0) {
      const shown = failed.slice(0, 5).join(', ') + (failed.length > 5 ? `, +${failed.length - 5} more` : '')
      throw new Error(`${what} failed on ${failed.length}/${jobs.length}: ${shown}`)
    }
  }

  /** GET-modify-PUT of one folder's config on one node — the shared core patchFolder and the bulk actions build on. */
  private async applyFolderPatch(
    client: SyncthingClient,
    folderId: string,
    mutate: (folder: ConfigFolder) => void,
  ): Promise<void> {
    const folder = await client.folderConfig(folderId)
    mutate(folder)
    await client.putFolderConfig(folderId, folder)
  }

  private patchFolder(
    deviceId: string,
    folderId: string,
    mutate: (folder: ConfigFolder) => void,
  ): Promise<void> {
    return this.enqueueMutation(async () => {
      const client = this.clientForDevice(deviceId)
      await this.applyFolderPatch(client, folderId, mutate)
      await this.refreshAfterMutation()
    })
  }

  private async runPollLoop(): Promise<void> {
    while (!this.stopped) {
      await sleep(this.pollIntervalMs)
      if (this.stopped) break
      await this.refresh()
    }
  }

  /**
   * Runs until either the whole manager stops, or this specific entry is
   * removed. Checking array membership (rather than a separate per-entry
   * flag) means there's only one place that can make this loop stop —
   * removeNode splicing the entry out of this.clients — so a future
   * removal path can't forget to also flip a second, easy-to-miss flag.
   */
  private async runEventLoop(entry: ClientEntry): Promise<void> {
    let since = 0
    let backoffMs = 1000
    while (!this.stopped && this.clients.includes(entry)) {
      try {
        const events = await entry.client.events(since)
        if (events.length > 0) {
          since = events[events.length - 1]!.id
          if (events.some((e) => RELEVANT_EVENT_TYPES.has(e.type))) {
            await this.refresh()
          }
        }
        backoffMs = 1000
      } catch (err) {
        console.error(
          `[clusterfuck-proxy] event stream error for ${entry.nodeId}:`,
          (err as Error).message,
        )
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 2, 30_000)
      }
    }
  }
}
