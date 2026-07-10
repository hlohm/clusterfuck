import { beforeEach, describe, expect, it } from 'vitest'
import { loadPref, savePref } from './localPrefs'

beforeEach(() => window.localStorage.clear())

describe('localPrefs', () => {
  it('round-trips JSON values under a namespaced key', () => {
    savePref('sidebarWidth', 420)
    expect(loadPref('sidebarWidth', 300)).toBe(420)
    expect(window.localStorage.getItem('clusterfuck.sidebarWidth')).toBe('420')

    savePref('layout', { order: ['a', 'b'], collapsed: ['b'] })
    expect(loadPref('layout', { order: [], collapsed: [] })).toEqual({
      order: ['a', 'b'],
      collapsed: ['b'],
    })
  })

  it('returns the fallback for missing or corrupt values', () => {
    expect(loadPref('missing', 7)).toBe(7)

    window.localStorage.setItem('clusterfuck.corrupt', '{not json')
    expect(loadPref('corrupt', 'ok')).toBe('ok')
  })
})
