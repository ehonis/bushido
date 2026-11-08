// The 44px floor, measured on rendered screens (#98, G r1 F2). The CSS-text
// check (smoke/system.jsx) reads only `min-height: Npx` and could not see the
// two misses the regrade measured: workout mode's rep ± (min-width 34) and the
// climbing card's section chips (39 tall: padding and a line of text, no
// min-height at all). Here real screens are rendered into happy-dom at 390 wide
// with every stylesheet the app loads, in main.jsx's order, and each target's
// box is read from its COMPUTED style: max(min-height, height, padding + border
// + its line or icon). happy-dom has no layout engine, so a box's width from its
// text is ESTIMATED low: each character at 0.4 of its font size, narrower than
// any letter this font draws, so a word judged 44 wide is at least that (real
// Chrome at 390 measured the Log's "All" chip 42 wide: here 42.8). Anything that declares a
// width, or holds only an icon, is. Bundled by esbuild (JSX) into smoke/ (the
// fixtures read files relative to it) and run in node.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'

const W = 390
const win = new Window({ url: 'http://localhost/', width: W, height: 844 })
win.matchMedia = (q) => ({ matches: /coarse/.test(q) || /max-width: *(7[2-9]\d|[89]\d\d|\d{4,})px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
for (const k of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'HTMLIFrameElement', 'HTMLInputElement', 'Node', 'Event', 'getComputedStyle', 'localStorage']) {
  const value = k === 'window' ? win : k === 'getComputedStyle' ? win.getComputedStyle.bind(win) : win[k]
  Object.defineProperty(globalThis, k, { value, configurable: true, writable: true })
}
win.scrollTo = () => {}
// No layout here, so nothing ever resizes: the charts' observers watch nothing.
globalThis.ResizeObserver = win.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} }
globalThis.IntersectionObserver = win.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Every stylesheet main.jsx imports, in its order: the cascade the phone gets.
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
for (const [, f] of main.matchAll(/^import '\.\/([^']+\.css)'/gm)) {
  const style = document.createElement('style')
  style.textContent = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
  document.head.appendChild(style)
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const F = await import('./smoke/fixtures.jsx')
const { TodayTab } = await import('./src/tabs.jsx')
const { LogTab } = await import('./src/log.jsx')
const { ProgressView } = await import('./src/progress.jsx')
const { FabMenu } = await import('./src/shell.jsx')
const { SessionView } = await import('./src/session.jsx')
const { Review } = await import('./src/workout.jsx')
const { WorkoutRunner } = await import('./src/runner.jsx')
const { PlanProvider } = await import('./src/lib/planctx.jsx')
const { buildSteps } = await import('./src/lib/workout.js')
const { plan, rich, noop, PLANNED_CARD, PLANNED_ENTRY } = F

/* --------------------------------------------------------- measuring */

/** A computed length in px: `44px`, `calc(44px - 5px)`, `0`, else NaN. */
function px(v) {
  if (!v || v === 'auto' || v === 'none' || v === 'normal') return NaN
  const expr = String(v).trim().replace(/^calc\((.*)\)$/, '$1')
  if (!/^[\d.\s+\-*/()px]+$/.test(expr)) return NaN
  try { return Function(`"use strict"; return (${expr.replace(/px/g, '')})`)() } catch { return NaN }
}
const n0 = (v) => (Number.isFinite(px(v)) ? px(v) : 0)

function hidden(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.hidden || win.getComputedStyle(e).display === 'none') return true
  }
  return false
}

/** A character's width at its narrowest, as a fraction of the font size (see the top). */
const TEXT_EM = 0.4

/** The smallest box this target can be, from what its computed style guarantees. */
function box(el) {
  const cs = win.getComputedStyle(el)
  const fs = n0(cs.fontSize) || 16
  const lh = Number.isFinite(px(cs.lineHeight)) ? px(cs.lineHeight) : (Number(cs.lineHeight) || 1.2) * fs
  const icons = [...el.querySelectorAll('svg')]
  const iconH = Math.max(0, ...icons.map(s => Number(s.getAttribute('height')) || 0))
  const iconW = Math.max(0, ...icons.map(s => Number(s.getAttribute('width')) || 0))
  const text = el.textContent.trim()
  const padY = n0(cs.paddingTop) + n0(cs.paddingBottom) + n0(cs.borderTopWidth) + n0(cs.borderBottomWidth)
  const padX = n0(cs.paddingLeft) + n0(cs.paddingRight) + n0(cs.borderLeftWidth) + n0(cs.borderRightWidth)
  const h = Math.max(n0(cs.minHeight), n0(cs.height), padY + Math.max(text ? lh : 0, iconH))
  // Text and icons side by side: the icon, the gap, then the words at their narrowest.
  const textW = text ? text.length * fs * TEXT_EM : 0
  const gap = text && iconW ? n0(cs.columnGap) || n0(cs.gap) : 0
  // A box its container sizes (a stretched segment, a full-width button) is as wide as
  // that container, which happy-dom cannot measure: judged on its height only.
  const pc = el.parentElement ? win.getComputedStyle(el.parentElement) : null
  // A flex column's or a one-column grid's child is stretched across it, unless told not to be.
  const stretched = pc && ((/flex/.test(pc.display) && /column/.test(pc.flexDirection)
      && !/start|center|end|baseline/.test(`${cs.alignSelf} ${pc.alignItems}`))
    || (/grid/.test(pc.display) && !/\s/.test(String(pc.gridTemplateColumns || 'none').trim())
      && !/start|center|end/.test(`${cs.justifySelf} ${pc.justifyItems}`)))
  const byContainer = Number(cs.flexGrow) > 0 || /%$/.test(cs.width) || /^(block|flex|grid)$/.test(cs.display) || stretched
  const w = byContainer ? Infinity : Math.max(n0(cs.minWidth), n0(cs.width), padX + iconW + gap + textW)
  return { h, w }
}

