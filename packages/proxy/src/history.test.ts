import { describe, expect, it } from 'vitest'
import { CompletionHistory } from './history.ts'

const share = (pct: number | undefined, folderId = 'f1', deviceId = 'A') => ({
  folderId,
  deviceId,
  completionPct: pct,
})

describe('CompletionHistory', () => {
  it('appends at most one point per share per minimum interval', () => {
    const history = new CompletionHistory(10, 1000)
    history.record([share(50)], 0)
    history.record([share(55)], 500) // burst refresh — dropped
    history.record([share(60)], 1000)

    expect(history.view().series[0]!.points).toEqual([
      { t: 0, pct: 50 },
      { t: 1000, pct: 60 },
    ])
  })

  it('bounds each series to its capacity, dropping the oldest', () => {
    const history = new CompletionHistory(3, 0)
    for (let i = 0; i < 5; i++) history.record([share(i)], i * 1000)

    expect(history.view().series[0]!.points.map((p) => p.pct)).toEqual([2, 3, 4])
  })

  it('skips shares with no completion and drops series for shares gone from the model', () => {
    const history = new CompletionHistory(10, 0)
    history.record([share(50), share(80, 'f2', 'B')], 0)
    expect(history.view().series).toHaveLength(2)

    history.record([share(undefined)], 1000) // f1/A has no pct now; f2/B disappeared
    expect(history.view().series).toHaveLength(0)
  })

  it('keys series by folder AND device, so the same folder on two nodes stays separate', () => {
    const history = new CompletionHistory(10, 0)
    history.record([share(10, 'f1', 'A'), share(90, 'f1', 'B')], 0)

    const byDevice = Object.fromEntries(
      history.view().series.map((s) => [s.deviceId, s.points[0]!.pct]),
    )
    expect(byDevice).toEqual({ A: 10, B: 90 })
  })
})
