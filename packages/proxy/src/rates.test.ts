import { describe, expect, it } from 'vitest'
import type { Connection } from '@clusterfuck/shared'
import { computeRates, type RateSamples } from './rates.ts'

function conn(overrides: Partial<Connection> = {}): Connection {
  return {
    deviceId: 'A',
    peerId: 'B',
    connected: true,
    inBytesTotal: 0,
    outBytesTotal: 0,
    ...overrides,
  }
}

describe('computeRates', () => {
  it('yields no rate from a first sample, then the delta over the elapsed window', () => {
    const first = computeRates([conn({ inBytesTotal: 1000, outBytesTotal: 500 })], new Map(), 10_000)
    expect(first.connections[0]!.inBps).toBeUndefined()

    const second = computeRates(
      [conn({ inBytesTotal: 21_000, outBytesTotal: 10_500 })],
      first.samples,
      20_000,
    )
    expect(second.connections[0]!.inBps).toBe(2000) // 20_000 bytes over 10s
    expect(second.connections[0]!.outBps).toBe(1000)
  })

  it('carries the previous rate forward when refreshes land closer than the minimum window', () => {
    const first = computeRates([conn({ inBytesTotal: 1000 })], new Map(), 0)
    const second = computeRates([conn({ inBytesTotal: 21_000 })], first.samples, 10_000)
    // A refresh 500ms later: too small a window; keep showing 2000 B/s.
    const third = computeRates([conn({ inBytesTotal: 21_500 })], second.samples, 10_500)
    expect(third.connections[0]!.inBps).toBe(2000)

    // The carried-forward sample still anchors at t=10s, so the next full
    // window computes from there rather than the noisy reading.
    const fourth = computeRates([conn({ inBytesTotal: 41_000 })], third.samples, 20_000)
    expect(fourth.connections[0]!.inBps).toBe(2000)
  })

  it('reports 0 (not a negative rate) after a counter reset, then resumes', () => {
    const first = computeRates([conn({ inBytesTotal: 50_000 })], new Map(), 0)
    const second = computeRates([conn({ inBytesTotal: 100 })], first.samples, 10_000)
    expect(second.connections[0]!.inBps).toBe(0)

    const third = computeRates([conn({ inBytesTotal: 10_100 })], second.samples, 20_000)
    expect(third.connections[0]!.inBps).toBe(1000)
  })

  it('gives a disconnected link no rate, even with an old sample', () => {
    const first = computeRates([conn({ inBytesTotal: 1000 })], new Map(), 0)
    const second = computeRates(
      [conn({ connected: false, inBytesTotal: 0, outBytesTotal: 0 })],
      first.samples,
      10_000,
    )
    expect(second.connections[0]!.inBps).toBeUndefined()
    expect(second.connections[0]!.outBps).toBeUndefined()
  })

  it('drops samples for connections that disappeared', () => {
    const first = computeRates([conn()], new Map(), 0)
    const second = computeRates([], first.samples, 10_000)
    expect(second.samples.size).toBe(0)
  })

  it('keys samples per (reporting node, peer) pair, never mixing directions', () => {
    const ab = conn({ deviceId: 'A', peerId: 'B', inBytesTotal: 1000 })
    const ba = conn({ deviceId: 'B', peerId: 'A', inBytesTotal: 9000 })
    const first = computeRates([ab, ba], new Map(), 0)
    const second = computeRates(
      [
        { ...ab, inBytesTotal: 11_000 },
        { ...ba, inBytesTotal: 9000 },
      ],
      first.samples,
      10_000,
    )
    expect(second.connections[0]!.inBps).toBe(1000)
    expect(second.connections[1]!.inBps).toBe(0)
  })
})

describe('computeRates sample hygiene', () => {
  it('returns a fresh map each cycle (caller owns it; no shared mutation)', () => {
    const previous: RateSamples = new Map()
    const result = computeRates([conn()], previous, 0)
    expect(result.samples).not.toBe(previous)
    expect(previous.size).toBe(0)
  })
})
