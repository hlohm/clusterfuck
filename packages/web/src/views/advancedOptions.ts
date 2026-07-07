import type { FolderAdvancedOptions } from '@clusterfuck/shared'
import { formatDuration } from '../format'

/**
 * Editor + display helpers for a share's advanced folder options. Pure
 * functions (no React), same layout as versioning.ts: the model carries typed
 * numbers/booleans, the editor works in string form fields, and these convert
 * between the two so the conversions are unit-testable on their own.
 */

/** Syncthing's own defaults — what the editor starts from when a fixture share carries no options. */
export const ADVANCED_DEFAULTS: FolderAdvancedOptions = {
  rescanIntervalS: 3600,
  fsWatcherEnabled: true,
  fsWatcherDelayS: 10,
  minDiskFree: { value: 1, unit: '%' },
}

export interface AdvancedFormFields {
  rescanIntervalS: string
  fsWatcherEnabled: boolean
  fsWatcherDelayS: string
  minDiskFreeValue: string
  minDiskFreeUnit: string
}

export function advancedFormFields(current: FolderAdvancedOptions | undefined): AdvancedFormFields {
  const a = current ?? ADVANCED_DEFAULTS
  return {
    rescanIntervalS: String(a.rescanIntervalS),
    fsWatcherEnabled: a.fsWatcherEnabled,
    fsWatcherDelayS: String(a.fsWatcherDelayS),
    minDiskFreeValue: String(a.minDiskFree.value),
    minDiskFreeUnit: a.minDiskFree.unit,
  }
}

/**
 * Mirrors the proxy's own validation (rescan >= 0, delay > 0, min disk free
 * >= 0) so the Apply button disables instead of round-tripping to a 400.
 */
export function advancedFieldsValid(fields: AdvancedFormFields): boolean {
  const rescan = Number(fields.rescanIntervalS)
  const delay = Number(fields.fsWatcherDelayS)
  const free = Number(fields.minDiskFreeValue)
  return (
    fields.rescanIntervalS.trim() !== '' &&
    Number.isFinite(rescan) &&
    rescan >= 0 &&
    fields.fsWatcherDelayS.trim() !== '' &&
    Number.isFinite(delay) &&
    delay > 0 &&
    fields.minDiskFreeValue.trim() !== '' &&
    Number.isFinite(free) &&
    free >= 0
  )
}

/** Only meaningful when advancedFieldsValid(fields) — numbers parse unchecked here. */
export function advancedFromFormFields(fields: AdvancedFormFields): FolderAdvancedOptions {
  return {
    rescanIntervalS: Number(fields.rescanIntervalS),
    fsWatcherEnabled: fields.fsWatcherEnabled,
    fsWatcherDelayS: Number(fields.fsWatcherDelayS),
    minDiskFree: { value: Number(fields.minDiskFreeValue), unit: fields.minDiskFreeUnit },
  }
}

/** "1 %" reads worse than "1%"; sized units keep the space ("500 MB"). */
export function formatMinDiskFree(minDiskFree: FolderAdvancedOptions['minDiskFree']): string {
  return `${minDiskFree.value}${minDiskFree.unit === '%' ? '' : ' '}${minDiskFree.unit}`
}

/** A one-line human summary for the read-only detail view. */
export function describeAdvanced(a: FolderAdvancedOptions): string {
  const rescan = a.rescanIntervalS > 0 ? `rescan every ${formatDuration(a.rescanIntervalS)}` : 'periodic rescan off'
  const watcher = a.fsWatcherEnabled ? `watcher on (${a.fsWatcherDelayS}s)` : 'watcher off'
  const free = a.minDiskFree.value > 0 ? `min free ${formatMinDiskFree(a.minDiskFree)}` : 'no free-space floor'
  return `${rescan} · ${watcher} · ${free}`
}
