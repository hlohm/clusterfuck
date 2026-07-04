import { Handle, Position, type NodeProps } from '@xyflow/react'
import { DEVICE_STATE_STYLE } from '../../encoding/deviceStateStyle'
import { FOLDER_STATE_STYLE } from '../../encoding/folderStateStyle'
import { cssColor } from '../../encoding/colors'
import type { Device, FolderState } from '@clusterfuck/shared'

export interface DeviceNodeData extends Record<string, unknown> {
  device: Device
  health?: FolderState
  isSelected: boolean
}

const CENTER_HANDLE = {
  opacity: 0,
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
} as const

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
        borderColor: isSelected ? 'var(--accent)' : cssColor(style.accent),
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
      {/* Centered handles for mesh-mode edges: lines run node-center to
          node-center so parallel offsets stay parallel from end to end. */}
      <Handle id="center-in" type="target" position={Position.Top} style={CENTER_HANDLE} />
      <Handle id="center-out" type="source" position={Position.Top} style={CENTER_HANDLE} />
      <div className="device-node__name">{device.name}</div>
      <div className="device-node__meta">
        <span className="device-node__badge" title={style.label}>
          {style.label}
        </span>
        {healthStyle && (
          <span
            className="device-node__health"
            style={{ color: cssColor(healthStyle.color) }}
            title={`Worst folder state: ${healthStyle.label}`}
          >
            {healthStyle.label}
          </span>
        )}
      </div>
    </div>
  )
}
