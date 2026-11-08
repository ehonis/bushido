/* Smoke cases: the visual system (#82, docs/DESIGN.md "Visual system").
 * Run by app/smoke/index.jsx (`npm run smoke`). A case is [name, element | null, assert?].
 *
 * The token contract is the G-visual-ia grading report's, and it lives in two
 * files that must say the same thing: app/src/styles.css (:root) and
 * mobile/src/theme.ts. These cases read both, and every stylesheet and native
 * screen, so a size, a radius or a space that drifts off the scale is a failure
 * here rather than one more of the twenty-seven font sizes the app once had.
 */
import { dirname } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forWords, FOR_ME } from '../src/lib/trainer.js'
import { dayWords, dayLong, dateWords, weekRange, monthDay } from '../src/lib/dates.js'

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
    // A chip is 44 wide as well as tall (#98 review: "All" and "Fun" measured 42 wide at 390).
    if (!/\n\.chip \{[^}]*min-width: var\(--tap\)/.test(base)) throw new Error('a short chip is under 44 wide')
    if (!/chip: \{[^}]*minHeight: TAP, minWidth: TAP/.test(read('mobile/src/ui/kit.tsx'))) throw new Error('the phone\'s short chips are under 44 wide')
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

  /*
   * The 44 floor on the phone too (#93, F N5): the picker's group chips were 36,
   * the number box 22, a card's head 34. A minHeight under 44 is allowed only on
   * what is not a target, or on a chip whose hitSlop grows it to 44 (the done and
   * share chips, as on the web).
   */
  ['native(no target under the 44 floor)', null, () => {
    const allowed = [['features/sheetparts.tsx', 'chip'], ['features/sharedwith.tsx', 'shareChip'], ['features/whoop.tsx', 'readout'], ['lib/viz.tsx', 'tipline']]
    const bad = []
    for (const file of walk('mobile/src', p => /\.tsx?$/.test(p))) {
      let key = null   // the style the line belongs to: the nearest `name: {` at or above it
      read(file).split('\n').forEach((l, i) => {
        key = (/^\s*(\w+): \{/.exec(l) || [])[1] || key
        // A target held to 44 tall is held to 44 wide too (#98: workout mode's rep ± was 34 × 44).
        // (minWidth: 0 is flex letting a row shrink, not a size.)
        const w = /minWidth: (\d+)\b/.exec(l)
        if (w && +w[1] > 0 && +w[1] < 44 && /minHeight: (TAP|height\.\w+|4[4-9]|[5-9]\d)\b/.test(l)) bad.push(`${file}:${i + 1}: ${l.trim().slice(0, 70)} (${w[1]} wide)`)
        const m = /minHeight: (\d+)\b/.exec(l)
        if (!m || +m[1] >= 44) return
        if (!allowed.some(([f, k]) => file.endsWith(f) && k === key)) bad.push(`${file}:${i + 1}: ${l.trim().slice(0, 70)}`)
      })
    }
    if (bad.length) throw new Error(`under 44pt:\n        ${bad.join('\n        ')}`)
  }],
  /*
   * A set is ONE row on a 390pt phone (#93, F N1): the ✓, reps and weight, each
   * stepper two 44pt buttons round a 44pt number. With the meaning switch in the
   * weight's cell the pair needed 300 of 280 and every set wrapped onto two rows.
   * Added up from the native styles, as the card lays them out.
   */
  ['native(a doing set fits one row at 390pt: ✓, reps, weight)', null, () => {
    const src = read('mobile/src/features/exercises.tsx')
    const t = theme()
    const space = tsObject(t, 'space')
    const TAP = +(/export const TAP = (\d+)/.exec(t) || [])[1]
    const val = (v) => (v === 'TAP' ? TAP : /^space\[(\d)\]$/.test(v) ? space[v.slice(6, -1)] : Number(v))
    const row = Object.fromEntries([...((/export const SET_ROW = \{([^}]*)\}/.exec(src) || [])[1] || '').matchAll(/(\w+): ([\w[\]]+)/g)].map(m => [m[1], val(m[2])]))
    for (const k of ['tick', 'tickGap', 'mid', 'seam']) if (!Number.isFinite(row[k])) throw new Error(`SET_ROW.${k} is not a token`)
    if (!/stepperBtn: \{ width: TAP, height: TAP/.test(src) || !/stepperMid: \{ minWidth: SET_ROW\.mid/.test(src)) throw new Error('the stepper no longer reads SET_ROW')
    if (!/item: \{[^}]*paddingHorizontal: space\[3\]/.test(src)) throw new Error('the card inset moved: redo this sum')
    if (!/gap: SET_ROW\.tickGap/.test(src) || !/gap: SET_ROW\.seam/.test(src)) throw new Error('the set row does not use SET_ROW')
    const inside = 390 - 2 * space[4] - 2 * space[3] - 2   // sheet body, card inset, card border
    const stepper = 2 + 2 * TAP + row.mid
    const need = row.tick + row.tickGap + 2 * stepper + row.seam
    if (need > inside) throw new Error(`a set needs ${need}pt of ${inside}: it wraps onto two rows`)
    if (row.tick < 44 || row.mid < 44) throw new Error('the ✓ or the number is under 44')
    // The ✓ 16 clear of the reps' −, so a left-thumb miss on − never ticks (#93 review).
    if (row.tickGap < 16) throw new Error(`the ✓ is ${row.tickGap}pt from the reps' −`)
    // Copy down on its own line at the right edge, 16 clear of the rows above and below.
    if (!/copyDown: \{ alignSelf: 'flex-end'[^}]*marginVertical: space\[2\]/.test(src) || !/sets: \{ gap: space\[2\]/.test(src)) throw new Error('Copy down is back beside a stepper column')
    // The card is keyed by the exercise, from the same lib function the web tests (#93, A F1).
    if (!/key=\{cardKey\(it\)\}/.test(src) || !/cardIdentity, cardKey,\n\} from '\.\.\/lib\/lifts\.js'/.test(src) || /const identityOf/.test(src)) throw new Error('the native card is not keyed by lib cardKey')
  }],

  /*
   * Plan a workout, the interval timer's setup and the WHOOP screens are their
   * own chunks (#98, lazy.jsx): nothing in app/src imports them statically, so
   * a visit that plans, times and has no WHOOP does not download them. What a
   * workout in progress needs (the runner, the timer's running face) is static.
   */
  ['bundle(Plan a workout, the timer screen and WHOOP on Today load on demand; no sheet or workout waits)', null, () => {
    const bad = []
    // app/src/lib/whoop.jsx is the data hook, not the screens: lib's './whoop.jsx' is that one.
    for (const file of walk('app/src', p => /\.(jsx|js)$/.test(p) && !p.includes('/lib/'))) {
      for (const m of read(file).matchAll(/^import [^\n]* from '\.\/(planner|timer|whoopday)\.jsx'/gm)) bad.push(`${file}: ${m[0]}`)
    }
    if (bad.length) throw new Error(`a static import pulls a lazy part back into the main bundle:\n        ${bad.join('\n        ')}`)
    const app = read('app/src/App.jsx')
    if (!/const PlanFlow = lazyPart\(\(\) => import\('\.\/planner\.jsx'\), 'PlanFlow', \{\s*failed:/.test(app)) throw new Error('Plan a workout is not on demand, or a failed load says nothing')
    if (!/import \{ TimerHost \} from '\.\/timerhost\.jsx'/.test(app)) throw new Error('the timer host, mounted always, is lazy again')
    // Everything a sheet, the runner or workout mode reaches statically: no lazy part in it (#98 review).
    const seen = new Set()
    const visit = (f) => {
      if (seen.has(f)) return
      seen.add(f)
      for (const m of read(f).matchAll(/^import [^\n]* from '(\.{1,2}\/[^']+)'/gm)) {
        const to = join(dirname(f), m[1])
        if (/\.(jsx|js)$/.test(to)) visit(to)
      }
    }
    for (const f of ['app/src/sheet.jsx', 'app/src/runner.jsx', 'app/src/workout.jsx', 'app/src/sessionlog.jsx', 'app/src/daylist.jsx']) visit(f)
    const lazy = [...seen].filter(f => !f.endsWith('lazy.jsx') && /\blazyPart\(/.test(read(f)))
    if (lazy.length) throw new Error(`a sheet or a workout reaches a lazy part: ${lazy.join(', ')}`)
    // Failed loads never cover anything: no fixed card, and WHOOP on Today falls back to nothing.
    if (/\.lazy-failed \{[^}]*position: fixed/.test(read('app/src/styles.css'))) throw new Error('a failed load is a fixed card over the app again')
    if (/lazyPart\(\(\) => import\('\.\/whoopday\.jsx'\), '\w+', \{\s*failed/.test(read('app/src/tabs.jsx'))) throw new Error('WHOOP on Today says something when it fails to load')
  }],

  /* AGENTS.md is the index every agent reads: one number per section, in order (#98: two were 10.12). */
  ['agents(section numbers are unique and in order)', null, () => {
    const nums = [...read('AGENTS.md').matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? /gm)].map(m => m[1])
    const seen = new Set()
    for (const n of nums) { if (seen.has(n)) throw new Error(`AGENTS.md has two sections numbered ${n}`); seen.add(n) }
    const key = (n) => n.split('.').map(Number)
    for (let i = 1; i < nums.length; i += 1) {
      const [a, b] = [key(nums[i - 1]), key(nums[i])]
      const after = b[0] > a[0] || (b[0] === a[0] && (b[1] ?? 0) > (a[1] ?? 0))
      if (!after) throw new Error(`AGENTS.md section ${nums[i]} comes after ${nums[i - 1]}`)
    }
    if (nums.length < 30) throw new Error(`only ${nums.length} numbered sections read: the pattern moved`)
  }],

  /*
   * ONE way to write a day (#98, G r1 F4): five were on screen, one of them a raw
   * ISO date. lib/dates.js writes every one ("Wed, Nov 4", "Sunday, Nov 8",
   * "Nov 2 – Nov 8"); nothing else formats a date. WHOOP's sleep chart ticks are
   * the one exception: an axis, labelled by its own short month and day.
   */
  ['dates(one way to write a day, on both platforms)', null, () => {
    const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"])\/\/.*$/gm, '$1')
    const files = [...walk('app/src', p => /\.(jsx|js)$/.test(p)), ...walk('mobile/src', p => /\.(tsx|ts|js)$/.test(p))]
      .filter(f => !/(^|\/)lib\/dates\.js$/.test(f))
    const bad = []
    for (const f of files) {
      const src = code(f)
      src.split('\n').forEach((l, i) => {
        // The browser's or the phone's own date words: never (WHOOP's chart too, since #98 review).
        if (/toLocaleDateString|Intl\.DateTimeFormat/.test(l)) bad.push(`${f}:${i + 1}: a locale date`)
        // A stored ISO date read out in a sentence ("tested 2026-08-08", "logged {date}").
        if (/[A-Za-z,] \$?\{[\w?.]*\bdate\}/.test(l)) bad.push(`${f}:${i + 1}: a raw date in words: ${l.trim().slice(0, 70)}`)
      })
    }
    if (bad.length) throw new Error(`a date not written by lib/dates.js:\n        ${bad.join('\n        ')}`)
    for (const f of ['app/src/runner.jsx', 'mobile/src/features/runner.tsx']) {
      if (/last time \(\$?\{prior\.date\}\)/.test(read(f))) throw new Error(`${f}: "last time (2026-10-24)" is back`)
    }
    const today = '2026-11-08'
    const said = [dayWords('2026-11-04', today), dayWords('2026-11-07', today), dayLong(today, today), weekRange('2026-11-02'), dateWords('2025-11-04', today), monthDay('2026-10-19')]
    if (said.join(' | ') !== 'Wed, Nov 4 | Yesterday | Sunday, Nov 8 | Nov 2 – Nov 8 | Tue, Nov 4, 2025 | Oct 19') throw new Error(`the day words: ${said.join(' | ')}`)
  }],

  /* One task frame at 720+ (#98, G r1 F7): the timer and the runner sit in the planner's panel. */
  ['layout(one task frame at 720 and up: plan, timer, runner)', null, () => {
    const frame = read('app/src/css/frame.css')
    if (!/@media \(min-width: 720px\) \{\s*\.fs, \.it, \.run \{[^}]*inset: var\(--sp-6\)[^}]*border-radius: var\(--r-sheet\)/.test(frame)) throw new Error('the timer or the runner is unframed at desktop')
    if (!/\.it-body \{ max-width: 680px; \}/.test(frame)) throw new Error('the timer is not the planner\'s 680 column')
    if (!/box-shadow: var\(--elev-3\), 0 0 0 100vmax var\(--scrim\)/.test(frame)) throw new Error('the framed task screens have no scrim around them')
    const imports = [...read('app/src/main.jsx').matchAll(/^import '\.\/([^']+\.css)'/gm)].map(m => m[1])
    if (imports.at(-1) !== 'css/frame.css') throw new Error('frame.css is not imported last, so a screen\'s own inset: 0 wins')
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
