/* One write path for a logged workout (lib/sessionops.js, #76):
 *   node app/sessionops.test.js
 *
 * Today and the Log open the same workout. Before #76 the Log's sheet wrote it
 * its own way: a MVC-7 corrected there kept its test result on the old number,
 * and a delete there left the result behind with no Undo. These run the shared
 * operations against a small in-memory store, the way both sheets call them,
 * and pin that every sheet on both platforms takes its writes from the module.
 */

import { readFileSync } from 'node:fs'
import { sessionOps, removedText, UNDO_MS } from './src/lib/sessionops.js'
import { testEntryId } from './src/lib/tests.js'
import { applyOut } from './src/lib/trainer.js'

const url = (p) => new URL(p, import.meta.url)
const plan = JSON.parse(readFileSync(url('../test/fixtures/plan.json'), 'utf8'))
const src = (p) => readFileSync(url(p), 'utf8')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const eq = (got, want, what = '') => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

/* The store's two writers, over a Map, as lib/store.js behaves: upsert replaces
   the entry whole, delete leaves a tombstone. `ops()` is built from the entries
   as they are NOW, as a sheet re-renders after every write. */
function store(initial = []) {
  const map = new Map(initial.map(e => [e.id, e]))
  const toasts = []
  const upsertEntry = (e) => { map.set(e.id, { ...e }) }
  const deleteEntry = (id) => { const p = map.get(id); if (p) map.set(id, { ...p, deleted: true }) }
  const toast = (text, kind, opts) => toasts.push({ text, kind, ...opts })
  return {
    map, toasts,
    get: (id) => map.get(id),
    ops: () => sessionOps({ plan, entries: [...map.values()], upsertEntry, deleteEntry, toast, undoIcon: 'undo' }),
  }
}

const DATE = '2026-08-11'
const mvc7 = (out) => ({ id: `daily-${DATE}`, kind: 'daily', date: DATE,
  data: { optId: 'mvc7-test', name: 'MVC-7', done: true, out } })
const RESULT = testEntryId(DATE, 'mvc7')

check('a MVC-7 corrected from the Log updates its test result', () => {
  const s = store()
  s.ops().saveOutputs(mvc7({}), { addedLb: 68, bodyweightLb: 150 })
  eq(s.get(RESULT).data.pctBw, 145.33, 'the first save writes the result')
  // The audit's case: the headline added weight changed from 68 to 70 on the Log's sheet.
  s.ops().saveOutputs(s.get(`daily-${DATE}`), { addedLb: 70, bodyweightLb: 150 })
  eq(s.get(`daily-${DATE}`).data.out.addedLb, 70, 'the workout')
  eq(s.get(RESULT).data.addedLb, 70, 'the result (it stayed 68)')
  eq(s.get(RESULT).data.pctBw, 146.67, 'and its derived percentage (it stayed 145.33)')
})

check('a save is the whole of Today\'s write: level, name and minutes too', () => {
  const s = store()
  const entry = { id: `daily-${DATE}`, kind: 'daily', date: DATE,
    data: { optId: 'log-workout', name: 'Workout', done: true, minutes: 12, minutesSource: 'typed', out: {} } }
  const out = { activity: 'run', duration: 30, rpe: 6 }
  s.ops().saveOutputs(entry, out)
  const want = applyOut(entry, plan.dailyMenu.find(m => m.id === 'log-workout'), out)
  eq(s.get(entry.id).data.level, want.data.level, 'level')
  eq(s.get(entry.id).data.name, want.data.name, 'name')
  eq(s.get(entry.id).data.minutes, want.data.minutes, 'minutes, through resolveMinutes')
})

check('clearing a test session\'s numbers takes its stale result off the chart', () => {
  const s = store()
  s.ops().saveOutputs(mvc7({}), { addedLb: 68, bodyweightLb: 150 })
  s.ops().saveOutputs(s.get(`daily-${DATE}`), { addedLb: null, bodyweightLb: '' })
  eq(s.get(RESULT).deleted, true, 'no numbers, no result (it kept 68 lb and 145%)')
  // Removing data gets an Undo: the numbers and the result come back together.
  eq(s.toasts.length, 1, 'one toast for the removed result')
  ok(/^Removed the .+ result$/.test(s.toasts[0].text), `says what went: ${s.toasts[0].text}`)
  eq(s.toasts[0].action.label, 'Undo')
  s.toasts[0].action.onClick()
  eq(s.get(RESULT).deleted, undefined, 'Undo puts the result back')
  eq(s.get(RESULT).data.addedLb, 68)
  eq(s.get(`daily-${DATE}`).data.out.addedLb, 68, 'and the numbers that made it')
  s.ops().saveOutputs(s.get(`daily-${DATE}`), { addedLb: null, bodyweightLb: '' })
  s.ops().saveOutputs(s.get(`daily-${DATE}`), { addedLb: null, bodyweightLb: null })
  eq(s.toasts.length, 2, 'clearing again with nothing left to remove says nothing')
  s.ops().saveOutputs(s.get(`daily-${DATE}`), { addedLb: 72, bodyweightLb: 150 })
  eq(s.get(RESULT).deleted, undefined, 'typing them again writes it back live')
  eq(s.get(RESULT).data.addedLb, 72)
})

