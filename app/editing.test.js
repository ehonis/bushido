// The footer policy's memory (modal.jsx `editWatch`, #77, C N1): the footer hides
// while a box has focus and comes back once nothing is being typed into, even
// when the focused box is REMOVED from the page and no blur ever fires (the
// exercise picker's search box, the moment an exercise is picked). Bundled by
// esbuild (modal.jsx is JSX) and run in node, with a fake page.
import assert from 'node:assert/strict'
import { editWatch, EDIT_SETTLE_MS } from './src/modal.jsx'

const tests = []
const test = (name, fn) => tests.push([name, fn])
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const box = (type = 'number') => ({ tagName: 'INPUT', type })
const button = { tagName: 'BUTTON' }

/** A page with one thing in focus, and the footer's state as the watch sets it. */
function page({ touch = true } = {}) {
  const p = { active: null, shown: [] }
  p.watch = editWatch({
    typing: () => Boolean(p.active && p.active.tagName === 'INPUT'),
    set: (v) => p.shown.push(v),
    delay: 5,
    touch: () => touch,
  })
  p.focus = (el) => { p.active = el; p.watch.focus(el) }
  p.blur = (el, next = null) => { p.active = next; p.watch.blur(el, next) }
  return p
}

test('a focused box removed with no blur brings the footer back (C N1)', async () => {
  const p = page()
  const search = box('search')
  p.focus(search)
  assert.deepEqual(p.shown, [true])
  // The picker closes: the box is gone, focus is on the body, and nothing blurred.
  p.active = null
  p.watch.changed()
  await wait(20)
  assert.deepEqual(p.shown, [true, false], 'the footer stayed hidden after the focused box went')
})

test('a change while a box still has focus keeps the footer hidden', async () => {
  const p = page()
  const w = box()
  p.focus(w)
  p.watch.changed()
  await wait(20)
  assert.deepEqual(p.shown, [true])
})

test('box to box never shows the footer in between; letting go shows it after the settle', async () => {
  const p = page()
  const a = box()
  const b = box()
  p.focus(a)
  p.blur(a, b)
  p.focus(b)
  await wait(20)
  assert.deepEqual(p.shown, [true])
  p.blur(b, button)
  await wait(20)
  assert.deepEqual(p.shown, [true, false])
})

test('focus back inside the settle keeps it hidden; the timer re-reads the page', async () => {
  const p = page()
  const a = box()
  p.focus(a)
  p.blur(a, null)
  p.focus(a)
  await wait(20)
  assert.deepEqual(p.shown, [true])
  // A blur that lands on a box React did not report: the timer asks the page.
  p.watch.blur(a, null)
  p.active = box()
  await wait(20)
  assert.deepEqual(p.shown, [true])
})

test('a mouse never hides the footer, and a switch is not typing', async () => {
  const p = page({ touch: false })
  p.focus(box())
  const q = page()
  q.focus({ tagName: 'INPUT', type: 'checkbox' })
  q.watch.changed()
  await wait(20)
  assert.deepEqual([p.shown, q.shown], [[], []])
  assert.ok(EDIT_SETTLE_MS >= 200, 'the settle is long enough that a tap lands on what was under the finger')
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  PASS  ${name}`) } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
console.log(`editing: ${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`)
if (failed) process.exit(1)
