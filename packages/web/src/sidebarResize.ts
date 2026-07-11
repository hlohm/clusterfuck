/**
 * Window-level drag tracking for the detail-sidebar resizer, kept out of
 * App.tsx so the listener lifecycle is unit-testable. The listeners detach
 * on pointerup *and* pointercancel — a cancelled pointer (touch interrupted
 * by a scroll gesture, browser takeover) otherwise leaves the move handler
 * attached forever, resizing the sidebar with every later pointer movement.
 */

/** Wide enough for the share editors, never wider than half a typical screen. */
export function clampSidebarWidth(width: number): number {
  return Math.min(640, Math.max(260, Math.round(width)))
}

export function startSidebarDrag(
  startX: number,
  startWidth: number,
  onWidth: (width: number) => void,
  onDone: (width: number) => void,
): void {
  let latest = startWidth
  const onMove = (move: PointerEvent) => {
    // The sidebar sits right of the divider, so dragging left widens it.
    latest = clampSidebarWidth(startWidth + (startX - move.clientX))
    onWidth(latest)
  }
  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    onDone(latest)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
