import { describe, expect, it, vi } from 'vitest'
import { clampSidebarWidth, startSidebarDrag } from './sidebarResize'

/** jsdom has no PointerEvent constructor; a plain Event with clientX works. */
function pointer(type: string, clientX: number): Event {
  return Object.assign(new Event(type), { clientX })
}

describe('clampSidebarWidth', () => {
  it('rounds and clamps into [260, 640]', () => {
    expect(clampSidebarWidth(300.4)).toBe(300)
    expect(clampSidebarWidth(10)).toBe(260)
    expect(clampSidebarWidth(10_000)).toBe(640)
  })
})

describe('startSidebarDrag', () => {
  it('widens on leftward moves and finishes on pointerup', () => {
    const onWidth = vi.fn()
    const onDone = vi.fn()
    startSidebarDrag(500, 300, onWidth, onDone)

    window.dispatchEvent(pointer('pointermove', 480))
    expect(onWidth).toHaveBeenLastCalledWith(320)

    window.dispatchEvent(pointer('pointerup', 480))
    expect(onDone).toHaveBeenCalledWith(320)

    // The drag is over: further moves must not resize.
    window.dispatchEvent(pointer('pointermove', 100))
    expect(onWidth).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('detaches on pointercancel too, not only pointerup', () => {
    const onWidth = vi.fn()
    const onDone = vi.fn()
    startSidebarDrag(500, 300, onWidth, onDone)

    window.dispatchEvent(pointer('pointermove', 460))
    expect(onWidth).toHaveBeenLastCalledWith(340)

    // A touch drag interrupted by a scroll gesture fires pointercancel and
    // never pointerup — the listeners must still come off.
    window.dispatchEvent(new Event('pointercancel'))
    expect(onDone).toHaveBeenCalledWith(340)

    window.dispatchEvent(pointer('pointermove', 100))
    window.dispatchEvent(pointer('pointerup', 100))
    expect(onWidth).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
