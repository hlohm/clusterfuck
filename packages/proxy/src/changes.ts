import type { RecentChange } from '@clusterfuck/shared'
import type { DiskEventData, SyncthingEvent } from './syncthing/types.ts'

/**
 * The recent-changes feed's storage and mapping (ROADMAP.md Phase 5
 * Observability). Deliberately in-memory and bounded: this is a "what just
 * happened" glance, not an audit log — a restart starting empty is fine.
 */

/**
 * Maps one disk-stream event to a feed entry; undefined for event types we
 * don't feed (the disk stream is specified to carry only the two change
 * events, but a defensive skip beats a corrupt row).
 */
export function mapDiskEvent(event: SyncthingEvent, nodeDeviceId: string): RecentChange | undefined {
  if (event.type !== 'LocalChangeDetected' && event.type !== 'RemoteChangeDetected') return undefined
  const data = event.data as DiskEventData
  return {
    nodeId: nodeDeviceId,
    folderId: data.folderID ?? data.folder ?? '',
    path: data.path,
    action: data.action,
    itemType: data.type,
    origin: event.type === 'LocalChangeDetected' ? 'local' : 'remote',
    modifiedBy: data.modifiedBy,
    time: event.time,
  }
}

/** Bounded FIFO of changes; list() returns newest first. */
export class ChangeBuffer {
  private entries: RecentChange[] = []
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  push(change: RecentChange): void {
    this.entries.push(change)
    if (this.entries.length > this.capacity) this.entries.shift()
  }

  list(): RecentChange[] {
    return [...this.entries].reverse()
  }
}
