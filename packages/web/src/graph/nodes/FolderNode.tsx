import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Folder } from '@clusterfuck/shared'

export interface FolderNodeData extends Record<string, unknown> {
  folder: Folder
  isSelected: boolean
}

/** The folder "hub" node a share's device-spokes connect to (hyperedge model). */
export function FolderNode({ data }: NodeProps & { data: FolderNodeData }) {
  const { folder, isSelected } = data

  return (
    <div className="folder-node" data-selected={isSelected}>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="folder-node__label">{folder.label}</div>
    </div>
  )
}
