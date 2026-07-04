import type { DeviceState } from '@clusterfuck/shared'
import type { ThemedColor } from './colors'
import { STATUS } from './colors'

export interface DeviceStateStyle {
  label: string
  outline: 'solid' | 'dashed'
  icon: 'home' | 'dot' | 'offline' | 'pause'
  accent: ThemedColor
}

/**
 * Node outline treatment. Disconnected is deliberately neutral-gray, not
 * alarm-red: being offline is common/expected, not inherently an error.
 */
export const DEVICE_STATE_STYLE: Record<DeviceState, DeviceStateStyle> = {
  'this-device': { label: 'This device', outline: 'solid', icon: 'home', accent: STATUS.neutral },
  connected: { label: 'Connected', outline: 'solid', icon: 'dot', accent: STATUS.good },
  disconnected: {
    label: 'Disconnected',
    outline: 'dashed',
    icon: 'offline',
    accent: STATUS.neutral,
  },
  paused: { label: 'Paused', outline: 'solid', icon: 'pause', accent: STATUS.warning },
}
