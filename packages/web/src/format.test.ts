import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration } from './format'

describe('formatDuration', () => {
  it('formats seconds under a minute as seconds', () => {
    expect(formatDuration(45)).toBe('45s')
  })

  it('formats minutes under an hour as minutes only', () => {
    expect(formatDuration(60 * 5)).toBe('5m')
  })

  it('formats hours under a day as hours + minutes', () => {
    expect(formatDuration(3 * 3600 + 12 * 60)).toBe('3h 12m')
  })

  it('formats a day or more as days + hours, dropping minutes', () => {
    expect(formatDuration(2 * 86400 + 5 * 3600 + 40 * 60)).toBe('2d 5h')
  })

  it('rounds down rather than up, at every scale', () => {
    // 1h 59m 59s should read "1h 59m", not round up to "2h" or "1h 60m".
    expect(formatDuration(3600 + 59 * 60 + 59)).toBe('1h 59m')
  })

  it('degrades to a placeholder instead of "NaNd NaNh" for a non-finite input', () => {
    expect(formatDuration(NaN)).toBe('unknown')
    expect(formatDuration(Infinity)).toBe('unknown')
  })
})

describe('formatBytes', () => {
  it('formats sub-1024 byte counts with no decimal and a "B" unit', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes with one decimal place', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(84_500_000)).toBe('80.6 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(2_147_483_648)).toBe('2.0 GB')
  })

  it('caps at TB instead of continuing to PB and beyond', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024.0 TB')
  })

  // Regression: comparing the loop's promotion threshold against the
  // unrounded value let a byte count a couple bytes under a power-of-1024
  // boundary get stuck one unit too low, then round UP to "1024.0" at
  // display time anyway — reading as though it should have promoted.
  it('promotes to the next unit rather than displaying "1024.0" of the current one, near a boundary', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe('1.0 GB')
  })

  it('degrades to a placeholder instead of throwing for a non-finite input', () => {
    expect(formatBytes(NaN)).toBe('unknown')
    expect(formatBytes(Infinity)).toBe('unknown')
  })
})
