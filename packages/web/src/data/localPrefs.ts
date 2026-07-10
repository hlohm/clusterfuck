/**
 * Tiny localStorage wrapper for UI preferences (sidebar width, overview
 * section layout, ...). Preferences are per-browser and cosmetic, so every
 * failure mode — storage disabled, quota, corrupt JSON from an older build —
 * degrades to the fallback rather than an error.
 */

const PREFIX = 'clusterfuck.'

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function savePref<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or disabled — the preference just won't stick.
  }
}
