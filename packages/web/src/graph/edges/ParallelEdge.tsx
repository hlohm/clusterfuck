import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

export interface ParallelEdgeData extends Record<string, unknown> {
  /** Perpendicular offset in px from the pair's centerline. */
  offset: number
  label?: string
}

/**
 * A straight edge shifted perpendicular to the line between its endpoints,
 * so the k folders shared by a device pair render as k distinct parallel
 * lines — countable at a glance, never overlapping (unlike curvature
 * fan-outs, which still converge at the endpoints).
 */
export function ParallelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
}: EdgeProps) {
  const { offset, label } = (data ?? { offset: 0 }) as ParallelEdgeData
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const length = Math.hypot(dx, dy) || 1
  const ox = (-dy / length) * offset
  const oy = (dx / length) * offset

  const x1 = sourceX + ox
  const y1 = sourceY + oy
  const x2 = targetX + ox
  const y2 = targetY + oy

  return (
    <>
      <BaseEdge id={id} path={`M ${x1},${y1} L ${x2},${y2}`} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="parallel-edge__label"
            style={{
              transform: `translate(-50%, -50%) translate(${(x1 + x2) / 2}px, ${(y1 + y2) / 2}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
