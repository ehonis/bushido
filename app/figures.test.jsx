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
import { FIGURES, KINDS, BONES, LIMBS, BODIES, dist, bounds, pointsIn, mirrored } from './src/lib/figuredata.js'
import { Figure, FigureDetail } from './src/lib/figures.jsx'

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const layers = (f) => ['props', 's', 'a', 'b', 'over', 'detail'].flatMap(l => f[l] || [])
const drawn = (f) => ['props', 's', 'a', 'b', 'over'].flatMap(l => f[l] || [])
const person = (f) => ['s', 'a', 'b', 'over'].flatMap(l => f[l] || [])
/** Pixels per figure unit in the 50×42 row thumbnail (every view has the box's shape). */
const thumbScale = (f) => 50 / f.view[2]
const turn = (a) => ((a % 360) + 540) % 360 - 180
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

check('the web renders every shape the data has; the close-up is the card\u2019s alone', () => {
  for (const n of names) {
    const f = FIGURES[n]
    const html = renderToStaticMarkup(<Figure name={n} />)
    const want = drawn(f).length
    const got = (html.match(/<path /g) || []).length + (html.match(/<circle /g) || []).length
    ok(got === want, `${n}: ${got} elements for ${want} shapes`)
    for (const s of drawn(f).filter(s => s.d)) ok(html.includes(`d="${s.d}"`), `${n}: a path is missing`)
    ok(html.includes(`viewBox="${f.view.join(' ')}"`), `${n}: not drawn in its own framing`)
    ok(!html.includes('fig-detail'), `${n}: the figure draws its close-up (a thumbnail would)`)
    const det = renderToStaticMarkup(<FigureDetail name={n} />)
    ok(Boolean(f.detail) === det.includes('fig-detail'), `${n}: the close-up is ${f.detail ? 'missing' : 'drawn with nothing in it'}`)
    ok(!html.includes('NaN') && !det.includes('NaN'), `${n}: NaN in the markup`)
  }
})

/* ------------------------------------------------- what reads at 50×42 (#109 r2) */

check('every figure is framed on its person: the body spans at least 70% of the view', () => {
  for (const n of names) {
    const f = FIGURES[n]
    const [x0, y0, x1, y1] = bounds(person(f))
    const [, , w, h] = f.view
    ok(Math.abs(w / h - 1.2) < 0.01, `${n}: the view is not the box's shape (${w}×${h})`)
    const span = Math.max((x1 - x0) / w, (y1 - y0) / h)
    ok(span >= 0.7, `${n}: the person spans only ${Math.round(span * 100)}% of the view`)
  }
})

check('every cue survives the thumbnail: at least 2px wide at 50×42', () => {
  for (const n of names) {
    const f = FIGURES[n]
    for (const s of drawn(f).filter(s => KINDS[s.k].cue && !KINDS[s.k].fill)) {
      const px = (s.w ?? KINDS[s.k].stroke) * thumbScale(f)
      ok(px >= 2, `${n}: a cue ${px.toFixed(2)}px wide at 50×42`)
    }
  }
})

check('the two poses visibly differ: ten units on the part that moves', () => {
  const far = (from, to) => Math.max(...from.map(p => Math.min(...to.map(q => dist(p, q)))))
  for (const n of names.filter(n => FIGURES[n].b)) {
    const f = FIGURES[n]
    const a = pointsIn(f.a)
    const b = pointsIn(f.b)
    const moved = Math.max(far(a, b), far(b, a))
    ok(moved * thumbScale(f) >= 4, `${n}: the poses differ by ${moved.toFixed(1)} units (${(moved * thumbScale(f)).toFixed(1)}px at 50×42)`)
  }
})

check('anatomy: every head follows its spine (within 30°, 40° for a climber looking up)', () => {
  ok(BODIES.length > 20, `only ${BODIES.length} bodies were recorded`)
  for (const b of BODIES) {
    const off = Math.abs(turn(b.neck - b.lean))
    ok(off <= (b.looksUp ? 40 : 30), `a head ${Math.round(off)}° off its spine (spine ${Math.round(b.lean)}°, neck ${Math.round(b.neck)}°)`)
  }
})

check('anatomy: two arms or two legs never fuse, and a far limb is clearly behind', () => {
  const offLine = (p, a, b) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / Math.hypot(dx, dy)
  }
  for (const b of BODIES) {
    for (const [x, y] of [['armL', 'armR'], ['legL', 'legR']]) {
      const [p, q] = [b.limbs[x], b.limbs[y]]
      if (!p || !q) continue
      const apart = Math.max(dist(p.mid, q.mid), dist(p.end, q.end))
      ok(apart >= 4, `${x}/${y} of a ${b.view} body are ${apart.toFixed(1)} apart: one limb, or a grey sliver`)
      ok(offLine(q.end, p.root, p.end) >= 3 || offLine(p.end, q.root, q.end) >= 3 || dist(p.root, q.root) > 6,
        `${x}/${y} of a ${b.view} body lie on one line: they read as one pole`)
    }
  }
})

check('a sided figure is mirrored for the right hand, and only then', () => {
  ok(mirrored('no-hang-pull', 'Right hand pulls') && mirrored('no-hang-pull', 'MVC right'), 'the right hand is not mirrored')
  ok(!mirrored('no-hang-pull', 'Left hand pulls') && !mirrored('no-hang-pull', 'Bright idea'), 'the left hand is mirrored')
  ok(!mirrored('hang-edge', 'Right hand'), 'a figure with no sides is mirrored')
  const html = renderToStaticMarkup(<Figure name="no-hang-pull" mirror />)
  ok(/transform="matrix\(-1 0 0 1 /.test(html), 'mirror does not flip the drawing')
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