check('removing a workout takes its test result and offers Undo', () => {
  const s = store()
  s.ops().saveOutputs(mvc7({}), { addedLb: 68, bodyweightLb: 150 })
  const entry = s.get(`daily-${DATE}`)
  s.ops().removeSession(entry)
  eq(s.get(entry.id).deleted, true, 'the workout')
  eq(s.get(RESULT).deleted, true, 'its result (the Log left it)')
  eq(s.toasts.length, 1, 'one toast')
  const t = s.toasts[0]
  ok(t.text.startsWith(removedText('')) && t.text.length > removedText('').length, `the toast names what went: ${t.text}`)
  eq(t.duration, UNDO_MS)
  eq(t.action.label, 'Undo')
  eq(t.action.icon, 'undo', 'the platform\'s glyph')
  t.action.onClick()
  eq(s.get(entry.id).deleted, undefined, 'Undo restores the workout live')
  eq(s.get(RESULT).deleted, undefined, 'and the result')
  eq(s.get(RESULT).data.pctBw, 145.33)
})

check('removing a workout with no result leaves other entries alone', () => {
  const other = { id: 'test-2026-08-11-mvc-block', kind: 'test', date: DATE, data: { testId: 'mvc-block', leftKg: 50 } }
  const ride = { id: `daily-${DATE}-log-workout`, kind: 'daily', date: DATE,
    data: { optId: 'log-workout', name: 'Ride', done: true, out: { activity: 'bike' } } }
  const s = store([other, ride])
  s.ops().removeSession(ride)
  eq(s.get(ride.id).deleted, true)
  eq(s.get(other.id).deleted, undefined, 'a test result it did not write stays')
  s.toasts[0].action.onClick()
  eq(s.get(ride.id).deleted, undefined)
})

check('"just miles" names the ride and takes back only its own name', () => {
  const s = store()
  const ride = { id: `daily-${DATE}`, kind: 'daily', date: DATE,
    data: { optId: 'log-workout', name: 'Bike', done: true, out: { activity: 'bike', duration: 20 } } }
  s.ops().setTraining(ride)(false)
  eq(s.get(ride.id).data.training, false)
  eq(s.get(ride.id).data.out.titleFrom, 'casual')
  s.ops().setTraining(s.get(ride.id))(true)
  eq(s.get(ride.id).data.training, undefined)
  eq(s.get(ride.id).data.out.titleFrom, undefined)
})

/* ------------------------------------------- one module, every sheet */

check('every sheet that edits a workout writes through sessionOps', () => {
  for (const f of ['./src/tabs.jsx', './src/log.jsx', '../mobile/src/features/tabs.tsx', '../mobile/src/features/log.tsx']) {
    ok(/import \{ sessionOps \} from '\.\.?\/lib\/sessionops\.js'/.test(src(f)), `${f} should import sessionOps`)
    ok(!/testEntryFor|testEntryId/.test(src(f)), `${f} should leave test results to lib/sessionops.js`)
  }
  for (const f of ['./src/log.jsx', '../mobile/src/features/log.tsx']) {
    // The Log's own writes were a spread of the out and a rename, and a bare delete.
    ok(!/upsertEntry\(\{/.test(src(f)), `${f} builds an entry write of its own`)
    ok(!/deleteEntry\??\.?\(/.test(src(f)), `${f} deletes without the shared remove (no result, no Undo)`)
    ok(/ops\.removeSession\(/.test(src(f)), `${f} should remove through ops.removeSession`)
    ok(/ops\.saveOutputs\(/.test(src(f)), `${f} should save through ops.saveOutputs`)
  }
  ok(/<ToastHost \/>/.test(src('./src/log.jsx')), 'the web Log mounts a ToastHost, or its Undo never shows')
})

check('the phone runs the same module, byte for byte', () => {
  for (const f of ['sessionops.js', 'tests.js', 'force.js', 'gear.js']) {
    eq(src(`../mobile/src/lib/${f}`) === src(`./src/lib/${f}`), true, `mobile/src/lib/${f} drifted from the app`)
  }
})

console.log(failed ? `\n${failed} session-ops test(s) failed` : '\nall session-ops tests pass')
process.exit(failed ? 1 : 0)
