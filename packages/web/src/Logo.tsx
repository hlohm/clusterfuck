import { useId } from 'react'

/**
 * The clusterfuck mark: three interwoven Syncthing-style hub-and-spoke
 * glyphs on the Syncthing blue gradient, one shared ring. Kept in sync by
 * hand with public/logo.svg (the favicon/docs copy of the same drawing).
 */
export function Logo({ size = 28 }: { size?: number }) {
  const gradientId = useId()

  // Each layer is its own rotation + slight scale about the center (not a pure
  // 120° copy), so the nodes and spokes sit at different positions/angles
  // between layers instead of stacking — the interweaving reads clearly.
  const layer = (
    rot: number,
    scale: number,
    opacity: number,
    stroke: number,
    satR: number,
    hubR: number,
  ) => (
    <g
      transform={`translate(32 32) rotate(${rot}) scale(${scale}) translate(-32 -32)`}
      fill="#fff"
      stroke="#fff"
      opacity={opacity}
      strokeWidth={stroke}
      strokeLinecap="round"
    >
      <line x1="36.83" y1="35.14" x2="53.26" y2="21.50" />
      <circle cx="53.26" cy="21.50" r={satR} stroke="none" />
      <line x1="36.83" y1="35.14" x2="47.20" y2="50.10" />
      <circle cx="47.20" cy="50.10" r={satR} stroke="none" />
      <line x1="36.83" y1="35.14" x2="9.06" y2="37.71" />
      <circle cx="9.06" cy="37.71" r={satR} stroke="none" />
      <circle cx="36.83" cy="35.14" r={hubR} stroke="none" />
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
      {layer(126, 0.93, 0.62, 2.6, 3.6, 3.8)}
      {layer(242, 0.97, 0.82, 2.9, 4.2, 4.4)}
      {layer(2, 1, 1, 3.27, 5.0, 5.1)}
    </svg>
  )
}