// Not targets on their own, each for its stated reason.
const NOT_JUDGED = [
  ['.done-chip, .share-chip', 'the header chips reach 44 through ::after (smoke/system.jsx allows them by name)'],
  ['.progpick-sel', 'a transparent select laid over its whole 56px row'],
  ['[disabled]', 'a disabled control is not pressed'],
]
const judged = (el) => !NOT_JUDGED.some(([sel]) => el.matches(sel))

function under(root, where) {
  const bad = []
  for (const el of root.querySelectorAll('button, select, a.btn, [role="button"], [role="tab"]')) {
    if (hidden(el) || !judged(el)) continue
    const { h, w } = box(el)
    if (h < 44 || w < 44) {
      const name = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.className
      bad.push(`${where}: ${el.tagName.toLowerCase()}.${String(el.className).split(' ').filter(Boolean).join('.')} "${name}" ${w === Infinity ? 'full' : Math.round(w)}×${Math.round(h)}`)
    }
  }
  return bad
}

async function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<PlanProvider plan={plan}>{el}</PlanProvider>))
  return { host, done: () => act(() => root.unmount()).then(() => host.remove()) }
}

/* ------------------------------------------------------------ screens */

const board = () => buildSteps(plan.dailyMenu.find(m => m.id === 'board') || plan.dailyMenu.find(m => m.logSpec?.climbs), {})
  .find(s => s.kind === 'set' || s.fields) || buildSteps(plan.dailyMenu.find(m => m.id === 'board'), {})[0]
const climbing = plan.dailyMenu.find(m => m.id === 'limit-boulder') || plan.dailyMenu.find(m => (m.protocol?.sections || m.protocol) && /boulder/i.test(m.name))

const SCREENS = [
  ['Today', <TodayTab plan={plan} entries={rich} upsertEntry={noop} deleteEntry={noop} />],
  ['the Log', <LogTab plan={plan} entries={rich} upsertEntry={noop} deleteEntry={noop} />],
  ['Progress under Climbing', <ProgressView plan={plan} entries={rich}
    initialScope={{ activity: 'climbing', category: null, session: null, exercise: null, band: null, weeks: null }} />],
  ['the + menu', <FabMenu onClose={noop} onPlan={noop} onLog={noop} onRest={noop} onTimer={noop} />],
  ['a climbing card’s sections', <SessionView session={climbing} entries={rich} />],
  ['workout mode’s review, each problem logged', <Review step={board()} draft={{ reps: 3, seconds: 104, climbs: [
    { grade: 4, fell: false, felt: '', style: '' }, { grade: 5, fell: true, felt: '', style: '' }, { grade: 4, fell: false, felt: '', style: '' }] }}
    onDraft={noop} onCommit={noop} isLastSet={false} />],
  ['the runner’s set screen', <WorkoutRunner session={PLANNED_CARD} entry={PLANNED_ENTRY} entries={rich} onRun={noop} onExit={noop} />],
]

let failed = 0
const all = []
for (const [where, el] of SCREENS) {
  const r = await render(el)
  const found = r.host.querySelectorAll('button').length
  try {
    assert.ok(found > 0, `${where} rendered no buttons, so this proves nothing`)
    all.push(...under(r.host, where))
    console.log(`  ok  ${where}: ${found} buttons measured`)
  } catch (e) { failed += 1; console.log(`  FAIL ${where}\n       ${e.message}`) }
  await r.done()
}
// The two the regrade measured, rendered, so a fixture change cannot quietly skip them.
{
  const r = await render(SCREENS[5][1])
  if (!r.host.querySelector('.wo-repstep .repstep-b')) { failed += 1; console.log('  FAIL workout mode’s rep ± did not render') }
  await r.done()
  const s = await render(SCREENS[4][1])
  if (!s.host.querySelector('.sect-chip')) { failed += 1; console.log('  FAIL the section chips did not render') }
  await s.done()
}
if (all.length) {
  failed += 1
  console.log(`  FAIL targets under 44 at ${W}px:\n       ${all.join('\n       ')}`)
}
win.happyDOM?.abort?.()
console.log(failed ? `${failed} target checks failed` : `${SCREENS.length} screens: every target 44 or more at ${W}px`)
process.exit(failed ? 1 : 0)
