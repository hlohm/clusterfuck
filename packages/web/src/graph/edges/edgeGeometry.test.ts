import { describe, expect, it } from 'vitest'
import { exitDistance } from './edgeGeometry'

describe('exitDistance', () => {
  it('exits through the far side, straight down the width axis, starting from dead center', () => {
    // A 200x100 box (half-extents 100x50), ray from center going in +x.
    expect(exitDistance(0, 0, 1, 0, 100, 50)).toBeCloseTo(100)
  })

  // Regression test: a naive center-based distance would return the same
  // value regardless of the ray's actual starting point, which is exactly
  // wrong for a device pair's k-1 non-central parallel lines (every folder
  // beyond the first is offset from the pair's centerline). A ray starting
  // near the box's top edge should exit MUCH sooner than one starting dead
  // center, along the identical direction — proving the distance genuinely
  // depends on the offset starting point, not just the direction.
  it('exits sooner for a ray starting near an edge than the same ray from dead center', () => {
    const halfWidth = 100
    const halfHeight = 50
    const dir = Math.SQRT1_2 // 45 degrees: ux = uy = 1/sqrt(2)

    const fromCenter = exitDistance(0, 0, dir, dir, halfWidth, halfHeight)
    const fromNearTopEdge = exitDistance(0, 40, dir, dir, halfWidth, halfHeight)

    expect(fromNearTopEdge).toBeLessThan(fromCenter)
    // From y=40, only 10px of headroom before the top edge (y=50): exits
    // via the y-axis slab at t = (50 - 40) / dir.
    expect(fromNearTopEdge).toBeCloseTo(10 / dir)
    // From dead center, 50px of headroom: exits via the y-axis slab too,
    // since the box is wider than it is tall, at t = 50 / dir.
    expect(fromCenter).toBeCloseTo(50 / dir)
  })

  it('clamps to zero instead of going negative when the starting point is already outside', () => {
    // Starting above the top edge (py=60 > halfHeight=50) and moving further
    // up (uy=1, away from the box): the y-slab distance is genuinely
    // negative (-10), which must clamp to 0 rather than propagate as a
    // negative "exit distance" a caller would misread as a valid inset.
    expect(exitDistance(0, 60, 0, 1, 100, 50)).toBe(0)
  })

  it('treats a purely perpendicular ray (no component on one axis) as never exiting on that axis', () => {
    // Straight up (uy=-1, ux=0) inside a box whose top boundary is far away
    // vertically — the x-axis slab must not spuriously constrain it via an
    // Infinity/0 division artifact.
    expect(exitDistance(0, 0, 0, -1, 100, 50)).toBeCloseTo(50)
  })
})
