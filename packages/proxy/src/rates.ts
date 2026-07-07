import type { Connection } from '@clusterfuck/shared'

/**
 * Transfer-rate estimation (ROADMAP.md Phase 5 Observability). Syncthing's
 * REST API only exposes cumulative per-connection byte counters, so a live
 * bytes/sec needs stateful sampling: remember each connection's last counter
 * reading and divide the delta by the elapsed time on the next refresh.
 */

export interface RateSample {
  inBytesTotal: number
  outBytesTotal: number
  /** Milliseconds (Date.now()). */
  at: number
  inBps?: number
  outBps?: number
}

export type RateSamples = Map<string, RateSample>

/**
 * Refreshes fire on every relevant event, so two cycles can land almost
 * back-to-back; a delta over a sub-second window is mostly noise. Below this
 * window the previous sample (and its rate) is carried forward unchanged.
 */
const MIN_WINDOW_MS = 2_000

function keyOf(c: Connection): string {
  // A space can't appear in a device ID, so the key is collision-free.
  return `${c.deviceId} ${c.peerId}`
}

/**
 * Annotates connections with inBps/outBps and returns the sample map for the
 * next cycle. Pure: the caller owns the map. Rules:
 * - no previous sample → no rate yet (a single reading can't yield one);
 * - window shorter than MIN_WINDOW_MS → carry the previous rate forward;
 * - counter went backwards (reconnect/restart reset it) → rate 0, resample;
 * - disconnected → no rate (the totals are 0 while disconnected anyway).
 * Samples for connections that disappeared are dropped, so the map can't
 * grow past the current connection list.
 */
export function computeRates(
  connections: Connection[],
  previous: RateSamples,
  now: number,
): { connections: Connection[]; samples: RateSamples } {
  const samples: RateSamples = new Map()
  const annotated = connections.map((c) => {
    if (!c.connected) {
      samples.set(keyOf(c), { inBytesTotal: c.inBytesTotal, outBytesTotal: c.outBytesTotal, at: now })
      return c
    }
    const prev = previous.get(keyOf(c))
    if (!prev) {
      samples.set(keyOf(c), { inBytesTotal: c.inBytesTotal, outBytesTotal: c.outBytesTotal, at: now })
      return c
    }
    if (now - prev.at < MIN_WINDOW_MS) {
      samples.set(keyOf(c), prev)
      return prev.inBps !== undefined ? { ...c, inBps: prev.inBps, outBps: prev.outBps } : c
    }
    const dtSeconds = (now - prev.at) / 1000
    const inDelta = c.inBytesTotal - prev.inBytesTotal
    const outDelta = c.outBytesTotal - prev.outBytesTotal
    const inBps = inDelta < 0 ? 0 : Math.round(inDelta / dtSeconds)
    const outBps = outDelta < 0 ? 0 : Math.round(outDelta / dtSeconds)
    samples.set(keyOf(c), {
      inBytesTotal: c.inBytesTotal,
      outBytesTotal: c.outBytesTotal,
      at: now,
      inBps,
      outBps,
    })
    return { ...c, inBps, outBps }
  })
  return { connections: annotated, samples }
}
