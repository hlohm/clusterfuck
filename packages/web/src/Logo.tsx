import { useId } from 'react'

/**
 * The clusterfuck mark: three interwoven Syncthing-style hub-and-spoke
 * glyphs on the Syncthing blue gradient, one shared ring. Kept in sync by
 * hand with public/logo.svg (the favicon/docs copy of the same drawing).
 */
export function Logo({ size = 28 }: { size?: number }) {
  const gradientId = useId()

  const glyph = (opacity: number, stroke: number, satR: number, hubR: number) => (
    <g fill="#fff" stroke="#fff" opacity={opacity} strokeWidth={stroke} strokeLinecap="round">
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
      <g transform="rotate(120 32 32)">{glyph(0.28, 2.2, 3.4, 3.6)}</g>
      <g transform="rotate(240 32 32)">{glyph(0.5, 2.6, 3.9, 4.1)}</g>
      {glyph(1.0, 3.27, 5.0, 5.1)}
    </svg>
  )
}
