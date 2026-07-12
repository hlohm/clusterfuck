import { loadPref, savePref } from './data/localPrefs'

/**
 * The header's theme toggle: auto (follow the OS, the default) → light →
 * dark → auto. All the mechanism lives in CSS — index.css routes every
 * themed value through light-dark(), so applying a theme is just setting
 * data-theme on <html> to override color-scheme (or removing it for auto).
 */

export const THEME_MODES = ['auto', 'light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export function nextTheme(mode: ThemeMode): ThemeMode {
  return THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]!
}

export function loadTheme(): ThemeMode {
  const saved: unknown = loadPref('theme', 'auto')
  return (THEME_MODES as readonly unknown[]).includes(saved) ? (saved as ThemeMode) : 'auto'
}

export function saveTheme(mode: ThemeMode): void {
  savePref('theme', mode)
}

export function applyTheme(mode: ThemeMode): void {
  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }
}

export const THEME_ICONS: Record<ThemeMode, string> = {
  auto: '◐',
  light: '☀️',
  dark: '🌙',
}

export const THEME_LABELS: Record<ThemeMode, string> = {
  auto: 'Theme: auto (follows the system) — switch to light',
  light: 'Theme: light — switch to dark',
  dark: 'Theme: dark — switch to auto',
}
