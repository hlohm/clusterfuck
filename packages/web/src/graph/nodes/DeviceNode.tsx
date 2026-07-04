import { Handle, Position, type NodeProps } from '@xyflow/react'
import { DEVICE_STATE_STYLE } from '../../encoding/deviceStateStyle'
import { FOLDER_STATE_STYLE } from '../../encoding/folderStateStyle'
import type { Device, FolderState } from '@clusterfuck/shared'

export interface DeviceNodeData extends Record<string, unknown> {
  device: Device
  health?: FolderState
  isSelected: boolean
}

export function DeviceNode({ data }: NodeProps & { data: DeviceNodeData }) {
  const { device, health, isSelected } = data
  const style = DEVICE_STATE_STYLE[device.state]
  const healthStyle = health ? FOLDER_STATE_STYLE[health] : undefined

  return (
    <div
      className="device-node"
      data-selected={isSelected}
      style={{
        borderStyle: style.outline,
        borderColor: isSelected ? 'var(--accent)' : style.accent.light,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
      <div className="device-node__name">{device.name}</div>
      <div className="device-node__meta">
        <span className="device-node__badge" title={style.label}>
          {style.label}
        </span>
        {healthStyle && (
          <span
            className="device-node__health"
            style={{ color: healthStyle.color.light }}
            title={`Worst folder state: ${healthStyle.label}`}
          >
            {healthStyle.label}
          </span>
        )}
      </div>
    </div>
  )
}
