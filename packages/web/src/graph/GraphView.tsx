import { ReactFlowAdapter } from './adapter/reactFlowAdapter'
import type { GraphAdapterProps } from './adapter/GraphAdapter'

/**
 * Library-agnostic entry point for the graph. Swapping the graph library
 * later means changing this one import, not any caller.
 */
export function GraphView(props: GraphAdapterProps) {
  return <ReactFlowAdapter {...props} />
}
