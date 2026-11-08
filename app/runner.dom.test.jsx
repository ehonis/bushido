// The runner in a real DOM (happy-dom), driven tap by tap: the screen the owner
// edits weights on mid-workout (#98). These are CHARACTERISATION tests, written
// against the runner before its writes moved into lib/runflow.js, and kept to
// prove the move changed nothing: every tap's write (the run, the log, the done
// flag, the plan), where the cursor lands, what the boxes hold, and which cue
// sounds. The host applies each write the way the app does (`applyRun`, the one
// writer), so a stale-closure double write shows up as a wrong entry here.
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

// The clock, moved by hand: every value on the runner's screen is Date.now() minus an instant.
const realNow = Date.now
let skew = 0
Date.now = () => realNow() + skew

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { WorkoutRunner } = await import('./src/runner.jsx')
const { HowSheet } = await import('./src/howto.jsx')
const { lazyPart, WARM_MS, LoadFailed } = await import('./src/lazy.jsx')
const { PlanProvider } = await import('./src/lib/planctx.jsx')
const { CUES } = await import('./src/lib/cues.js')
const { normalizePrescription, prescriptionSteps } = await import('./src/lib/prescription.js')
const { liftFieldOf } = await import('./src/lib/lifts.js')
const { applyRun } = await import('./src/lib/trainer.js')
const { useToasts } = await import('./src/lib/toast.js')
const require = createRequire(import.meta.url)
const { mergeLibrary } = require('../server/library.js')
const PLAN = mergeLibrary(require('../test/fixtures/plan.json'), require('../test/fixtures/exercises.json'))
const CARD = PLAN.dailyMenu.find(m => m.id === 'planned')
const LIFTS = liftFieldOf(PLAN)
const SQUAT = LIFTS.exercises.find(e => /squat/i.test(e.name))

// Which cue sounded, in order.
let heard = []
for (const k of Object.keys(CUES)) CUES[k] = () => heard.push(k)

const tests = []
const test = (name, fn) => tests.push([name, fn])
const wait = (ms) => act(() => new Promise(r => setTimeout(r, ms)))

const TODAY = new Date().toISOString().slice(0, 10)
const LEGS = normalizePrescription({
  title: 'Legs', blocks: [
    { name: 'Warm-up', note: 'Ten minutes, nothing heavy.',
      items: [{ kind: 'interval', name: 'Bike easy', sets: [{ seconds: 600, restSec: 0 }] }] },
    { name: 'Main', items: [{
      kind: 'lift', name: 'Back squat', exercise: SQUAT.key, implement: 'barbell',
      sets: [{ reps: 8, weight: 135, restSec: 90 }, { reps: 8, weight: 135, restSec: 90 }, { reps: 6, weight: 155, restSec: 120 }],
    }] },
  ],
}, { liftField: LIFTS })
const ROWS = normalizePrescription({
  title: 'Rows', blocks: [{ name: 'Main', items: [
    { kind: 'interval', name: 'Row 500', sets: [{ distance: 500, unit: 'm', restSec: 60 }, { distance: 500, unit: 'm', restSec: 60 }] },
  ] }],
}, { liftField: LIFTS })
const CORE = normalizePrescription({
  title: 'Core', blocks: [{ name: 'Main', items: [
    { kind: 'lift', exercise: 'plank', implement: 'bodyweight', sets: [{ seconds: 45 }, { seconds: 45 }] },
  ] }],
}, { liftField: LIFTS })
const MIXED = normalizePrescription({
  title: 'Mixed', blocks: [
    { name: 'Finisher', circuit: { work: 30, rest: 15, rounds: 2 }, items: [
      { kind: 'lift', name: 'Crunch', sets: [{}] }, { kind: 'lift', name: 'Plank', sets: [{ seconds: 20 }] },
    ] },
    { name: 'Main', items: [{ kind: 'lift', name: 'Back squat', exercise: SQUAT.key, implement: 'barbell', sets: [{ reps: 5, weight: 100 }] }] },
  ],
}, { liftField: LIFTS })
const entryOf = (plan, run = null) => ({
  id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
  data: { slot: 'main', optId: 'planned', name: plan.title, done: false, plan, out: { activity: 'lift', category: 'lift' }, ...(run ? { run } : {}) },
})

