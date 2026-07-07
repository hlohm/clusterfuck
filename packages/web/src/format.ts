/**
 * Coarsest unit that keeps the number readable — down to the minute;
 * seconds don't matter at uptime scale. Guards against a non-finite input
 * (rather than silently printing "NaNd NaNh"): the underlying value ultimately
 * comes from a Syncthing REST response this proxy only validates at the type
 * level, not at runtime, and DetailPanel isn't wrapped in an error boundary.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'unknown'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${Math.floor(seconds)}s`
}

/** A live transfer rate — the byte formatting with a per-second suffix. */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'unknown'
  let value = bytes
  let unitIndex = 0
  // Round at the precision we're about to display before comparing against
  // the next unit's threshold — otherwise a value like 1023.9996 (a couple
  // bytes under 1 MiB) stays classified as KB, but toFixed(1) below rounds
  // its own display to "1024.0", reading as though it should have promoted.
  while (unitIndex < BYTE_UNITS.length - 1 && Math.round(value * 10) / 10 >= 1024) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${BYTE_UNITS[unitIndex]}`
}
