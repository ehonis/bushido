/* Smoke cases: the visual system (#82, docs/DESIGN.md "Visual system").
 * Run by app/smoke/index.jsx (`npm run smoke`). A case is [name, element | null, assert?].
 *
 * The token contract is the G-visual-ia grading report's, and it lives in two
 * files that must say the same thing: app/src/styles.css (:root) and
 * mobile/src/theme.ts. These cases read both, and every stylesheet and native
 * screen, so a size, a radius or a space that drifts off the scale is a failure
 * here rather than one more of the twenty-seven font sizes the app once had.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forWords, FOR_ME } from '../src/lib/trainer.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const walk = (dir, ok, out = []) => {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = join(dir, f)
    if (f === 'node_modules' || f.startsWith('.')) continue
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, ok, out)
    else if (ok(p)) out.push(p)
  }
  return out
}

/* The contract, in one place: role → [size, line height]. */
const TYPE = { caption: [12, 16], label: [14, 20], body: [16, 24], title: [18, 24], screen: [24, 30], stat: [32, 38] }
const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 }
const RADIUS = { mark: 4, control: 10, card: 12, sheet: 20, pill: 999 }
const HEIGHT = { control: 48, row: 56, run: 56 }

const rootTokens = () => {
  const css = read('app/src/styles.css')
  const out = {}
  for (const block of css.match(/:root \{[^}]*\}/g) || []) {
    for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  }
  return out
}
const px = (v) => (/^\d+(\.\d+)?px$/.test(v || '') ? parseFloat(v) : null)
const theme = () => read('mobile/src/theme.ts')
const tsObject = (src, name) => {
  const body = (src.match(new RegExp(`export const ${name} = \\{([^}]*)\\}`)) || [])[1]
  if (!body) throw new Error(`theme.ts has no ${name}`)
  return Object.fromEntries([...body.matchAll(/([a-z0-9]+):\s*(\d+)/g)].map(m => [m[1], +m[2]]))
}

/* Each declaration of a stylesheet, comments stripped, with the file it is in. */
const declarations = () => walk('app/src', p => p.endsWith('.css')).flatMap(file => {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)/g)]
    .filter(m => !m[1].startsWith('--') && !/^(hover|active|focus|root|not|is|has)$/.test(m[1]))
    .map(m => ({ file, prop: m[1], value: m[2].trim() }))
})

