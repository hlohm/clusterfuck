import type { FolderState } from '../model/types'
import type { ThemedColor } from './colors'
import { STATUS } from './colors'

export interface FolderStateStyle {
  label: string
  color: ThemedColor
  icon: 'check' | 'sync' | 'scan' | 'alert-triangle' | 'x-circle' | 'pause'
}

/**
 * Per-share status badge. idle/error/out-of-sync/paused use the fixed status
 * palette (good/critical/serious/warning); scanning & syncing are in-progress
 * states, not good-or-bad, so they get the neutral "activity" token instead.
 */
export const FOLDER_STATE_STYLE: Record<FolderState, FolderStateStyle> = {
  idle: { label: 'Idle', color: STATUS.good, icon: 'check' },
  syncing: { label: 'Syncing', color: STATUS.activity, icon: 'sync' },
  scanning: { label: 'Scanning', color: STATUS.activity, icon: 'scan' },
  'out-of-sync': { label: 'Out of sync', color: STATUS.serious, icon: 'alert-triangle' },
  error: { label: 'Error', color: STATUS.critical, icon: 'x-circle' },
  paused: { label: 'Paused', color: STATUS.warning, icon: 'pause' },
}

export function themedColor(color: ThemedColor, isDark: boolean): string {
  return isDark ? color.dark : color.light
}
