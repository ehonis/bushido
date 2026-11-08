// The footer policy in a real DOM (happy-dom), for EACH layer that has a footer:
// the session sheet (`Modal`) and the planner (`FullScreen`'s sticky bar). The
// owner's bug class (#77) and its sequel (C N1, reproduced by the G regrade in
// both): a box that has focus is REMOVED, as the exercise picker's search box
// is when an exercise is picked, and on iOS the row tapped takes no focus, so
// no blur reaches React and the footer stayed hidden with nothing saying why.
// Bundled by esbuild (JSX) and run in node.
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost/' })
// A finger, not a mouse: the footer only hides on a touch screen.
win.matchMedia = (q) => ({ matches: /coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
for (const k of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'HTMLIFrameElement', 'Node', 'Event', 'getComputedStyle']) {
  const value = k === 'window' ? win : k === 'getComputedStyle' ? win.getComputedStyle.bind(win) : win[k]
  Object.defineProperty(globalThis, k, { value, configurable: true, writable: true })
}
win.scrollTo = () => {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Modal, FullScreen, Popover, EDIT_SETTLE_MS } = await import('./src/modal.jsx')

const tests = []
const test = (name, fn) => tests.push([name, fn])
const wait = (ms) => act(() => new Promise(r => setTimeout(r, ms)))

/** The picker's shape: a search box, and a row that takes it away when tapped (no focus moves). */
function Picker() {
  const [open, setOpen] = useState(true)
  return (
    <>
      {open && <input type="search" aria-label="Search exercises" />}
      <button type="button" className="row" onClick={() => setOpen(false)}>Goblet squat</button>
      <input type="number" aria-label="Weight" />
    </>
  )
}

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(el))
  return { host, done: () => act(() => root.unmount()) }
}

const focusOn = (el) => act(() => { el.focus() })
const tapRow = (host) => act(() => { host.querySelector('.row').dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })

test('the session sheet: its footer comes back after the focused search box is removed', async () => {
  const { host, done } = await mount(
    <Modal title="Back squat" onClose={() => {}} footer={<button type="button">Start workout</button>}><Picker /></Modal>)
  assert.ok(host.querySelector('.modal-foot'), 'a sheet at rest has its footer')
  await focusOn(host.querySelector('input[type=search]'))
  assert.equal(host.querySelector('.modal-foot'), null, 'the footer stays up while a box has focus')
  await tapRow(host)
  assert.equal(host.querySelector('input[type=search]'), null)
  await wait(EDIT_SETTLE_MS + 150)
  assert.ok(host.querySelector('.modal-foot'), 'the sheet’s footer stayed hidden after the focused box went (C N1)')
  await done()
})

test('the planner: its sticky bar comes back after the focused search box is removed', async () => {
  const { host, done } = await mount(
    <FullScreen title="Workout" onBack={() => {}}><Picker /><div className="plan-actions sticky"><button type="button">Add to Today</button></div></FullScreen>)
  const fs = () => host.querySelector('.fs')
  await focusOn(host.querySelector('input[type=search]'))
  assert.ok(fs().hasAttribute('data-editing'), 'the bar stays up while a box has focus')
  await tapRow(host)
  await wait(EDIT_SETTLE_MS + 150)
  assert.equal(fs().hasAttribute('data-editing'), false, 'the planner’s keep bar stayed hidden after the focused box went (C N1)')
  await done()
})

/** A block's ⋯ (editor.jsx BlockMenu): a popover portalled to the body, its name box focused. */
function WithMenu() {
  const [open, setOpen] = useState(true)
  return (
    <>
      {open && <Popover label="Main: block options" onClose={() => setOpen(false)} over><input aria-label="Block name" /></Popover>}
      <button type="button" className="row" onClick={() => setOpen(false)}>Close</button>
    </>
  )
}

test('the planner: a focused box in a popover over it, closed by its X, brings the bar back', async () => {
  const { host, done } = await mount(
    <FullScreen title="Workout" onBack={() => {}}><WithMenu /><div className="plan-actions sticky" /></FullScreen>)
  await focusOn(document.querySelector('input[aria-label="Block name"]'))
  assert.ok(host.querySelector('.fs').hasAttribute('data-editing'))
  await tapRow(host)
  assert.equal(document.querySelector('input[aria-label="Block name"]'), null)
  await wait(EDIT_SETTLE_MS + 150)
  assert.equal(host.querySelector('.fs').hasAttribute('data-editing'), false, 'a box closed away in a portal left the bar hidden')
  await done()
})

test('both layers: a box still focused after the change keeps the footer hidden', async () => {
  const { host, done } = await mount(
    <Modal title="Back squat" onClose={() => {}} footer={<button type="button">Start workout</button>}><Picker /></Modal>)
  await focusOn(host.querySelector('input[type=number]'))
  await tapRow(host)  // the search box goes; the weight box still has focus
  await wait(EDIT_SETTLE_MS + 150)
  assert.equal(host.querySelector('.modal-foot'), null, 'the footer came back under a box still being typed in')
  await done()
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  PASS  ${name}`) } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
console.log(`editing (dom): ${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`)
await win.happyDOM.close()
process.exit(failed ? 1 : 0)