export default [
  ['tokens(styles.css and theme.ts carry the same contract, at its numbers)', null, () => {
    const t = rootTokens()
    const src = theme()
    const font = tsObject(src, 'font'), leading = tsObject(src, 'leading'), space = tsObject(src, 'space')
    const radius = tsObject(src, 'radius'), height = tsObject(src, 'height')
    for (const [role, [size, lh]] of Object.entries(TYPE)) {
      if (px(t[`fs-${role}`]) !== size) throw new Error(`--fs-${role} is ${t[`fs-${role}`]}, not ${size}px`)
      if (font[role] !== size) throw new Error(`font.${role} is ${font[role]}, not ${size}`)
      if (leading[role] !== lh) throw new Error(`leading.${role} is ${leading[role]}, not ${lh}`)
      if (role !== 'body' && px(t[`lh-${role}`]) !== lh) throw new Error(`--lh-${role} is ${t[`lh-${role}`]}, not ${lh}px`)
    }
    if (px(t['fs-input']) < 16 || font.input < 16) throw new Error('an input under 16 zooms the page on iOS')
    for (const [k, v] of Object.entries(SPACE)) {
      if (px(t[`sp-${k}`]) !== v || space[k] !== v) throw new Error(`space ${k} is ${t[`sp-${k}`]} / ${space[k]}, not ${v}`)
    }
    // Nothing between the steps: the 20 and the 11/13/15/17/22 sizes are gone from both.
    const extraSp = Object.keys(t).filter(k => /^sp-\d+$/.test(k) && !(k.slice(3) in SPACE))
    const extraFs = Object.keys(t).filter(k => /^fs-/.test(k) && !(k.slice(3) in TYPE) && !/^fs-(input|clock|clock-min|live)$/.test(k))
    if (extraSp.length || extraFs.length) throw new Error(`tokens off the contract: ${[...extraSp, ...extraFs].join(', ')}`)
    if (Object.keys(space).some(k => /^\d+$/.test(k) && !(k in SPACE))) throw new Error('theme.ts space has a step the contract lacks')
    if (Object.keys(font).some(k => !(k in TYPE) && !/^(input|clock|live)$/.test(k))) throw new Error(`theme.ts font has sizes off the contract: ${Object.keys(font)}`)
    for (const [k, v] of Object.entries(RADIUS)) {
      if (px(t[`r-${k === 'sheet' ? 'sheet' : k}`]) !== v || radius[k] !== v) throw new Error(`radius ${k} is ${t[`r-${k}`]} / ${radius[k]}, not ${v}`)
    }
    if (Object.keys(radius).some(k => !(k in RADIUS))) throw new Error(`theme.ts radius has older names: ${Object.keys(radius)}`)
    for (const [k, v] of Object.entries(HEIGHT)) {
      if (px(t[`h-${k}`]) !== v || height[k] !== v) throw new Error(`height ${k} is ${t[`h-${k}`]} / ${height[k]}, not ${v}`)
    }
    if (px(t.tap) !== 44 || !/export const TAP = 44\b/.test(src)) throw new Error('the 44 floor moved')
  }],

  /* Every font-size, radius and space in every stylesheet is a token. */
  ['css(every font size, radius and space on the scale)', null, () => {
    const bad = []
    const rawPx = (v) => [...v.matchAll(/(?<![\w-])(-?\d+(?:\.\d+)?)(px|rem|em)\b/g)].map(m => [parseFloat(m[1]), m[2]])
    for (const { file, prop, value } of declarations()) {
      if (prop === 'font-size') {
        if (rawPx(value).length || /^\d/.test(value)) bad.push(`${file}: font-size: ${value}`)
      } else if (/radius$/.test(prop)) {
        if (rawPx(value).length) bad.push(`${file}: ${prop}: ${value}`)
      } else if (/^(padding|margin)(-[a-z-]+)?$|^(row-|column-)?gap$/.test(prop)) {
        // 1px and 2px are optical nudges, not spacing.
        if (rawPx(value).some(([n, u]) => u !== 'px' || Math.abs(n) > 2)) bad.push(`${file}: ${prop}: ${value}`)
      }
    }
    if (bad.length) throw new Error(`off the scale (${bad.length}):\n        ${bad.slice(0, 12).join('\n        ')}`)
  }],

  /* The desktop changes layout, never type: a card's title was 15px there, under 16px text.
   (The phone's own rules, under 720, are the dock's labels: a layout the desktop lacks.) */
  ['css(no font size changes with the width)', null, () => {
    for (const file of walk('app/src', p => p.endsWith('.css'))) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of css.matchAll(/@media \(min-width:[^)]*\)\s*\{/g)) {
        let depth = 1, i = m.index + m[0].length
        while (depth && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++ }
        const body = css.slice(m.index + m[0].length, i)
        if (/font-size|(?<![\w-])font:\s/.test(body)) throw new Error(`${file}: a font size inside ${m[0].trim()}`)
      }
    }
  }],

  /*
   * 44 is the floor for anything pressed on its own (#82): filter chips were 36,
   * segments 38, a dozen buttons 30 to 42. A min-height under it is allowed only
   * on what is not a target, or on a chip whose ::after grows its hit area to 44
   * (the header's done and share chips, kept small so the header stays short).
   */
  ['css(no target under the 44 floor)', null, () => {
    const allowed = ['.sleep-readout', '.viz-tipline', '.done-chip', '.share-chip']
    const bad = []
    for (const file of walk('app/src', p => p.endsWith('.css'))) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const h = /min-height:\s*(\d+)px/.exec(m[2])
        if (h && +h[1] < 44 && !allowed.some(a => m[1].includes(a))) bad.push(`${file}: ${m[1].trim()} (${h[1]}px)`)
      }
    }
    if (bad.length) throw new Error(`under 44px:\n        ${bad.join('\n        ')}`)
    const base = read('app/src/styles.css')
    for (const [sel, h] of [['button.btn', '--h-control'], ['.list-row', '--h-row'], ['.chip', '--tap']]) {
      const rule = (base.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`)) || [])[1] || ''
      if (!rule.includes(`min-height: var(${h})`)) throw new Error(`${sel} is not ${h} tall`)
    }
  }],

  /* The same on the phone: a T's size is a role, and no style carries a raw size. */
  ['native(every size, radius and space from theme.ts)', null, () => {
    const bad = []
    for (const file of walk('mobile/src', p => /\.tsx?$/.test(p) && !p.endsWith('theme.ts'))) {
      const src = read(file)
      for (const m of src.matchAll(/<T\b(?:[^<>]|=>)*?\bsize=\{(\d+(?:\.\d+)?)\}/g)) bad.push(`${file}: <T size={${m[1]}}>`)
      for (const m of src.matchAll(/\bfontSize: (\d+)/g)) bad.push(`${file}: fontSize ${m[1]}`)
      for (const m of src.matchAll(/\bborderRadius: ([1-9]\d*)\b/g)) bad.push(`${file}: borderRadius ${m[1]}`)
      for (const m of src.matchAll(/\b(padding|margin)(Top|Bottom|Left|Right|Horizontal|Vertical)?: -?([3-9]|[1-9]\d+)\b(?!\.)|\b(gap|rowGap|columnGap): ([3-9]|[1-9]\d+)\b/g)) bad.push(`${file}: ${m[0]}`)
      for (const m of src.matchAll(/\b(font|space|radius)\.(micro|small|heading|display|sm|md|lg|xl)\b|space\[5\]/g)) bad.push(`${file}: ${m[0]} (retired)`)
    }
    if (bad.length) throw new Error(`off the scale (${bad.length}):\n        ${bad.slice(0, 12).join('\n        ')}`)
    const kit = read('mobile/src/ui/kit.tsx')
    if (!/export type BtnKind = 'primary' \| 'secondary' \| 'quiet' \| 'destructive'/.test(kit)) throw new Error('the phone does not have the four button kinds')
  }],

  /* Four kinds of button on the web too: ghost went into secondary, bad became destructive. */
  ['buttons(four kinds: primary, secondary, quiet, destructive)', null, () => {
    const hits = walk('app/src', p => /\.(jsx|css)$/.test(p))
      .flatMap(f => [...read(f).matchAll(/(?<![\w-])btn (ghost|bad|danger)\b|(?<![\w-])btn\.(ghost|bad|danger)\b/g)].map(m => `${f}: ${m[0]}`))
    if (hits.length) throw new Error(`retired button kinds: ${hits.join(', ')}`)
  }],

  /* A dark app says so, so native pickers, scrollbars and autofill draw dark. */
  ['css(color-scheme: dark)', null, () => {
    if (!/:root \{ color-scheme: dark; \}/.test(read('app/src/styles.css'))) throw new Error('no color-scheme: dark')
  }],
  /*
   * ONE NAME PER ACTION (#82, the G-visual-ia glossary). Starting was "Start
   * workout / Start the workout / Start it now / Start the first one";
   * committing a plan was "Put it on today" while a card said "Add to today";
   * the bin said "Remove from today" over any day. Now: Add to <the day>, Start
   * workout (or Start <the first one's name>), Remove workout, on both platforms.
   */
  ['copy(one name per action, on both platforms)', null, () => {
    const retired = /Put it on |Start the workout|Start it now|Start the first one|Remove from today|Add to today|Remove this workout|arrive from Strava/
    const hits = [...walk('app/src', p => /\.(jsx|js)$/.test(p)), ...walk('mobile/src', p => /\.(tsx|ts|js)$/.test(p))]
      .flatMap(f => read(f).split('\n').map((l, i) => [f, i + 1, l]))
      .filter(([, , l]) => retired.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
      .map(([f, n, l]) => `${f}:${n}: ${l.trim().slice(0, 80)}`)
    if (hits.length) throw new Error(`the old words:\n        ${hits.join('\n        ')}`)
    const words = forWords(FOR_ME)
    if (words.keep !== 'Add to Today' || forWords(FOR_ME, 'Sat, Oct 24').keep !== 'Add to Sat, Oct 24') throw new Error(`the keep button reads "${words.keep}"`)
  }],
]