let unmountLast = null
/** Mount a runner whose host applies every write as the app does, and records it. */
async function mount(start, props = {}) {
  const writes = []
  const calls = { exit: 0, finish: 0 }
  const state = { entry: start }
  function Host() {
    const [entry, setEntry] = useState(start)
    state.entry = entry
    return (
      <PlanProvider plan={PLAN}>
        <WorkoutRunner session={CARD} entry={entry} entries={[]}
          onRun={(run, opts) => {
            writes.push({ run, opts })
            setEntry(cur => (run ? applyRun(cur, CARD, run, opts) : { ...cur, data: { ...cur.data, run: null } }))
          }}
          onExit={() => { calls.exit += 1 }} onFinish={() => { calls.finish += 1 }} {...props} />
      </PlanProvider>
    )
  }
  if (unmountLast) await unmountLast()
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  unmountLast = () => { unmountLast = null; return act(() => root.unmount()) }
  heard = []
  await act(async () => root.render(<Host />))
  return { host, writes, calls, state, last: () => writes.at(-1), done: () => unmountLast?.() }
}

const click = (el) => act(() => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
const buttons = () => [...document.querySelectorAll('button')]
const byText = (re) => buttons().find(b => re.test(b.textContent.trim()))
const byLabel = (re) => buttons().find(b => re.test(b.getAttribute('aria-label') || ''))
const tapText = async (re) => { const b = byText(re); assert.ok(b, `no button ${re}`); await click(b) }
const tapLabel = async (re) => { const b = byLabel(re); assert.ok(b, `no button labelled ${re}`); await click(b) }
const box = (which) => document.querySelectorAll('.bigstep-in')[which === 'weight' ? 1 : 0]
const typeInto = (input, value) => act(() => {
  const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set
  set.call(input, value)
  input.dispatchEvent(new win.Event('input', { bubbles: true }))
})
const where = () => document.querySelector('.run-where span')?.textContent || ''
const steps = (p) => prescriptionSteps(p)

/* --------------------------------------------------------------- marking */

test('Done set writes the set, the log and the cursor in ONE write, and moves on', async () => {
  const r = await mount(entryOf(LEGS))
  const [bike, s1, s2] = steps(LEGS)
  assert.match(where(), /Warm-up · Set 1 of 1/)
  await tapText(/Log this set without the clock/)
  assert.equal(r.writes.length, 1, 'marking a set is one write')
  const w = r.last()
  assert.ok(w.run.sets[bike.setId], 'the set is not on the run')
  assert.equal(w.run.cursor, s1.setId)
  assert.ok(w.opts.out, 'the log was not written with the set')
  assert.equal(w.opts.done, undefined, 'marking a set says nothing about done')
  assert.deepEqual(heard, ['setDone'])
  assert.match(where(), /Main · Set 1 of 3/, 'the screen did not move on')
  // The boxes hold the plan's numbers for an untouched set.
  assert.equal(box('reps').value, '8')
  assert.equal(box('weight').value, '135')
  // A weight typed, then Done set: the typed number is what is logged.
  await typeInto(box('weight'), '140')
  assert.equal(r.writes.length, 1, 'typing wrote the entry')
  await tapText(/^Done set$/)
  const m = r.last()
  assert.equal(m.run.sets[s1.setId].weight, 140)
  assert.equal(m.run.sets[s1.setId].reps, 8)
  // A lift has no programmed rest (AGENTS.md §6.4): straight on to the next set.
  assert.ok(!m.run.restUntil, 'a lift set started a rest')
  const row = m.opts.out.lifts.find(l => l.exercise === SQUAT.key || l.key === SQUAT.key || l.name === 'Back squat')
  assert.ok(row, 'the log has no squat row')
  assert.equal(row.sets[0].weight, 140)
  assert.equal(r.state.entry.data.run.sets[s1.setId].weight, 140, 'the entry lost the set')
  assert.ok(r.state.entry.data.run.sets[bike.setId], 'the second write took the first set with it')
  assert.match(where(), /Main · Set 2 of 3/)
  assert.equal(box('weight').value, '140', 'the next set does not carry what was lifted')
  assert.equal(r.state.entry.data.run.cursor, s2.setId)
  await r.done()
})

test('Skip a set: skipped on the run, cursor on, the log untouched; All sets puts it back', async () => {
  const r = await mount(entryOf(LEGS))
  const [bike, s1] = steps(LEGS)
  await tapLabel(/^Skip set 1 of Bike easy$/)
  const w = r.last()
  assert.ok((w.run.skipped || []).includes(bike.setId))
  assert.equal(w.run.cursor, s1.setId)
  assert.equal(w.opts.out, null, 'a skip rewrote the log')
  assert.deepEqual(heard, [])
  assert.match(where(), /Main · Set 1 of 3/)
  await tapText(/^All sets$/)
  await tapLabel(/^Put set 1 of Bike easy back$/)
  assert.ok(!(r.last().run.skipped || []).includes(bike.setId), 'the skip stayed')
  assert.match(where(), /Warm-up · Set 1 of 1/, 'putting a set back does not go to it')
  await r.done()
})

test('Undo this set and All sets: unmark writes the log, a jump moves the cursor and closes the list', async () => {
  const r = await mount(entryOf(LEGS))
  const [bike, s1, , s3] = steps(LEGS)
  await tapText(/Log this set without the clock/)
  await tapText(/^All sets$/)
  assert.ok(document.querySelector('[role=dialog][aria-label="All sets"]'))
  await tapLabel(/^Undo set 1 of Bike easy$/)
  const u = r.last()
  assert.equal(u.run.sets[bike.setId], undefined, 'the set is still marked')
  assert.ok(u.opts.out, 'an unmark did not rewrite the log')
  // The jump.
  const n = r.writes.length
  const go = [...document.querySelectorAll('.setlist-go')]
  assert.equal(go.length, 4)
  await click(go[3])
  assert.equal(r.writes.length, n + 1)
  assert.equal(r.last().run.cursor, s3.setId)
  assert.equal(r.last().opts.out, null)
  assert.equal(document.querySelector('[role=dialog][aria-label="All sets"]'), null, 'the list stayed open')
  assert.match(where(), /Main · Set 3 of 3/)
  assert.equal(box('weight').value, '155')
  void s1
  await r.done()
})

test('Undo this set on a marked set, from the set screen', async () => {
  const [bike, s1] = steps(LEGS)
  const r = await mount(entryOf(LEGS))
  await tapText(/Log this set without the clock/)
  await tapText(/^All sets$/)
  await click(document.querySelectorAll('.setlist-go')[0])
  assert.match(where(), /Warm-up · Set 1 of 1/)
  await tapText(/^Undo this set$/)
  assert.equal(r.last().run.sets[bike.setId], undefined)
  assert.match(where(), /Warm-up · Set 1 of 1/, 'the cursor left the set being undone')
  void s1
  await r.done()
})

test('Add a set: the plan grows by one set like the boxes, nothing else moves', async () => {
  const r = await mount(entryOf(LEGS))
  await tapText(/Log this set without the clock/)
  await typeInto(box('weight'), '150')
  const before = r.state.entry.data.run
  await tapLabel(/^One more set of Back squat, same as this one$/)
  const w = r.last()
  const squat = w.opts.plan.blocks[1].items[0]
  assert.equal(squat.sets.length, 4)
  assert.equal(squat.sets[3].weight, 150, 'the new set is not what is in the boxes')
  assert.deepEqual(w.run, before, 'adding a set changed the run')
  assert.equal(w.opts.out, undefined)
  assert.match(where(), /Main · Set 1 of 4/)
  assert.equal(box('weight').value, '150', 'the draft was reset by adding a set')
  await r.done()
})

test("The weight's meaning: one write to the plan, the boxes untouched", async () => {
  const r = await mount(entryOf(LEGS))
  await tapText(/Log this set without the clock/)
  await typeInto(box('weight'), '45')
  const sw = byLabel(/^Weight is .*Switch to /)
  assert.ok(sw, 'no meaning switch on a barbell')
  await click(sw)
  const w = r.last()
  assert.ok(w.opts.plan, 'the switch did not write the plan')
  assert.ok(w.opts.plan.blocks[1].items[0].weightMode, 'the plan item has no mode')
  assert.equal(box('weight').value, '45', 'the switch reset the box')
  await r.done()
})

/** The toasts on screen, as the shell's deck would show them, each with its action as a button. */
function Toasts() {
  return <div className="probe-toasts">{useToasts().map(t => (
    <p key={t.id}>{t.text}{t.action && <button type="button" onClick={t.action.onClick}>{t.action.label}</button>}</p>
  ))}</div>
}

test("#111 B F1: the runner's meaning switch says what it did, with Undo, and sits by the implement, not the number", async () => {
  const r = await mount(entryOf(LEGS))
  await tapText(/Log this set without the clock/)
  const probe = document.createElement('div')
  document.body.appendChild(probe)
  const toasts = createRoot(probe)
  await act(async () => toasts.render(<Toasts />))
  const sw = byLabel(/^Weight is .*Switch to /)
  assert.ok(sw.closest('.run-impl'), 'the switch is not beside the implement')
  assert.equal(sw.closest('.run-inputs'), null, 'the switch is in the number boxes')
  assert.deepEqual([...document.querySelectorAll('.run-inputs .bigstep-label')].map(x => x.textContent), ['reps', 'lb'], 'the big weight says more than its unit')
  const before = r.state.entry.data.plan.blocks[1].items[0].weightMode ?? null
  await click(sw)
  const flipped = r.state.entry.data.plan.blocks[1].items[0].weightMode ?? null
  assert.notEqual(flipped, before, 'the switch wrote nothing')
  // The newest: an earlier case's flip may still be showing its own.
  const note = [...probe.querySelectorAll('p')].filter(p => /Back squat: weight now /.test(p.textContent)).at(-1)
  assert.ok(note, 'the flip was silent')
  const undo = [...note.querySelectorAll('button')].find(b => /Undo/.test(b.textContent))
  assert.ok(undo, 'the flip offers no Undo')
  await click(undo)
  assert.equal(r.state.entry.data.plan.blocks[1].items[0].weightMode ?? null, before, 'Undo did not put the meaning back')
  await act(() => toasts.unmount())
  await r.done()
})

/* --------------------------------------------------------------- a hold */

test('A timed set: Start writes the clock, Stop clears it and logs nothing, the end marks the seconds held', async () => {
  skew = 0
  const r = await mount(entryOf(CORE))
  const [p1, p2] = steps(CORE)
  await tapText(/^Start 0:45$/)
  assert.ok(r.last().run.hold, 'Start did not put the clock on the run')
  assert.equal(r.last().run.hold.setId, p1.setId)
  await tapLabel(/^Stop the clock, log nothing$/)
  assert.equal(r.last().run.hold, null)
  assert.equal(r.last().run.sets?.[p1.setId], undefined, 'stopping logged the set')
  assert.ok(byText(/^Start 0:45$/), 'not back on the set screen')
  // Started again and left to run out.
  await tapText(/^Start 0:45$/)
  heard = []
  skew += 120_000
  await wait(400)
  const w = r.last()
  assert.equal(w.run.hold, null, 'the finished clock stayed on the run')
  assert.equal(w.run.sets[p1.setId].seconds, 45)
  assert.equal(w.run.cursor, p2.setId)
  assert.ok(w.opts.out, 'the held seconds are not in the log')
  assert.ok(heard.includes('setDone'), 'the end of a hold did not sound')
  assert.match(where(), /Set 2 of 2/)
  skew = 0
  await r.done()
})

/* ------------------------------------------------------------ the rest */

test('The rest: it starts off an interval set; +10 moves it, Pause holds it, Back returns, Skip ends it', async () => {
  const r = await mount(entryOf(ROWS))
  const [s1, s2] = steps(ROWS)
  await tapText(/^Done set$/)
  const until = r.last().run.restUntil
  assert.ok(until > Date.now(), 'the rest did not start off the set')
  assert.equal(r.last().run.cursor, s2.setId)
  assert.match(document.querySelector('.rest-label').textContent, /^Rest/)
  assert.match(document.querySelector('.rest-next').textContent, /Set 2 of 2/)
  await tapLabel(/^10 seconds more$/)
  assert.equal(r.last().run.restUntil, until + 10_000)
  assert.equal(r.last().opts.out, null, 'a clock nudge recomputed the log')
  await tapLabel(/^Pause$/)
  assert.ok(r.last().run.restPause, 'the rest is not paused')
  assert.match(document.querySelector('.rest-label').textContent, /paused/)
  await tapLabel(/^Resume$/)
  await tapLabel(/^Back$/)
  assert.equal(r.last().run.restUntil || 0, 0)
  assert.equal(r.last().run.cursor, s1.setId)
  assert.match(where(), /Main · Set 1 of 2/, 'Back did not return to the set just done')
  assert.ok(byText(/^Undo this set$/), 'Back unmarked the set just done')
  await tapText(/^All sets$/)
  await click(document.querySelectorAll('.setlist-go')[1])
  await tapText(/^Done set$/)
  assert.ok(r.last().run.restUntil > Date.now())
  // The rest after the LAST set names no next set (it used to name the set just done).
  assert.equal(document.querySelector('.rest-next').textContent, 'That was the last set.')
  await tapLabel(/^Skip the rest$/)
  assert.equal(r.last().run.restUntil || 0, 0)
  assert.equal(r.last().opts.out, null)
  await r.done()
})

/* ---------------------------------------------------------- finishing */

test('Finish: one write with the log, done and an end; then onFinish', async () => {
  const r = await mount(entryOf(LEGS))
  await tapText(/Log this set without the clock/)
  for (let i = 0; i < 3; i += 1) {
    await tapText(/^Done set$/)
    if (byLabel(/^Skip the rest$/)) await tapLabel(/^Skip the rest$/)
  }
  assert.ok(byText(/^That is everything$/) || document.querySelector('.finish'), 'not on the finish screen')
  heard = []
  const n = r.writes.length
  await tapText(/^Finish workout$/)
  assert.equal(r.writes.length, n + 1, 'finishing is one write')
  const w = r.last()
  assert.equal(w.opts.done, true)
  assert.ok(w.opts.out)
  assert.ok(w.run.endedAt, 'no end on the run')
  assert.equal(r.calls.finish, 1)
  assert.equal(r.calls.exit, 0)
  assert.deepEqual(heard, ['finished'])
  await r.done()
})

test('Leaving: Keep going writes nothing; Finish with sets left asks again; Leave it open exits', async () => {
  const r = await mount(entryOf(LEGS))
  await tapText(/Log this set without the clock/)
  const n = r.writes.length
  await tapLabel(/^Leave the workout$/)
  assert.ok(document.querySelector('[role=dialog][aria-label="Leave the workout?"]'))
  await tapText(/^Keep going$/)
  assert.equal(document.querySelector('[role=dialog]'), null)
  assert.equal(r.writes.length, n)
  await tapLabel(/^Leave the workout$/)
  await tapText(/^Finish with 3 sets left$/)
  assert.ok(document.querySelector('[role=dialog][aria-label="Finish with 3 sets left?"]'))
  await tapText(/^Finish anyway$/)
  assert.equal(r.last().opts.done, true)
  assert.ok(r.last().run.endedAt)
  assert.equal(r.calls.finish, 1)
  await r.done()
  const again = await mount(entryOf(LEGS))
  await tapLabel(/^Leave the workout$/)
  await tapText(/^Leave it open$/)
  assert.equal(again.calls.exit, 1)
  assert.equal(again.writes.length, 0)
  await again.done()
})

test('A finished run opened again: the first set marked takes the end off', async () => {
  const [bike] = steps(LEGS)
  const r = await mount(entryOf(LEGS, { startedAt: Date.now() - 600_000, endedAt: Date.now() - 60_000, sets: {}, skipped: [], cursor: bike.setId }))
  await tapText(/Log this set without the clock/)
  assert.equal(r.last().run.endedAt ?? null, null, 'the run still reads finished')
  await r.done()
})

/* ------------------------------------------------------------- circuits */

test('Skip a circuit in a mixed plan asks first, then marks it skipped and moves on', async () => {
  const r = await mount(entryOf(MIXED))
  assert.ok(byText(/^Start the circuit$/), 'the circuit step is not shown')
  await tapLabel(/^Skip Finisher$/)
  assert.ok(document.querySelector('[role=dialog][aria-label="Skip Finisher?"]'))
  assert.equal(r.writes.length, 0, 'asking wrote something')
  await tapText(/^Skip the circuit$/)
  const w = r.last()
  const [c1, c2, main] = steps(MIXED)
  assert.ok([c1, c2].every(s => (w.run.skipped || []).includes(s.setId)), 'the circuit is not skipped')
  assert.equal(w.run.cursor, main.setId)
  assert.match(where(), /Main · Set 1 of 1/)
  await r.done()
})

test('Start the circuit opens its timer, and starting is a write', async () => {
  const r = await mount(entryOf(MIXED))
  await tapText(/^Start the circuit$/)
  assert.ok(r.last()?.run?.circuit, 'starting the circuit wrote no clock')
  assert.equal(r.last().run.circuit.block, MIXED.blocks[0].id)
  await r.done()
})

test('A circuit run to its end logs every round in one write and says so', async () => {
  skew = 0
  const r = await mount(entryOf(MIXED))
  await tapText(/^Start the circuit$/)
  const startedAt = r.last().run.circuit.timer.startedAt
  skew += 10 * 60_000
  await wait(600)
  const w = r.writes.find(x => x.run && x.run.circuit === null && x.opts.out)
  assert.ok(w, 'the end of the circuit wrote no log')
  const [c1, c2, main] = steps(MIXED)
  assert.ok(w.run.sets[c1.setId] && w.run.sets[c2.setId], 'the circuit\'s sets are not marked')
  assert.equal(w.run.circuitKeys?.[MIXED.blocks[0].id], startedAt, 'the result is not keyed by its clock')
  assert.equal(w.opts.done, undefined, 'a mixed plan was finished by its circuit')
  assert.equal(w.run.cursor ?? main.setId, main.setId)
  assert.ok(document.body.textContent.includes('Logged on this workout'), 'the end does not say it was logged')
  skew = 0
  await r.done()
})

test('Sound: muted, a set marks in silence; a side not on screen never sounds', async () => {
  const r = await mount(entryOf(LEGS))
  await tapLabel(/^Turn sound off$/)
  await tapText(/Log this set without the clock/)
  assert.deepEqual(heard, [], 'a muted runner sounded')
  assert.ok(r.last().run.sets, 'muted, the set was not written')
  await r.done()
  const hidden = await mount(entryOf(LEGS), { shown: false })
  await tapText(/Log this set without the clock/)
  assert.deepEqual(heard, [], 'a hidden side sounded')
  assert.equal(hidden.writes.length, 1)
  await hidden.done()
})

test("All sets is the shell's Popover: the scrim and Escape close it, and only it", async () => {
  const r = await mount(entryOf(LEGS))
  await tapText(/^All sets$/)
  const dialog = () => document.querySelector('[role=dialog][aria-label="All sets"]')
  assert.ok(dialog(), 'All sets did not open')
  assert.equal(document.querySelector('.setlist-scrim'), null, 'its own scrim is back')
  const scrim = dialog().closest('.pop-scrim')
  assert.ok(scrim, 'All sets is not in the shell\'s Popover')
  await click(scrim)
  assert.equal(dialog(), null, 'a tap on the scrim did not close it')
  assert.match(where(), /Warm-up · Set 1 of 1/, 'the runner went with it')
  await tapText(/^All sets$/)
  await act(() => { document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.equal(dialog(), null, 'Escape did not close it')
  assert.equal(document.querySelector('[role=dialog][aria-label="Leave the workout?"]'), null)
  assert.equal(r.writes.length, 0, 'opening and closing the list wrote something')
  await r.done()
})

test("The how-to is the shell's Popover too: the scrim, Escape and Got it close it", async () => {
  if (unmountLast) await unmountLast()
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let closed = 0
  await act(async () => root.render(<HowSheet title="Max hang" how={{ gist: 'Hang.', steps: ['Grip', 'Hang'] }} onClose={() => { closed += 1 }} />))
  const dialog = document.querySelector('[role=dialog][aria-label="How to do Max hang"]')
  assert.ok(dialog, 'the how-to did not open')
  assert.equal(document.querySelector('.how-scrim'), null, 'its own scrim is back')
  await click(dialog.closest('.pop-scrim'))
  assert.equal(closed, 1, 'a tap on the scrim did not close it')
  await act(() => { document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.equal(closed, 2, 'Escape did not close it')
  await click(document.querySelector('.how-got'))
  assert.equal(closed, 3, 'Got it did not close it')
  await act(() => root.unmount())
})

test('A lazy part is fetched ahead; failing to load, an always-mounted one draws NOTHING, an opened screen says so in itself and Try again draws it', async () => {
  if (unmountLast) await unmountLast()
  document.body.innerHTML = ''
  let calls = 0, fail = true
  const load = () => { calls += 1; return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ Hello: ({ who }) => <p className="hello">Hello {who}</p> }) }
  // Always mounted (WHOOP on Today, a timer resumed in the background): no `failed`.
  const Quiet = lazyPart(load, 'Hello')
  // A screen the user opened: its own frame, the words, Try again, its way out.
  const Screen = lazyPart(load, 'Hello', {
    failed: (props, retry) => (
      <section className="opened" aria-label="Plan a workout">
        <button type="button" onClick={props.onClose}>Back</button>
        <LoadFailed what="Plan a workout" onRetry={retry} />
      </section>
    ),
  })
  await wait(WARM_MS + 100)
  assert.equal(calls, 2, 'the parts were not fetched ahead of being drawn')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const quiet = console.error
  console.error = () => {}
  let closed = 0
  try {
    await act(async () => root.render(<><button type="button" className="fab">+</button><Quiet who="Sam" /></>))
    await wait(50)
    assert.equal(host.querySelector('.lazy-failed'), null, 'an always-mounted part that failed to load put a card over the app')
    assert.equal(host.innerHTML, '<button type="button" class="fab">+</button>', 'an always-mounted part that failed to load drew something')
    await act(async () => root.render(<Screen who="Sam" onClose={() => { closed += 1 }} />))
    await wait(50)
    const card = host.querySelector('.opened .lazy-failed')
    assert.ok(card, 'an opened screen that failed to load said nothing, or said it outside itself')
    assert.match(card.textContent, /Plan a workout did not load/)
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Back'))
    assert.equal(closed, 1, 'no way out of a screen that did not load')
    fail = false
    await click([...host.querySelectorAll('button')].find(b => /Try again/.test(b.textContent)))
    await wait(50)
    assert.equal(host.querySelector('.hello')?.textContent, 'Hello Sam', 'Try again did not load it')
  } finally { console.error = quiet }
  await act(() => root.unmount())
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (e) { failed += 1; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`) }
}
win.happyDOM?.abort?.()
console.log(failed ? `${failed} of ${tests.length} runner DOM cases failed` : `${tests.length} runner DOM cases`)
process.exit(failed ? 1 : 0)
