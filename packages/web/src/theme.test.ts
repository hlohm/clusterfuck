import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, loadTheme, nextTheme, saveTheme } from './theme'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('nextTheme', () => {
  it('cycles auto → light → dark → auto', () => {
    expect(nextTheme('auto')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('auto')
  })
})

describe('loadTheme', () => {
  it('round-trips through saveTheme and defaults to auto on garbage', () => {
    expect(loadTheme()).toBe('auto')
    saveTheme('dark')
    expect(loadTheme()).toBe('dark')

    localStorage.setItem('clusterfuck.theme', JSON.stringify('mauve'))
    expect(loadTheme()).toBe('auto')
  })
})

describe('applyTheme', () => {
  it('sets data-theme for manual modes and removes it for auto', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyTheme('auto')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
