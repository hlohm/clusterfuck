import { useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { GraphAdapterProps } from './GraphAdapter'
import { deviceNodeId, folderNodeId } from './GraphAdapter'
import { DeviceNode, type DeviceNodeData } from '../nodes/DeviceNode'
import { FolderNode, type FolderNodeData } from '../nodes/FolderNode'
import { folderHealthForDevice } from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE, type ArrowDirection } from '../../encoding/folderTypeStyle'

const nodeTypes = { device: DeviceNode, folder: FolderNode }

const FOLDER_ROW_Y = 40
const DEVICE_ROW_Y = 260
const COLUMN_WIDTH = 220

function markersFor(direction: ArrowDirection) {
  const arrow = { type: MarkerType.ArrowClosed }
  if (direction === 'forward') return { markerStart: arrow }
  if (direction === 'reverse') return { markerEnd: arrow }
  return { markerStart: arrow, markerEnd: arrow }
}

function ReactFlowAdapterInner({ cluster, selection, onSelect }: GraphAdapterProps) {
  const { nodes, edges } = useMemo(() => {
    const folderNodes: Node[] = cluster.folders.map((folder, index) => {
      const isSelected = selection?.kind === 'folder' && selection.folderId === folder.id
      const data: FolderNodeData = { folder, isSelected }
      return {
        id: folderNodeId(folder.id),
        type: 'folder',
        position: { x: index * COLUMN_WIDTH + 80, y: FOLDER_ROW_Y },
        data,
        draggable: false,
      }
    })

    const deviceNodes: Node[] = cluster.devices.map((device, index) => {
      const isSelected = selection?.kind === 'device' && selection.deviceId === device.id
      const data: DeviceNodeData = {
        device,
        health: folderHealthForDevice(cluster, device.id),
        isSelected,
      }
      return {
        id: deviceNodeId(device.id),
        type: 'device',
        position: { x: index * COLUMN_WIDTH + 80, y: DEVICE_ROW_Y },
        data,
        draggable: false,
      }
    })

    const shareEdges: Edge[] = cluster.shares.map((share) => {
      const style = FOLDER_TYPE_STYLE[share.type]
      const isSelected =
        selection?.kind === 'share' &&
        selection.folderId === share.folderId &&
        selection.deviceId === share.deviceId

      return {
        id: `share:${share.folderId}:${share.deviceId}`,
        source: folderNodeId(share.folderId),
        target: deviceNodeId(share.deviceId),
        style: {
          stroke: style.color.light,
          strokeWidth: isSelected ? 3 : 1.5,
          strokeDasharray: style.dash === 'dashed' ? '6 4' : undefined,
        },
        label: isSelected ? style.label : undefined,
        ...markersFor(style.arrow),
      }
    })

    return { nodes: [...folderNodes, ...deviceNodes], edges: shareEdges }
  }, [cluster, selection])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      panOnScroll
      fitView
      onNodeClick={(_event, node) => {
        if (node.type === 'device') {
          const device = (node.data as DeviceNodeData).device
          onSelect({ kind: 'device', deviceId: device.id })
        } else if (node.type === 'folder') {
          const folder = (node.data as FolderNodeData).folder
          onSelect({ kind: 'folder', folderId: folder.id })
        }
      }}
      onEdgeClick={(_event, edge) => {
        const share = cluster.shares.find(
          (s) => `share:${s.folderId}:${s.deviceId}` === edge.id,
        )
        if (share) onSelect({ kind: 'share', folderId: share.folderId, deviceId: share.deviceId })
      }}
      onPaneClick={() => onSelect(null)}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export function ReactFlowAdapter(props: GraphAdapterProps) {
  return (
    <ReactFlowProvider>
      <ReactFlowAdapterInner {...props} />
    </ReactFlowProvider>
  )
}
