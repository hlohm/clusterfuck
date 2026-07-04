import type { ClusterModel } from '@clusterfuck/shared'
import { aggregateCluster, type NodeSnapshot } from './aggregate.ts'
import { fetchNodeSnapshot } from './snapshot.ts'
import { SyncthingClient, type NodeConfig } from './syncthing/client.ts'
import type { ConfigFolder, SyncthingFolderType } from './syncthing/types.ts'

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
  private readonly clients: { nodeId: string; client: SyncthingClient }[]
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
    this.model = { id: this.clusterId, label: this.label, devices: [], folders: [], shares: [] }
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
    for (const { nodeId, client } of this.clients) {
      void this.runEventLoop(nodeId, client)
    }
    void this.runPollLoop()
  }

  stop(): void {
    this.stopped = true
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

    this.snapshots = valid
    this.model = aggregateCluster(valid, this.clusterId, this.label)
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

  rescanFolder(deviceId: string, folderId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.clientForDevice(deviceId).rescanFolder(folderId)
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

  addShare(deviceId: string, folderId: string, shareDeviceId: string): Promise<void> {
    return this.patchFolder(deviceId, folderId, (f) => {
      const snap = this.snapshots.find((s) => s.myID === deviceId)
      if (snap && !snap.devices.some((d) => d.deviceId === shareDeviceId)) {
        throw new InvalidTargetError(
          `${shareDeviceId} is not a configured peer on ${snap.nodeId}, so it cannot be added to this folder`,
        )
      }
      if (!f.devices.some((d) => d.deviceID === shareDeviceId)) {
        f.devices.push({ deviceID: shareDeviceId })
      }
    })
  }

  removeShare(deviceId: string, folderId: string, shareDeviceId: string): Promise<void> {
    return this.patchFolder(deviceId, folderId, (f) => {
      f.devices = f.devices.filter((d) => d.deviceID !== shareDeviceId)
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

  private patchFolder(
    deviceId: string,
    folderId: string,
    mutate: (folder: ConfigFolder) => void,
  ): Promise<void> {
    return this.enqueueMutation(async () => {
      const client = this.clientForDevice(deviceId)
      const folder = await client.folderConfig(folderId)
      mutate(folder)
      await client.putFolderConfig(folderId, folder)
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

  private async runEventLoop(nodeId: string, client: SyncthingClient): Promise<void> {
    let since = 0
    let backoffMs = 1000
    while (!this.stopped) {
      try {
        const events = await client.events(since)
        if (events.length > 0) {
          since = events[events.length - 1]!.id
          if (events.some((e) => RELEVANT_EVENT_TYPES.has(e.type))) {
            await this.refresh()
          }
        }
        backoffMs = 1000
      } catch (err) {
        console.error(
          `[clusterfuck-proxy] event stream error for ${nodeId}:`,
          (err as Error).message,
        )
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 2, 30_000)
      }
    }
  }
}
