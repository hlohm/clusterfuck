/** Split out of ParallelEdge.tsx: mixing a plain function export with its component export breaks Fast Refresh. */

/** Device node's measured size before its first paint isn't available yet — this roughly matches .device-node's min-width/typical two-line height. */
export const FALLBACK_NODE_WIDTH = 120
export const FALLBACK_NODE_HEIGHT = 44

/**
 * Distance from a starting point (px, py, in the node's own local frame —
 * i.e. relative to its center) to the near edge of its rectangular boundary,
 * travelling in direction (ux, uy). An axis-aligned-box approximation of the
 * device node's actual (pill-shaped, rounded) footprint — close enough, the
 * rounding only shaves a couple of px off the corners.
 *
 * This has to take the starting point, not just assume the ray starts at
 * the node's dead center: parallel lines for a device pair sharing several
 * folders are perpendicular-offset copies of the same center-to-center
 * line, so only the *middle* one actually passes through either node's
 * center. Reusing a single center-based distance for every parallel line
 * makes them all exit at the same distance along the line — visually,
 * every arrow but the innermost one ends up floating off the node's real
 * edge, "lined up" with the canonical one instead of following the node's
 * actual (non-circular) boundary as the offset grows.
 */
export function exitDistance(
  px: number,
  py: number,
  ux: number,
  uy: number,
  halfWidth: number,
  halfHeight: number,
): number {
  const tx = ux !== 0 ? (ux > 0 ? (halfWidth - px) / ux : (-halfWidth - px) / ux) : Infinity
  const ty = uy !== 0 ? (uy > 0 ? (halfHeight - py) / uy : (-halfHeight - py) / uy) : Infinity
  return Math.max(0, Math.min(tx, ty))
}
