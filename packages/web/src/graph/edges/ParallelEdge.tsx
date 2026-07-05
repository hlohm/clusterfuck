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

/**
 * Local frame: the triangle's tip sits at (0,0) — the exact center of this
 * symmetric viewBox — so translating the wrapper div to a point and rotating
 * it (both around its own center, i.e. the tip) lands the tip precisely on
 * that point pointing in the given direction. Rendered through
 * EdgeLabelRenderer (an HTML overlay, not the SVG edges layer) because plain
 * SVG markers drawn in the edge path render *behind* nodes by default — a
 * device node is a good 120px+ wide pill, easily covering an inset drawn a
 * few px off the node center, so the arrow/lock must be in the layer that
 * sits above nodes, not just moved further away and hoped to clear it.
 */
function Arrowhead({ x, y, angleDeg, color }: { x: number; y: number; angleDeg: number; color?: string }) {
  return (
    <div
      className="parallel-edge__arrow"
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${angleDeg}deg)` }}
    >
      <svg width="20" height="14" viewBox="-13 -7 26 14">
        <polygon points="-10,-6.5 0,0 -10,6.5" fill={color ?? 'currentColor'} />
      </svg>
    </div>
  )
}

/**
 * A straight edge shifted perpendicular to the line between its endpoints,
 * so the k folders shared by a device pair render as k distinct parallel
 * lines — countable at a glance, never overlapping (unlike curvature
 * fan-outs, which still converge at the endpoints). Also carries the
 * per-endpoint share-mode encoding (arrowheads + lock badges + dash), inset
 * from the actual device nodes and rendered in the above-nodes overlay layer
 * so they stay visible instead of disappearing under the node shape.
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
  // never let the arrow/lock pair collide with each other or the far end.
  // The caps are generous — a device node is a ~120px+ wide pill, so an
  // inset has to clear roughly its half-width, not just look "not touching
  // the center point", or it renders on top of the node's own label text.
  const arrowInset = Math.min(46, length * 0.3)
  const lockInset = Math.min(72, length * 0.45)
  const angleToTarget = (Math.atan2(dy, dx) * 180) / Math.PI

  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${x1},${y1} L ${x2},${y2}`}
        style={{ ...style, strokeDasharray: dashed ? '6 4' : style?.strokeDasharray }}
      />
      {(label || arrowAtSource || arrowAtTarget || lockAtSource || lockAtTarget) && (
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
