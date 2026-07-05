import { useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, Panel } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { GraphAdapterProps, GraphMode } from './GraphAdapter'
import { DeviceNode, type DeviceNodeData } from '../nodes/DeviceNode'
import { FolderNode, type FolderNodeData } from '../nodes/FolderNode'
import { ParallelEdge } from '../edges/ParallelEdge'
import { foldersGraph, nodesGraph } from './graphLayout'

const nodeTypes = { device: DeviceNode, folder: FolderNode }
const edgeTypes = { parallel: ParallelEdge }

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
