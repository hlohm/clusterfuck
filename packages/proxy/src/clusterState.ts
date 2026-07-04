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
  private refreshQueued = false
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
   * Single-flight with coalescing: the N per-node event loops, the poll
   * backstop, and mutations can all trigger refreshes concurrently. Sharing
   * one in-flight run prevents a stampede of full-cluster re-polls, and
   * prevents a slower, older run from overwriting a newer model. A trigger
   * that arrives mid-run queues exactly one follow-up so changes made after
   * the in-flight fetch began are still picked up.
   */
  private refresh(): Promise<void> {
    if (this.refreshInFlight) {
      this.refreshQueued = true
      return this.refreshInFlight
    }
    this.refreshInFlight = this.doRefresh().finally(() => {
      this.refreshInFlight = undefined
      if (this.refreshQueued && !this.stopped) {
        this.refreshQueued = false
        void this.refresh()
      }
    })
    return this.refreshInFlight
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
    const snap = this.snapshots.find((s) => s.myID === deviceId)
    const entry = snap && this.clients.find((c) => c.nodeId === snap.nodeId)
    if (!entry) throw new NotManagedError(deviceId)
    return entry.client
  }

  /**
   * Pauses/resumes *every* registered node's connection to this device — same
   * effect as clicking pause in each of those nodes' own Syncthing GUIs. A
   * device doesn't need to be one of our own registered nodes for this to
   * work, only referenced by at least one registered node's own config.
   */
  setDevicePaused(deviceId: string, paused: boolean): Promise<void> {
    return this.enqueueMutation(async () => {
      const targets = this.clients.filter(({ nodeId }) => {
        const snap = this.snapshots.find((s) => s.nodeId === nodeId)
        if (!snap || snap.myID === deviceId) return false
        return snap.devices.some((d) => d.deviceId === deviceId)
      })
      if (targets.length === 0) throw new NotManagedError(deviceId)

      // allSettled, not all: if one node fails mid-fan-out the others have
      // already changed state, so always refresh, then report which failed.
      const results = await Promise.allSettled(
        targets.map(({ client }) =>
          paused ? client.pauseDevice(deviceId) : client.resumeDevice(deviceId),
        ),
      )
      await this.refresh()
      const failed = results.flatMap((r, i) =>
        r.status === 'rejected' ? [targets[i]!.nodeId] : [],
      )
      if (failed.length > 0) {
        throw new Error(
          `${paused ? 'pause' : 'resume'} of ${deviceId} failed on ${failed.join(', ')}` +
            (failed.length < targets.length ? ' (applied on the remaining nodes)' : ''),
        )
      }
    })
  }

  rescanFolder(deviceId: string, folderId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.clientForDevice(deviceId).rescanFolder(folderId)
      await this.refresh()
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
      await this.refresh()
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
