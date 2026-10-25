// The web's design tokens (app/src/styles.css :root, the "Carbon" palette), as
// one object. Keep the names the CSS uses so a value can be looked up in either
// direction: `--ink-dim` is `colors.inkDim`, `--series-1` is `colors.series1`.
//
// The viz colours are VALIDATED by app/validate_palette.js (`npm --prefix app run
// palette`). Never change one here without changing it there first.
//
// THE VISUAL SYSTEM (docs/DESIGN.md, "Visual system"): colour, type, space,
// radius and elevation, each named as on the web (`--fs-title` is `font.title`,
// `--sp-4` is `space[4]`, `--r-card` is `radius.card`, `--elev-2` is `elevation[2]`).
// Screens take values from here and components from ./ui/kit; a raw number in a
// screen's styles is a value the system is missing.
import { StyleSheet } from 'react-native'

export const colors = {
  bg: '#0b0c0b',
  panel: '#131513',
  panel2: '#1a1d1a',
  panel3: '#232723',
  line: '#272b27',
  lineStrong: '#363c35',
  ink: '#e9ece7',
  inkDim: '#99a295',
  // Was #61695e (3.2:1 on a card); now clears 4.5:1 on bg, panel and panel2. It
  // is never used on panel3 or accentSoft (4.2:1 and 3.5:1): text there is ink or inkDim.
  inkFaint: '#808a7c',
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
  // Text and icons on the accent: --on-accent, one value for the button and the +.
  onAccent: '#0f1409',
  // --accent-soft and --accent-line: the web's color-mix(in oklab, accent 14% /
  // 55%, panel-2 / line), precomputed in oklab so both renderers show the same hex.
  accentSoft: '#2d3623',
  accentLine: '#72923e',
  scrim: 'rgba(0, 0, 0, 0.62)',
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

/**
 * Radius, one rule: controls 10 (`--r-control`), containers 12 (`--r-card`),
 * sheets 20 (`--r-sheet`), chips and round buttons pill. `sm`/`md`/`lg`/`xl`
 * are the older names, kept so unported screens still compile: md is a card.
 */
export const radius = {
  control: 10, card: 12, sheet: 20, pill: 999,
  sm: 8, md: 12, lg: 14, xl: 16,
} as const
export const TAP = 44

/** Type sizes (`--fs-*`). `micro` is for the dock and chart ticks only. */
export const font = {
  micro: 11, caption: 12, small: 13, body: 15, input: 16, title: 17, heading: 22, display: 32,
} as const

/** Space on a 4pt grid (`--sp-*`); `gutter` is the screen's side margin. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, gutter: 16 } as const

/**
 * Elevation (`--elev-*`). Cards are flat: a line, no shadow. 2 is for what
 * floats over the page (the dock, the +), 3 for sheets and menus.
 */
export const elevation = {
  2: { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  3: { shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: -12 } },
} as const

export const hairline = StyleSheet.hairlineWidth
