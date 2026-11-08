/* The how-to figures (#109):
 *   npm --prefix app run test:figures
 *
 * The drawings are data (src/lib/figuredata.js) that both apps render, so this
 * holds the things a picture test cannot see by looking:
 *   - the phone draws exactly the web's shapes: the same data file, and two
 *     renderers that hold no drawing of their own;
 *   - ONE body: every limb in every figure has the skeleton's lengths, and a
 *     hand or foot sent to a hold, an edge or the floor actually gets there
 *     (the old scap-pull's arms shrank 31 → 18 between poses and read as a
 *     pull-up; climbers floated 20 units off their walls);
 *   - every figure has its one cue, every movement figure moves, and the
 *     sibling figures a session shows side by side do not share a silhouette;
 *   - the web renders every shape the data has.
 * The smoke suite (smoke/sheet.jsx) still checks every figure the plan names
 * exists and every figure is used.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { FIGURES, KINDS, BONES, LIMBS, dist } from './src/lib/figuredata.js'
import { Figure } from './src/lib/figures.jsx'

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const layers = (f) => ['props', 's', 'a', 'b', 'over', 'detail'].flatMap(l => f[l] || [])
const names = Object.keys(FIGURES)

check('the phone copies the web figure data byte for byte', () => {
  ok(read('./src/lib/figuredata.js') === read('../mobile/src/lib/figuredata.js'),
    'mobile/src/lib/figuredata.js differs from app/src/lib/figuredata.js: copy it again')
})

check('neither renderer draws anything of its own', () => {
  for (const file of ['./src/lib/figures.jsx', '../mobile/src/lib/figures.tsx']) {
    const src = read(file)
    ok(/from '\.\/figuredata\.js'/.test(src), `${file} does not render from figuredata.js`)
    ok(!/\bd="[^"]/.test(src) && !/\bd=\{`/.test(src) && !/\bd: ['"`]/.test(src), `${file} has path data in it`)
    ok(!/c[xy]=\{?\d/.test(src), `${file} has a coordinate in it`)
  }
})

check('every shape is a known kind with a path or a circle', () => {
  for (const n of names) {
    for (const s of layers(FIGURES[n])) {
      ok(KINDS[s.k], `${n}: unknown kind ${s.k}`)
      ok(typeof s.d === 'string' ? !s.d.includes('NaN') : Array.isArray(s.c) && s.c.every(Number.isFinite),
        `${n}: a ${s.k} with no geometry`)
    }
  }
})

check('one skeleton: every limb has the bones’ lengths', () => {
  ok(LIMBS.length > 60, `only ${LIMBS.length} limbs were built`)
  for (const l of LIMBS) {
    const [a, b] = [dist(l.root, l.mid), dist(l.mid, l.end)]
    ok(Math.abs(a - l.lengths[0]) < 0.05 && Math.abs(b - l.lengths[1]) < 0.05,
      `a limb from ${l.root.map(Math.round)} is ${a.toFixed(1)} + ${b.toFixed(1)}, not ${l.lengths.join(' + ')}`)
    const pair = l.lengths.join()
    ok([`${BONES.upperArm},${BONES.forearm}`, `${BONES.thigh},${BONES.shin}`].includes(pair), `a limb of ${pair} is not an arm or a leg`)
  }
})

check('contacts touch: every hand and foot sent somewhere gets there', () => {
  for (const l of LIMBS.filter(l => l.target)) {
    const miss = dist(l.end, l.target)
    ok(miss < 0.3, `a limb from ${l.root.map(Math.round)} stops ${miss.toFixed(1)} short of ${l.target.map(Math.round)}`)
  }
})

check('every figure has a cue, and the alt text says what it shows', () => {
  for (const n of names) {
    const f = FIGURES[n]
    ok(layers(f).some(s => KINDS[s.k].cue), `${n} has no cue`)
    ok(typeof f.alt === 'string' && f.alt.length > 20, `${n} has no alt text`)
    ok(f.a?.length, `${n} has no pose`)
  }
})

check('every movement figure moves, and a hold has nothing to crossfade', () => {
  for (const n of names) {
    const f = FIGURES[n]
    if (f.b) ok(JSON.stringify(f.a) !== JSON.stringify(f.b), `${n}: pose B is pose A`)
  }
})

check('siblings shown side by side do not share a silhouette', () => {
  const same = (x, y) => JSON.stringify(FIGURES[x].a) === JSON.stringify(FIGURES[y].a)
  for (const [x, y] of [
    ['forearm-supination', 'forearm-pronation'], ['grip-four', 'grip-front-three'], ['grip-four', 'grip-two'],
    ['grip-front-three', 'grip-two'], ['climb-board', 'boulder'], ['climb-route', 'crag'], ['climb-route', 'climb-double'],
    ['hang-edge', 'hang-assisted'], ['plank-reach', 'side-bridge'],
  ]) ok(!same(x, y), `${x} and ${y} start on the same picture`)
  // The two eccentric figures turn opposite ways.
  const arc = (n) => FIGURES[n].s.find(s => s.dash).d
  ok(arc('forearm-supination') !== arc('forearm-pronation'), 'supination and pronation arrows are the same')
})

check('scap-pull: the arms are the same lines in both poses (they never bend)', () => {
  const f = FIGURES['scap-pull']
  const arms = f.s.filter(s => s.k === 'cueBody')
  ok(arms.length === 2, 'the arms are not the fixed cue')
  ok(!f.a.some(s => s.k === 'cueBody') && !f.b.some(s => s.k === 'cueBody'), 'an arm moves between poses')
})

check('the web renders every shape the data has; thumbnails leave the inset out', () => {
  for (const n of names) {
    const f = FIGURES[n]
    const html = renderToStaticMarkup(<Figure name={n} />)
    const want = layers(f).filter(s => s.d).length + layers(f).filter(s => s.c).length
    const got = (html.match(/<path /g) || []).length + (html.match(/<circle /g) || []).length
    ok(got === want, `${n}: ${got} elements for ${want} shapes`)
    for (const s of layers(f).filter(s => s.d)) ok(html.includes(`d="${s.d}"`), `${n}: a path is missing`)
    if (f.detail) {
      ok(html.includes('fig-detail'), `${n}: the card has no inset`)
      ok(!renderToStaticMarkup(<Figure name={n} detail={false} />).includes('fig-detail'), `${n}: the thumbnail draws the inset`)
    }
    ok(!html.includes('NaN'), `${n}: NaN in the markup`)
  }
})

check('the cue is drawn in --fig-cue, never a fixed colour', () => {
  const html = renderToStaticMarkup(<Figure name="hang-edge" />)
  ok(html.includes('class="fig-cue"'), 'no cue element carries .fig-cue')
  ok(!/#[0-9a-f]{3,6}/i.test(html), 'a figure carries a literal colour')
  const css = read('./src/css/sheet.css')
  ok(/\.fig \{[^}]*color: inherit/.test(css), '.fig does not inherit its container colour')
  ok(/\.fig-cue \{[^}]*var\(--fig-cue/.test(css), '.fig-cue is not --fig-cue')
})

if (failed) { console.error(`\n${failed} failed`); process.exit(1) }
console.log('\nfigures: all passed')
