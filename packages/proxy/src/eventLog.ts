import type { ClusterEvent, EventLogView } from '@clusterfuck/shared'
import type { SyncthingEvent } from './syncthing/types.ts'

/**
 * The raw event log (ROADMAP.md Phase 5 Observability): every event the
 * per-node event loops receive — default stream and disk stream alike —
 * merged into one bounded, in-memory buffer. Same stance as the
 * recent-changes feed: a diagnostic glance, not a persisted audit trail.
 */
export class EventLog {
  private entries: ClusterEvent[] = []
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  push(nodeDeviceId: string, event: SyncthingEvent): void {
    this.entries.push({
      nodeId: nodeDeviceId,
      id: event.id,
      type: event.type,
      time: event.time,
      data: event.data,
    })
    if (this.entries.length > this.capacity) this.entries.shift()
  }

  /** Newest first; `types`/`nodeId` narrow, `limit` caps after filtering. */
  list(filter?: { types?: Set<string>; nodeId?: string; limit?: number }): EventLogView {
    let events = [...this.entries].reverse()
    if (filter?.types !== undefined && filter.types.size > 0) {
      events = events.filter((e) => filter.types!.has(e.type))
    }
    if (filter?.nodeId !== undefined) {
      events = events.filter((e) => e.nodeId === filter.nodeId)
    }
    if (filter?.limit !== undefined) {
      events = events.slice(0, filter.limit)
    }
    return { events }
  }
}
