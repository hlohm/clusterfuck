import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

export interface ParallelEdgeData extends Record<string, unknown> {
  /** Perpendicular offset in px from the pair's centerline. */
  offset: number
  label?: string
  /** Share-mode encoding: an arrowhead at an end means that device receives updates via this folder. */
  arrowAtSource?: boolean
  arrowAtTarget?: boolean
  /** That end's own copy of the folder is receiveencrypted — ciphertext only. */
  lockAtSource?: boolean
  lockAtTarget?: boolean
  /** At least one end is receiveencrypted — dashed, matching the Folders-mode encoding for the same type. */
  dashed?: boolean
}

/** Local-frame triangle (points toward +x), rotated/translated onto the line. */
function Arrowhead({ x, y, angleDeg, color }: { x: number; y: number; angleDeg: number; color?: string }) {
  return (
    <polygon
      points="-7,-4.5 0,0 -7,4.5"
      fill={color ?? 'currentColor'}
      transform={`translate(${x} ${y}) rotate(${angleDeg})`}
    />
  )
}

/**
 * A straight edge shifted perpendicular to the line between its endpoints,
 * so the k folders shared by a device pair render as k distinct parallel
 * lines — countable at a glance, never overlapping (unlike curvature
 * fan-outs, which still converge at the endpoints). Also carries the
 * per-endpoint share-mode encoding (arrowheads + lock badges + dash), inset
 * from the actual device nodes so they read as attached to an end without
 * touching/overlapping the node shape.
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
  const {
    offset,
    label,
    arrowAtSource,
    arrowAtTarget,
    lockAtSource,
    lockAtTarget,
    dashed,
  } = (data ?? { offset: 0 }) as ParallelEdgeData
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const ox = -uy * offset
  const oy = ux * offset

  const x1 = sourceX + ox
  const y1 = sourceY + oy
  const x2 = targetX + ox
  const y2 = targetY + oy

  // Insets scale with the line's own length so short edges (nearby devices)
  // never let the arrow/lock pair collide with each other or the far end —
  // capped so very long edges don't push them implausibly far from the node.
  const arrowInset = Math.min(18, length * 0.22)
  const lockInset = Math.min(34, length * 0.4)
  const angleToTarget = (Math.atan2(dy, dx) * 180) / Math.PI

  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${x1},${y1} L ${x2},${y2}`}
        style={{ ...style, strokeDasharray: dashed ? '6 4' : style?.strokeDasharray }}
      />
      {arrowAtSource && (
        <Arrowhead
          x={x1 + ux * arrowInset}
          y={y1 + uy * arrowInset}
          angleDeg={angleToTarget + 180}
          color={style?.stroke as string | undefined}
        />
      )}
      {arrowAtTarget && (
        <Arrowhead
          x={x2 - ux * arrowInset}
          y={y2 - uy * arrowInset}
          angleDeg={angleToTarget}
          color={style?.stroke as string | undefined}
        />
      )}
      {(label || lockAtSource || lockAtTarget) && (
        <EdgeLabelRenderer>
          {label && (
            <div
              className="parallel-edge__label"
              style={{
                transform: `translate(-50%, -50%) translate(${(x1 + x2) / 2}px, ${(y1 + y2) / 2}px)`,
              }}
            >
              {label}
            </div>
          )}
          {lockAtSource && (
            <div
              className="parallel-edge__lock"
              style={{
                transform: `translate(-50%, -50%) translate(${x1 + ux * lockInset}px, ${y1 + uy * lockInset}px)`,
              }}
              title="Receives encrypted (untrusted peer)"
            >
              🔒
            </div>
          )}
          {lockAtTarget && (
            <div
              className="parallel-edge__lock"
              style={{
                transform: `translate(-50%, -50%) translate(${x2 - ux * lockInset}px, ${y2 - uy * lockInset}px)`,
              }}
              title="Receives encrypted (untrusted peer)"
            >
              🔒
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  )
}
