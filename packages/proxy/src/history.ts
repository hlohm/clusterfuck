import type { CompletionHistoryView, CompletionPoint, Share } from '@clusterfuck/shared'

/**
 * Completion history for the overview sparklines (ROADMAP.md Phase 5
 * Observability). In-memory and bounded like the recent-changes feed: enough
 * points to draw a trend, not a metrics store — a proxy restart starts empty.
 */

type SampledShare = Pick<Share, 'folderId' | 'deviceId' | 'completionPct'>

/** Unambiguous for any id contents — folder ids can legally contain most separators. */
function keyOf(folderId: string, deviceId: string): string {
  return JSON.stringify([folderId, deviceId])
}

export class CompletionHistory {
  private readonly series = new Map<string, CompletionPoint[]>()
  private readonly capacity: number
  private readonly minIntervalMs: number

  /**
   * With the 45s poll backstop as the slowest refresh cadence, the defaults
   * (120 points, ≥30s apart) hold roughly the last hour and a half.
   */
  constructor(capacity = 120, minIntervalMs = 30_000) {
    this.capacity = capacity
    this.minIntervalMs = minIntervalMs
  }

  /**
   * Samples the current shares. Appends at most one point per share per
   * minIntervalMs — refreshes are event-driven and can land in bursts, and a
   * sparkline wants a steady cadence, not one point per event. Series for
   * shares no longer in the model are dropped.
   */
  record(shares: SampledShare[], now: number): void {
    const liveKeys = new Set<string>()
    for (const share of shares) {
      if (share.completionPct === undefined) continue
      const key = keyOf(share.folderId, share.deviceId)
      liveKeys.add(key)
      const points = this.series.get(key) ?? []
      const last = points[points.length - 1]
      if (last !== undefined && now - last.t < this.minIntervalMs) continue
      points.push({ t: now, pct: share.completionPct })
      if (points.length > this.capacity) points.shift()
      this.series.set(key, points)
    }
    for (const key of this.series.keys()) {
      if (!liveKeys.has(key)) this.series.delete(key)
    }
  }

  view(): CompletionHistoryView {
    return {
      series: [...this.series.entries()].map(([key, points]) => {
        const [folderId, deviceId] = JSON.parse(key) as [string, string]
        return { folderId, deviceId, points: [...points] }
      }),
    }
  }
}
