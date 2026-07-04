import type { FolderState } from '@clusterfuck/shared'
import { FOLDER_STATE_STYLE } from '../encoding/folderStateStyle'
import { cssColor } from '../encoding/colors'

/**
 * Status is never color alone: a colored dot carries the state beside a text
 * label that stays in text tokens.
 */
export function StatusBadge({ state }: { state: FolderState }) {
  const style = FOLDER_STATE_STYLE[state]
  return (
    <span className="status-badge">
      <span className="status-badge__dot" style={{ backgroundColor: cssColor(style.color) }} />
      {style.label}
    </span>
  )
}
