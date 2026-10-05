/*
 * Does the chart palette still work on this surface?
 *   node app/validate_palette.js
 *
 * `styles.css` has said "re-run validate_palette.js before changing any hex"
 * since the viz colours were chosen, and the script it named was never in this
 * repo — it came from a skill that generated the palette and left. So the
 * instruction has been unfollowable for as long as it has been there, which is
 * worse than no instruction: it reads like a gate and is a dead end.
 *
 * This is that gate, for real. It reads the hexes straight out of `styles.css`
 * so it can never drift from what ships, and checks the three things that
 * actually break when a surface colour changes:
 *
 *   1. CONTRAST against the panel the chart is drawn on. A line at 1.8:1 is
 *      invisible on a phone in a bright gym, whatever it looks like on a desktop
 *      at night. WCAG's bar for a graphical object is 3:1.
 *   2. SEPARATION between the categorical series, under normal vision AND under
 *      the three dichromacies. Two series that converge under deuteranopia are
 *      one series for about 1 in 12 men.
 *   3. MONOTONICITY of the load ramp. An ordinal scale whose steps are not in
 *      lightness order is a scale that reads in the wrong direction.
 *
 * Exits non-zero on failure, so it can go in `npm test`.
 */

import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./src/styles.css', import.meta.url), 'utf8')

/** Every `--name: #hex` in the first :root block. */
function palette() {
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)
  if (!root) throw new Error('no :root block in styles.css')
  const out = {}
  for (const m of root[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) out[m[1]] = m[2]
  return out
}

const hex2rgb = (h) => {
  const s = h.replace('#', '')
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s.slice(0, 6)
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
}

/* --------------------------------------------------------------- contrast */

const srgb2lin = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = (rgb) => {
  const [r, g, b] = rgb.map(srgb2lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/* -------------------------------------------------------------------- CVD */

/*
 * Brettel/Viénot-style dichromacy simulation, in linear RGB.
 *
 * Approximate — a full Brettel projection needs the plane split about the
 * neutral axis — but more than good enough for the question being asked here,
 * which is "do these two stay distinguishable" rather than "what exactly does the user
 * see". The matrices are the widely used Machado et al. severity-1.0 set.
 */
const CVD = {
  deuteranopia: [[0.367, 0.861, -0.228], [0.280, 0.673, 0.047], [-0.012, 0.043, 0.969]],
  protanopia: [[0.152, 1.053, -0.205], [0.115, 0.786, 0.099], [-0.004, -0.048, 1.052]],
  tritanopia: [[1.256, -0.077, -0.179], [-0.078, 0.931, 0.148], [0.005, 0.691, 0.304]],
}
const simulate = (rgb, kind) => {
  const m = CVD[kind]
  const lin = rgb.map(srgb2lin)
  return m.map(row => {
    const v = row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]
    const c = Math.max(0, Math.min(1, v))
    return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
  })
}

/* CIE76 ΔE in Lab. Crude but stable, and the threshold is what matters. */
function lab(rgb) {
  const [r, g, b] = rgb.map(srgb2lin)
  let [x, y, z] = [
    r * 0.4124 + g * 0.3576 + b * 0.1805,
    r * 0.2126 + g * 0.7152 + b * 0.0722,
    r * 0.0193 + g * 0.1192 + b * 0.9505,
  ]
  ;[x, y, z] = [x / 0.95047, y, z / 1.08883].map(v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116))
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const deltaE = (a, b) => {
  const [l1, a1, b1] = lab(a); const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/* ------------------------------------------------------------------- gates */

const MIN_CONTRAST = 3       // WCAG 1.4.11, graphical objects
const MIN_SEPARATION = 18    // ΔE between categorical series, incl. under CVD

const p = palette()
const surface = hex2rgb(p['--panel'])
const problems = []
const note = (s) => console.log(s)

note(`surface   ${p['--panel']}`)
note('')

/* 1. every chart ink must be visible on the panel */
const inks = ['--series-1', '--series-2', '--series-3', '--load-1', '--load-2', '--load-3',
  '--load-4', '--viz-good', '--viz-warn', '--viz-crit', '--accent', '--flame']
note('contrast against the panel')
for (const k of inks) {
  if (!p[k]) { problems.push(`${k} is missing from :root`); continue }
  const c = contrast(hex2rgb(p[k]), surface)
  // The darkest step of an ordinal ramp is allowed to be low: it is the "least"
  // end of a scale read by comparison against the steps above it, not a line you
  // have to pick out of a background. Marked EXEMPT rather than FAIL, because a
  // gate that prints a failure and then exits zero is a gate nobody believes.
  const exempt = k === '--load-1'
  const ok = c >= MIN_CONTRAST
  note(`  ${ok ? 'ok    ' : exempt ? 'exempt' : 'FAIL  '} ${k.padEnd(12)} ${p[k]}  ${c.toFixed(2)}:1`)
  if (!ok && !exempt) problems.push(`${k} is ${c.toFixed(2)}:1 on ${p['--panel']}, want ${MIN_CONTRAST}`)
}

/* 2. the categorical series must stay apart, including under dichromacy */
note('')
note('separation between the categorical series')
const series = ['--series-1', '--series-2', '--series-3'].filter(k => p[k])
for (let i = 0; i < series.length; i++) {
  for (let j = i + 1; j < series.length; j++) {
    const a = hex2rgb(p[series[i]]); const b = hex2rgb(p[series[j]])
    for (const vision of ['normal', ...Object.keys(CVD)]) {
      const [x, y] = vision === 'normal' ? [a, b] : [simulate(a, vision), simulate(b, vision)]
      const d = deltaE(x, y)
      const ok = d >= MIN_SEPARATION
      note(`  ${ok ? 'ok    ' : 'FAIL  '} ${series[i].slice(2)} vs ${series[j].slice(2)}  ${vision.padEnd(13)} ΔE ${d.toFixed(1)}`)
      if (!ok) problems.push(`${series[i]} and ${series[j]} converge under ${vision} (ΔE ${d.toFixed(1)})`)
    }
  }
}

/* 3. the load ramp must climb */
note('')
note('the load ramp is ordinal')
const ramp = ['--load-1', '--load-2', '--load-3', '--load-4'].filter(k => p[k])
let prev = -1
for (const k of ramp) {
  const l = luminance(hex2rgb(p[k]))
  const ok = l > prev
  note(`  ${ok ? 'ok    ' : 'FAIL  '} ${k.padEnd(10)} ${p[k]}  L ${l.toFixed(3)}`)
  if (!ok) problems.push(`${k} is not lighter than the step below it`)
  prev = l
}

note('')
if (problems.length) {
  for (const x of problems) console.error(`  ! ${x}`)
  console.error(`\n${problems.length} palette problem(s)`)
  process.exit(1)
}
console.log('palette ok')
