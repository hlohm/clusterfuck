import type { ReactNode } from 'react'

/**
 * The one shared frame every Overview section renders in (ROADMAP "UI design
 * refinement"): a header bar with a collapse toggle and move-up/down
 * controls, so collapsing and re-arranging work identically everywhere
 * instead of per-section one-offs. The parent owns the layout state.
 */
export function OverviewSection({
  title,
  collapsed,
  canMoveUp,
  canMoveDown,
  onToggle,
  onMove,
  children,
}: {
  title: string
  collapsed: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onToggle: () => void
  onMove: (direction: -1 | 1) => void
  children: ReactNode
}) {
  return (
    <section className="overview__section">
      <div className="overview-section__bar">
        <button className="overview-section__toggle" aria-expanded={!collapsed} onClick={onToggle}>
          <span className="overview-section__chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <h3>{title}</h3>
        </button>
        <div className="overview-section__move">
          <button
            className="overview-section__move-button"
            aria-label={`Move ${title} up`}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            className="overview-section__move-button"
            aria-label={`Move ${title} down`}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
        </div>
      </div>
      {!collapsed && children}
    </section>
  )
}
