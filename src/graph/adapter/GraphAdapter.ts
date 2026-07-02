import type { ComponentType } from 'react'
import type { ClusterModel } from '../../model/types'
import type { Selection } from '../selection'

export interface GraphAdapterProps {
  cluster: ClusterModel
  selection: Selection
  onSelect: (selection: Selection) => void
}

/**
 * Every graph-library-specific integration lives behind this seam. The
 * library choice (React Flow today) is a flagged, revisitable decision —
 * model, fixtures, encoding, legend, and detail panel are all library-agnostic
 * and only ever talk to this interface.
 */
export type GraphAdapter = ComponentType<GraphAdapterProps>

/** Node id helpers, shared by adapters so ids are consistent across the graph. */
export const deviceNodeId = (deviceId: string): string => `device:${deviceId}`
export const folderNodeId = (folderId: string): string => `folder:${folderId}`
