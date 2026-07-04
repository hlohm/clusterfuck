import type { ClusterModel } from '@clusterfuck/shared'
import { aggregateCluster, type NodeSnapshot } from './aggregate.ts'
import { fetchNodeSnapshot } from './snapshot.ts'
import { SyncthingClient, type NodeConfig } from './syncthing/client.ts'

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
  private readonly subscribers = new Set<(model: ClusterModel) => void>()
  private readonly clients: { nodeId: string; client: SyncthingClient }[]
  private readonly clusterId: string
  private readonly label: string
  private readonly pollIntervalMs: number
  private stopped = false

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

  private async refresh(): Promise<void> {
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

    this.model = aggregateCluster(valid, this.clusterId, this.label)
    for (const fn of this.subscribers) fn(this.model)
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
