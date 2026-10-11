// The web's design tokens (app/src/styles.css :root, the "Carbon" palette), as
// one object. Keep the names the CSS uses so a value can be looked up in either
// direction: `--ink-dim` is `colors.inkDim`, `--series-1` is `colors.series1`.
//
// The viz colours are VALIDATED by app/validate_palette.js (`npm run palette` at
// the repo root). Never change one here without changing it there first.
import { StyleSheet } from 'react-native'

export const colors = {
  bg: '#0b0c0b',
  panel: '#131513',
  panel2: '#1a1d1a',
  line: '#272b27',
  ink: '#e9ece7',
  inkDim: '#99a295',
  inkFaint: '#61695e',
  accent: '#b8f23d',
  good: '#6fd66f',
  warn: '#f0b429',
  bad: '#e2614f',
  flame: '#f0803c',
  series1: '#5aa9f0',
  series2: '#f07c34',
  series3: '#48d9a0',
  load1: '#1c4f86',
  load2: '#2f7fc9',
  load3: '#5ba3e3',
  load4: '#a3cdf4',
  vizGrid: '#22261f',
  vizAxis: '#2e332b',
  vizMuted: '#8b9385',
  vizGood: '#3fbf55',
  vizWarn: '#f0b429',
  vizCrit: '#e2564e',
  // Text on the accent (button.btn is #1a1509, the + FAB #0b0c0b).
  onAccent: '#1a1509',
  // Toast fills (ToastHost.tsx): white text clears 4.5:1 on each.
  toastError: '#b8382a',
  toastSuccess: '#2f7a2f',
  toastInfo: '#2b6aa8',
  white: '#ffffff',
  black: '#000000',
} as const

/** Any hex colour at an alpha, for the CSS's `#rrggbbaa`. */
export function alpha(hex: string, a: number) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/**
 * `color-mix(in oklab, A p%, B)`, approximated in sRGB. The CSS uses it for
 * tinted fills and borders (`--accent 12%` over `--panel-2`); the difference
 * from oklab at these small percentages is not visible.
 */
export function mix(a: string, pct: number, b: string) {
  const rgb = (hex: string) => {
    const h = hex.replace('#', '')
    const n = parseInt(h.slice(0, 6), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const p = pct / 100
  const [x, y] = [rgb(a), rgb(b)]
  const c = x.map((v, i) => Math.round(v * p + y[i] * (1 - p)))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Named viz series, the way the web's SERIES array names CSS variables. */
export const SERIES = [colors.series1, colors.series2, colors.series3] as const

/** Resolve a `var(--x)` string from content or a ported module to a colour. */
export function cssColor(v: string | null | undefined, fallback: string = colors.inkDim): string {
  if (!v) return fallback
  const m = /^var\(--([a-z0-9-]+)\)$/.exec(String(v).trim())
  if (!m) return v
  const key = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase()) as keyof typeof colors
  return colors[key] || fallback
}

/** --radius: 10px, --tap: 44px. */
export const radius = { sm: 8, md: 10, lg: 14, xl: 16, pill: 999 } as const
export const TAP = 44

export const hairline = StyleSheet.hairlineWidth
