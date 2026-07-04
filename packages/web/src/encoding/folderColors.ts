import type { FolderId } from '@clusterfuck/shared'
import type { ThemedColor } from './colors'

/**
 * Identity colors for folders in the "Nodes" graph mode, where each folder
 * becomes a set of same-colored edges between the devices sharing it.
 *
 * Validated 8-slot categorical palette (light: worst adjacent CVD ΔE 24.2;
 * dark steps validated as a set against the dark surface). Slots are
 * assigned in fixed order to folder ids sorted alphabetically, so a folder
 * keeps its color regardless of model ordering. Some light-mode slots sit
 * below 3:1 contrast — relieved by the legend, edge labels on selection,
 * and the table view.
 */
const CATEGORICAL: ThemedColor[] = [
  { light: '#2a78d6', dark: '#3987e5' },
  { light: '#1baf7a', dark: '#199e70' },
  { light: '#eda100', dark: '#c98500' },
  { light: '#008300', dark: '#008300' },
  { light: '#4a3aa7', dark: '#9085e9' },
  { light: '#e34948', dark: '#e66767' },
  { light: '#e87ba4', dark: '#d55181' },
  { light: '#eb6834', dark: '#d95926' },
]

/** Past 8 folders the tail goes neutral — never generate a 9th hue. */
const OVERFLOW: ThemedColor = { light: '#6b7280', dark: '#9aa1ac' }

export function folderColorMap(folderIds: FolderId[]): Map<FolderId, ThemedColor> {
  const sorted = [...folderIds].sort()
  return new Map(sorted.map((id, index) => [id, CATEGORICAL[index] ?? OVERFLOW]))
}
