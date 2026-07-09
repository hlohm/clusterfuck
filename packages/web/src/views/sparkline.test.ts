import { describe, expect, it } from 'vitest'
import { sparklineGeometry } from './sparkline'

describe('sparklineGeometry', () => {
  it('needs at least two points', () => {
    expect(sparklineGeometry([], 60, 18)).toBeUndefined()
    expect(sparklineGeometry([{ t: 0, pct: 50 }], 60, 18)).toBeUndefined()
  })

  it('maps time to x and the fixed 0–100 domain to y (100% at the top)', () => {
    const geometry = sparklineGeometry(
      [
        { t: 0, pct: 0 },
        { t: 100_000, pct: 100 },
      ],
      60,
      18,
      1.5,
    )!
    // 0% sits at the bottom padding edge, 100% at the top one.
    expect(geometry.d).toBe('M1.5,16.5 L58.5,1.5')
  })

  it('does not rescale to its own min/max — a 99→100 wiggle stays visually flat', () => {
    const geometry = sparklineGeometry(
      [
        { t: 0, pct: 99 },
        { t: 60_000, pct: 100 },
      ],
      60,
      18,
      0,
    )!
    const ys = [...geometry.d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]))
    expect(Math.abs(ys[0]! - ys[1]!)).toBeLessThan(0.5)
  })

  it('summarizes the series for the accessible label', () => {
    const moving = sparklineGeometry(
      [
        { t: 0, pct: 40 },
        { t: 600_000, pct: 80 },
      ],
      60,
      18,
    )!
    expect(moving.label).toBe('Completion over the last 10 min: low 40%, now 80%')

    const steady = sparklineGeometry(
      [
        { t: 0, pct: 100 },
        { t: 600_000, pct: 100 },
      ],
      60,
      18,
    )!
    expect(steady.label).toBe('Completion steady at 100% over the last 10 min')
  })
})
