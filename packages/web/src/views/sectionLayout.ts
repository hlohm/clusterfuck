/**
 * Pure logic for the Overview's user-arrangeable section layout (ROADMAP
 * "UI design refinement"): which sections are collapsed and in what order
 * they render, persisted per browser via localPrefs. Kept React-free so the
 * merge-with-defaults and move semantics are unit-testable.
 */

export interface SectionLayout {
  order: string[]
  collapsed: string[]
}

export const EMPTY_LAYOUT: SectionLayout = { order: [], collapsed: [] }

/**
 * Reconciles a saved order with the app's current section list: saved ids
 * that no longer exist are dropped, and sections the saved layout doesn't
 * know (added in a newer build) slot in at their default position relative
 * to the sections around them — not dumped at the end — so an upgrade
 * doesn't shuffle the layout.
 */
export function normalizeOrder(saved: string[], defaults: string[]): string[] {
  const known = new Set(defaults)
  const kept = saved.filter((id) => known.has(id))
  const placed = new Set(kept)
  const result = [...kept]
  for (const id of defaults) {
    if (placed.has(id)) continue
    // Insert after the nearest already-placed default predecessor.
    const defaultIndex = defaults.indexOf(id)
    let insertAt = 0
    for (let i = defaultIndex - 1; i >= 0; i--) {
      const at = result.indexOf(defaults[i]!)
      if (at !== -1) {
        insertAt = at + 1
        break
      }
    }
    result.splice(insertAt, 0, id)
    placed.add(id)
  }
  return result
}

/**
 * Moves `id` one step up (-1) or down (+1) **among the currently visible
 * sections**: empty sections keep their slot in the full order but are
 * skipped over, so a move never looks like a no-op. Returns the input
 * unchanged when the move is out of bounds.
 */
export function moveSection(
  order: string[],
  id: string,
  direction: -1 | 1,
  visibleIds: readonly string[],
): string[] {
  const from = order.indexOf(id)
  if (from === -1) return order
  const visible = new Set(visibleIds)
  let to = from + direction
  while (to >= 0 && to < order.length && !visible.has(order[to]!)) to += direction
  if (to < 0 || to >= order.length) return order
  const next = [...order]
  next.splice(from, 1)
  // After the removal, inserting at `to` lands past the skipped-over
  // neighbor when moving down, and before it when moving up — both correct.
  next.splice(to, 0, id)
  return next
}

export function toggleCollapsed(collapsed: string[], id: string): string[] {
  return collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]
}
