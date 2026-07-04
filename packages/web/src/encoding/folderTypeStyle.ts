import type { FolderType } from '@clusterfuck/shared'
import type { ThemedColor } from './colors'

export type ArrowDirection = 'forward' | 'reverse' | 'both'

export interface FolderTypeStyle {
  label: string
  color: ThemedColor
  dash: 'solid' | 'dashed'
  /** forward = device -> folder hub, reverse = folder hub -> device, both = two-way */
  arrow: ArrowDirection
  /** Redundant non-color glyph shown on the edge/legend, e.g. a lock for encrypted. */
  icon?: 'lock'
}

/**
 * Color-blind-safe categorical set (validated: worst adjacent light-mode
 * contrast ratio-of-confusion pass, dark-mode pass). Every hue ships with a
 * distinct line style and arrow direction so type is never color-only.
 */
export const FOLDER_TYPE_STYLE: Record<FolderType, FolderTypeStyle> = {
  sendreceive: {
    label: 'Send & Receive',
    color: { light: '#2a78d6', dark: '#3987e5' },
    dash: 'solid',
    arrow: 'both',
  },
  sendonly: {
    label: 'Send Only',
    color: { light: '#1baf7a', dark: '#199e70' },
    dash: 'solid',
    arrow: 'forward',
  },
  receiveonly: {
    label: 'Receive Only',
    color: { light: '#eda100', dark: '#c98500' },
    dash: 'solid',
    arrow: 'reverse',
  },
  receiveencrypted: {
    label: 'Receive Encrypted',
    color: { light: '#4a3aa7', dark: '#9085e9' },
    dash: 'dashed',
    arrow: 'reverse',
    icon: 'lock',
  },
}
