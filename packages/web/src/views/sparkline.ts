import type { CompletionPoint } from '@clusterfuck/shared'

/**
 * Path math for the completion sparklines — pure and unit-tested; the SVG
 * wrapper in OverviewView stays purely presentational. The y-domain is the
 * honest fixed 0–100%: a sparkline that rescaled to its own min/max would
 * make a 99→100% wiggle look like a cliff.
 */

export interface SparklineGeometry {
  /** SVG path `d` for the completion line. */
  d: string
  /** Accessible one-line summary of the series. */
  label: string
}

export function sparklineGeometry(
  points: CompletionPoint[],
  width: number,
  height: number,
  pad = 1.5,
): SparklineGeometry | undefined {
  if (points.length < 2) return undefined

  const t0 = points[0]!.t
  const t1 = points[points.length - 1]!.t
  const x = (t: number) =>
    t1 === t0 ? width / 2 : pad + ((t - t0) / (t1 - t0)) * (width - 2 * pad)
  const y = (pct: number) => pad + ((100 - pct) / 100) * (height - 2 * pad)

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.pct).toFixed(1)}`)
    .join(' ')

  const pcts = points.map((p) => p.pct)
  const min = Math.min(...pcts)
  const now = pcts[pcts.length - 1]!
  const minutes = Math.max(1, Math.round((t1 - t0) / 60_000))
  const label =
    min === now && pcts.every((p) => p === now)
      ? `Completion steady at ${now}% over the last ${minutes} min`
      : `Completion over the last ${minutes} min: low ${min}%, now ${now}%`

  return { d, label }
}
