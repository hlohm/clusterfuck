export interface ThemedColor {
  light: string
  dark: string
}

/** CSS light-dark() value so a ThemedColor tracks the active color scheme. */
export function cssColor(c: ThemedColor): string {
  return `light-dark(${c.light}, ${c.dark})`
}

/** Fixed status tokens — never themed per-series, always paired with icon + label. */
export const STATUS = {
  good: { light: '#0ca30c', dark: '#3dbb3d' } satisfies ThemedColor,
  warning: { light: '#fab219', dark: '#fab219' } satisfies ThemedColor,
  serious: { light: '#ec835a', dark: '#ec835a' } satisfies ThemedColor,
  critical: { light: '#d03b3b', dark: '#e5615f' } satisfies ThemedColor,
  neutral: { light: '#6b7280', dark: '#9aa1ac' } satisfies ThemedColor,
  activity: { light: '#2a78d6', dark: '#3987e5' } satisfies ThemedColor,
}
