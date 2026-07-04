import { useId } from 'react'

/**
 * The clusterfuck mark: three interwoven Syncthing-style hub-and-spoke
 * glyphs on the Syncthing blue gradient, one shared ring. Kept in sync by
 * hand with public/logo.svg (the favicon/docs copy of the same drawing).
 */
export function Logo({ size = 28 }: { size?: number }) {
  const gradientId = useId()

  // Each layer is its own rotation + slight scale about the center AND its own
  // hub position, so the three center nodes and their spokes land at different
  // spots — the copies read as jumbled/interwoven, not a stack of one glyph.
  const layer = (
    rot: number,
    scale: number,
    opacity: number,
    stroke: number,
    satR: number,
    hubR: number,
    hubX: number,
    hubY: number,
  ) => (
    <g
      transform={`translate(32 32) rotate(${rot}) scale(${scale}) translate(-32 -32)`}
      fill="#fff"
      stroke="#fff"
      opacity={opacity}
      strokeWidth={stroke}
      strokeLinecap="round"
    >
      <line x1={hubX} y1={hubY} x2="53.26" y2="21.50" />
      <circle cx="53.26" cy="21.50" r={satR} stroke="none" />
      <line x1={hubX} y1={hubY} x2="47.20" y2="50.10" />
      <circle cx="47.20" cy="50.10" r={satR} stroke="none" />
      <line x1={hubX} y1={hubY} x2="9.06" y2="37.71" />
      <circle cx="9.06" cy="37.71" r={satR} stroke="none" />
      <circle cx={hubX} cy={hubY} r={hubR} stroke="none" />
    </g>
  )

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="clusterfuck logo">
      <defs>
        <linearGradient id={gradientId} x1="32" y1="64" x2="32" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0882C8" />
          <stop offset="1" stopColor="#26B6DB" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill={`url(#${gradientId})`} />
      <circle cx="32" cy="32" r="23.85" fill="none" stroke="#fff" strokeWidth="3.27" />
      {layer(112, 0.91, 0.6, 2.5, 3.5, 3.7, 40.83, 31.64)}
      {layer(250, 0.96, 0.8, 2.8, 4.1, 4.3, 33.33, 32.64)}
      {layer(6, 1, 1, 3.27, 5.0, 5.1, 37.83, 38.64)}
    </svg>
  )
}
