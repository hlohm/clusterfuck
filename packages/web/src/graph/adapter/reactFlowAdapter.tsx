import { useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  Panel,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { GraphAdapterProps, GraphMode } from './GraphAdapter'
import { deviceNodeId, folderNodeId } from './GraphAdapter'
import { DeviceNode, type DeviceNodeData } from '../nodes/DeviceNode'
import { FolderNode, type FolderNodeData } from '../nodes/FolderNode'
import { ParallelEdge } from '../edges/ParallelEdge'
import { folderHealthForDevice, sharesByFolder, type ClusterModel } from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE, type ArrowDirection } from '../../encoding/folderTypeStyle'
import { folderColorMap } from '../../encoding/folderColors'
import { cssColor } from '../../encoding/colors'
import type { Selection } from '../selection'

const nodeTypes = { device: DeviceNode, folder: FolderNode }
const edgeTypes = { parallel: ParallelEdge }

const FOLDER_ROW_Y = 40
const DEVICE_ROW_Y = 260
const COLUMN_WIDTH = 220

function markersFor(direction: ArrowDirection) {
  const arrow = { type: MarkerType.ArrowClosed }
  if (direction === 'forward') return { markerStart: arrow }
  if (direction === 'reverse') return { markerEnd: arrow }
  return { markerStart: arrow, markerEnd: arrow }
}

function deviceNodesFor(
  cluster: ClusterModel,
  selection: Selection,
  positionFor: (index: number) => { x: number; y: number },
): Node[] {
  return cluster.devices.map((device, index) => {
    const isSelected = selection?.kind === 'device' && selection.deviceId === device.id
    const data: DeviceNodeData = {
      device,
      health: folderHealthForDevice(cluster, device.id),
      isSelected,
    }
    return {
      id: deviceNodeId(device.id),
      type: 'device',
      position: positionFor(index),
      data,
      draggable: false,
    }
  })
}

/** folders: folders as hub nodes, one edge per share, colored by folder type. */
function foldersGraph(cluster: ClusterModel, selection: Selection) {
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

  const deviceNodes = deviceNodesFor(cluster, selection, (index) => ({
    x: index * COLUMN_WIDTH + 80,
    y: DEVICE_ROW_Y,
  }))

  const edges: Edge[] = cluster.shares.map((share) => {
    const style = FOLDER_TYPE_STYLE[share.type]
    const isSelected =
      selection?.kind === 'share' &&
      selection.folderId === share.folderId &&
      selection.deviceId === share.deviceId

    return {
      id: `share:${share.folderId}:${share.deviceId}`,
      source: folderNodeId(share.folderId),
      target: deviceNodeId(share.deviceId),
      targetHandle: 'top-in',
      style: {
        stroke: cssColor(style.color),
        strokeWidth: isSelected ? 3 : 1.5,
        strokeDasharray: style.dash === 'dashed' ? '6 4' : undefined,
      },
      label: isSelected ? style.label : undefined,
      ...markersFor(style.arrow),
    }
  })

  return { nodes: [...folderNodes, ...deviceNodes], edges }
}

/** Gap between parallel lines of the same device pair. */
const PARALLEL_SPACING = 7

/**
 * nodes: devices only, on a circle. Each folder becomes pairwise edges among
 * the devices sharing it, colored by folder identity. The k folders a pair
 * shares render as k straight parallel lines (perpendicular offsets centered
 * on the pair's axis, node-center to node-center) so they never overlap and
 * stay countable.
 */
function nodesGraph(cluster: ClusterModel, selection: Selection) {
  const count = cluster.devices.length
  const radius = Math.max(220, (count * 240) / (2 * Math.PI))
  const nodes = deviceNodesFor(cluster, selection, (index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(count, 1)
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
  })

  const colors = folderColorMap(cluster.folders.map((f) => f.id))

  // Pass 1: group the folders each device pair shares, in stable folder order.
  const pairFolders = new Map<string, { a: string; b: string; folderIds: string[] }>()
  for (const folder of cluster.folders) {
    const members = sharesByFolder(cluster, folder.id).map((s) => s.deviceId)
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, b] = [members[i]!, members[j]!].sort() as [string, string]
        const key = `${a}|${b}`
        const entry = pairFolders.get(key) ?? { a, b, folderIds: [] }
        entry.folderIds.push(folder.id)
        pairFolders.set(key, entry)
      }
    }
  }

  // Pass 2: one parallel line per (pair, folder), offsets centered on the axis.
  const folderLabelById = new Map(cluster.folders.map((f) => [f.id, f.label]))
  const labeledFolders = new Set<string>()
  const edges: Edge[] = []

  for (const { a, b, folderIds } of pairFolders.values()) {
    folderIds.forEach((folderId, index) => {
      const color = colors.get(folderId)
      // A folder selection highlights every pair sharing it; a share
      // selection names one device's participation, so only pairs that
      // actually include that device should light up.
      const isSelected =
        selection?.kind === 'folder'
          ? selection.folderId === folderId
          : selection?.kind === 'share'
            ? selection.folderId === folderId && (a === selection.deviceId || b === selection.deviceId)
            : false
      const showLabel = isSelected && !labeledFolders.has(folderId)
      if (showLabel) labeledFolders.add(folderId)

      edges.push({
        id: `nodes-edge:${folderId}:${a}:${b}`,
        source: deviceNodeId(a),
        target: deviceNodeId(b),
        sourceHandle: 'center-out',
        targetHandle: 'center-in',
        type: 'parallel',
        data: {
          offset: (index - (folderIds.length - 1) / 2) * PARALLEL_SPACING,
          label: showLabel ? folderLabelById.get(folderId) : undefined,
        },
        style: {
          stroke: color ? cssColor(color) : undefined,
          strokeWidth: isSelected ? 3 : 1.5,
        },
      })
    })
  }

  return { nodes, edges }
}

function ReactFlowAdapterInner({
  cluster,
  selection,
  onSelect,
  mode,
  onModeChange,
}: GraphAdapterProps) {
  const { nodes, edges } = useMemo(
    () => (mode === 'folders' ? foldersGraph(cluster, selection) : nodesGraph(cluster, selection)),
    [cluster, selection, mode],
  )

  return (
    <ReactFlow
      key={mode}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
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
        if (edge.id.startsWith('nodes-edge:')) {
          const folderId = edge.id.split(':')[1]!
          onSelect({ kind: 'folder', folderId })
          return
        }
        const share = cluster.shares.find(
          (s) => `share:${s.folderId}:${s.deviceId}` === edge.id,
        )
        if (share) onSelect({ kind: 'share', folderId: share.folderId, deviceId: share.deviceId })
      }}
      onPaneClick={() => onSelect(null)}
    >
      <Panel position="top-left" className="graph-mode">
        {(
          [
            ['nodes', 'Nodes'],
            ['folders', 'Folders'],
          ] as [GraphMode, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className="graph-mode__option"
            data-active={mode === id}
            onClick={() => onModeChange(id)}
          >
            {label}
          </button>
        ))}
      </Panel>
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
