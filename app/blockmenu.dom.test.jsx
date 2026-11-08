// The block's ⋯ (editor.jsx BlockMenu) in a real DOM (happy-dom), driven as a
// phone drives it: a tap takes no focus, so a name being typed is never blurred
// into the plan. Every action in the menu carries it (#95 review: Circuit turned
// the block into another component and the name box reset to "New block").
// Bundled by esbuild (JSX) and run in node.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost/' })
win.matchMedia = (q) => ({ matches: /coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
for (const k of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'HTMLIFrameElement', 'HTMLInputElement', 'Node', 'Event', 'getComputedStyle', 'localStorage']) {
  const value = k === 'window' ? win : k === 'getComputedStyle' ? win.getComputedStyle.bind(win) : win[k]
  Object.defineProperty(globalThis, k, { value, configurable: true, writable: true })
}
win.scrollTo = () => {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { PrescriptionEditor } = await import('./src/editor.jsx')
const { normalizePrescription } = await import('./src/lib/prescription.js')
const { liftFieldOf } = await import('./src/lib/lifts.js')
const PLAN = createRequire(import.meta.url)('../test/fixtures/plan.json')
const liftField = liftFieldOf(PLAN)

const tests = []
const test = (name, fn) => tests.push([name, fn])

let latest = null
function Host({ start }) {
  const [pres, setPres] = useState(start)
  latest = pres
  return <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} categories={PLAN.quotaCategories} />
}

async function mount(start) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Host start={start} />))
  return () => act(() => root.unmount())
}

const click = (el) => act(() => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
const byText = (re) => [...document.querySelectorAll('button')].find(b => re.test(b.textContent.trim()))
/** Type into a controlled box the way React hears it, and never blur it (a phone's tap). */
const typeInto = (input, value) => act(() => {
  const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set
  set.call(input, value)
  input.dispatchEvent(new win.Event('input', { bubbles: true }))
})
const nameBox = () => document.querySelector('.blockmenu-name input')

const START = normalizePrescription({ title: 'Legs', blocks: [
  { name: 'Main', items: [{ kind: 'interval', name: 'Spin', sets: [{ seconds: 300 }] }] },
] }, { liftField })

test('a name being typed survives Circuit (the block becomes another component)', async () => {
  const done = await mount(START)
  await click(byText(/^Add a block$/))
  assert.equal(nameBox().value, 'New block')
  await typeInto(nameBox(), 'Finisher')
  await click(document.querySelector('.blockmenu input[role=switch]'))
  const b = latest.blocks.at(-1)
  assert.ok(b.circuit, 'Circuit did not switch on')
  assert.equal(b.name, 'Finisher', 'the name being typed was thrown away when Circuit was tapped')
  assert.equal(nameBox()?.value, 'Finisher', 'the reopened menu shows the old name')
  await done()
})

test('a name being typed goes with a move, and with Where it lands', async () => {
  const done = await mount(START)
  await click(byText(/^Add a block$/))
  await typeInto(nameBox(), 'Cool-down')
  await click(byText(/^Move block up$/))
  assert.deepEqual(latest.blocks.map(x => x.name), ['Cool-down', 'Main'], 'the move lost the name')
  await typeInto(nameBox(), 'Warm-up')
  await click(byText(/^Where it lands/))
  const run = PLAN.quotaCategories.find(c => c.key === 'run') || PLAN.quotaCategories[0]
  await click(byText(new RegExp(`^A separate ${run.name} workout$`)))
  assert.deepEqual([latest.blocks[0].name, latest.blocks[0].category], ['Warm-up', run.key])
  await done()
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  PASS  ${name}`) } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
console.log(`block menu (dom): ${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`)
await win.happyDOM.close()
process.exit(failed ? 1 : 0)
