import { describe, expect, it } from 'vitest'
import { moveSection, normalizeOrder, pruneCollapsed, toggleCollapsed } from './sectionLayout'

describe('normalizeOrder', () => {
  it('keeps a saved order and drops ids that no longer exist', () => {
    expect(normalizeOrder(['c', 'a', 'gone', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
  })

  it('slots sections the saved layout does not know into their default position', () => {
    // 'new' sits between b and c by default; a user order of [c, a, b] should
    // get it after b (its default predecessor), not dumped at the end.
    expect(normalizeOrder(['c', 'a', 'b'], ['a', 'b', 'new', 'c'])).toEqual(['c', 'a', 'b', 'new'])
    // No saved layout at all -> the defaults.
    expect(normalizeOrder([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('moveSection', () => {
  const all = ['a', 'b', 'c', 'd'] as const

  it('swaps with the adjacent visible neighbor', () => {
    expect(moveSection(['a', 'b', 'c', 'd'], 'b', -1, all)).toEqual(['b', 'a', 'c', 'd'])
    expect(moveSection(['a', 'b', 'c', 'd'], 'b', 1, all)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('skips over invisible sections so a move never looks like a no-op', () => {
    // b is empty/hidden: moving a down must land past c, not swap with b.
    expect(moveSection(['a', 'b', 'c', 'd'], 'a', 1, ['a', 'c', 'd'])).toEqual(['b', 'c', 'a', 'd'])
    expect(moveSection(['a', 'b', 'c', 'd'], 'c', -1, ['a', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd'])
  })

  it('returns the order unchanged at the boundaries or for unknown ids', () => {
    expect(moveSection(['a', 'b'], 'a', -1, all)).toEqual(['a', 'b'])
    expect(moveSection(['a', 'b'], 'b', 1, all)).toEqual(['a', 'b'])
    expect(moveSection(['a', 'b'], 'nope', 1, all)).toEqual(['a', 'b'])
    // The only section below is invisible -> nowhere to go.
    expect(moveSection(['a', 'b'], 'a', 1, ['a'])).toEqual(['a', 'b'])
  })
})

describe('toggleCollapsed', () => {
  it('adds and removes ids', () => {
    expect(toggleCollapsed([], 'x')).toEqual(['x'])
    expect(toggleCollapsed(['x', 'y'], 'x')).toEqual(['y'])
  })
})

describe('pruneCollapsed', () => {
  it('drops ids of sections that no longer exist', () => {
    expect(pruneCollapsed(['a', 'gone', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b'])
    expect(pruneCollapsed([], ['a'])).toEqual([])
  })
})
