import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps } from '@xyflow/react'
import { exitDistance, FALLBACK_NODE_HEIGHT, FALLBACK_NODE_WIDTH } from './edgeGeometry'

export interface ParallelEdgeData extends Record<string, unknown> {
  /** The folder this line represents — used by click handling (parsing it out of the edge id would break on folder ids containing ':'). */
  folderId?: string
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
 * that point pointing in the given direction.
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
 * per-endpoint share-mode encoding (arrowheads + lock badges + dash). The
 * arrow tip lands exactly on the device node's own rendered boundary (via
 * React Flow's measured node size), with the lock a bit further out toward
 * the middle — both sit entirely in the open space between the two nodes,
 * so the node can render on top as normal without hiding either of them.
 */
export function ParallelEdge({
  id,
  source,
  target,
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
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

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

  // Cap at 45% of the line's own length each, so on a very short edge
  // (nearby devices) the two ends' arrows/locks can't overshoot past each
  // other or the opposite node.
  const cap = length * 0.45
  // (ox, oy) is this specific parallel line's start point relative to each
  // node's own center — the same for both ends, since the offset is applied
  // uniformly. From the target's side, the line arrives travelling in
  // (ux, uy), so its own exit point (looking backwards, out of the node) is
  // computed with the direction reversed.
  const sourceBoundary = Math.min(
    cap,
    exitDistance(
      ox,
      oy,
      ux,
      uy,
      (sourceNode?.measured.width ?? FALLBACK_NODE_WIDTH) / 2,
      (sourceNode?.measured.height ?? FALLBACK_NODE_HEIGHT) / 2,
    ),
  )
  const targetBoundary = Math.min(
    cap,
    exitDistance(
      ox,
      oy,
      -ux,
      -uy,
      (targetNode?.measured.width ?? FALLBACK_NODE_WIDTH) / 2,
      (targetNode?.measured.height ?? FALLBACK_NODE_HEIGHT) / 2,
    ),
  )
  const lockGap = 22
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
              x={x1 + ux * sourceBoundary}
              y={y1 + uy * sourceBoundary}
              angleDeg={angleToTarget + 180}
              color={style?.stroke as string | undefined}
            />
          )}
          {arrowAtTarget && (
            <Arrowhead
              x={x2 - ux * targetBoundary}
              y={y2 - uy * targetBoundary}
              angleDeg={angleToTarget}
              color={style?.stroke as string | undefined}
            />
          )}
          {lockAtSource && (
            <div
              className="parallel-edge__lock"
              style={{
                transform: `translate(-50%, -50%) translate(${x1 + ux * Math.min(cap, sourceBoundary + lockGap)}px, ${y1 + uy * Math.min(cap, sourceBoundary + lockGap)}px)`,
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
                transform: `translate(-50%, -50%) translate(${x2 - ux * Math.min(cap, targetBoundary + lockGap)}px, ${y2 - uy * Math.min(cap, targetBoundary + lockGap)}px)`,
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
