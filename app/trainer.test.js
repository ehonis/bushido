// The owner as trainer: planning into someone else's log with the ids their own
// app would mint, the runner's one write as a pure function, and which sides a
// workout has. See src/lib/trainer.js.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  planPeople, placeEntries, plannedEntriesFor, plannedQuotaFor, keepPlanFor, plannedLine,
  applyOut, applyRun, applyDone, canStart, workoutSides, toneFor, dayOf, dayRow, runKind,
} from './src/lib/trainer.js'
import { splitPrescription } from './src/lib/prescription.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const menu = plan.dailyMenu
const PEOPLE = [{ id: 'owner', name: 'Alex' }, { id: 'sam', name: 'Sam' }, { id: 'robin', name: 'Robin' }]
const OWNER_ME = { id: 'owner', acting: false, real: { id: 'owner', name: 'Alex', admin: true }, people: PEOPLE }
const SAM_ME = { id: 'sam', acting: false, owner: false, real: { id: 'sam', name: 'Sam', admin: false }, people: [] }
const ACTING = { ...OWNER_ME, id: 'sam', acting: true }
const DATE = '2026-10-08'
const pres = {
  title: 'Legs and a run', minutes: 60,
  blocks: [
    { id: 'b1', name: 'Legs', category: 'lift', activity: 'lift', items: [{ id: 'i1', kind: 'lift', name: 'Squat', sets: [{ id: 's1', reps: 5 }] }] },
    { id: 'b2', name: 'Run', category: 'run', activity: 'run', items: [{ id: 'i2', kind: 'interval', name: 'Easy', sets: [{ id: 's2', seconds: 1200 }] }] },
  ],
}

test('only the owner, on the owner\'s own log, with someone else on the install, can plan for anyone', () => {
  assert.deepEqual(planPeople(OWNER_ME).map(p => p.id), ['sam', 'robin'])
  assert.deepEqual(planPeople(SAM_ME), [], 'someone who is not the owner can plan for others')
  assert.deepEqual(planPeople(ACTING), [], 'the owner can plan for others while acting as someone')
  assert.deepEqual(planPeople({ ...OWNER_ME, people: [PEOPLE[0]] }), [], 'a choice with nobody to choose')
})

test('placing: the first session is the day\'s main, the next are extras, ids derivable', () => {
  const [a, b, c] = placeEntries({ menu, onDay: [], date: DATE, items: [{ optId: 'planned' }, { optId: 'planned' }, { optId: 'planned' }] })
  assert.deepEqual([a.id, b.id, c.id], [`daily-${DATE}`, `daily-${DATE}-planned`, `daily-${DATE}-planned-2`])
  assert.deepEqual([a.data.slot, b.data.slot], ['main', 'extra'])
  // Done by default on a day that has arrived; planned on a later one (AGENTS.md §4).
  assert.equal(a.data.done, true, 'a session placed on today was not done')
  const [later] = placeEntries({ menu, date: '2026-10-09', today: '2026-10-08', items: [{ optId: 'planned' }] })
  assert.equal(later.data.done, false, 'a session placed on a later day was done before its day')
  const [past] = placeEntries({ menu, date: '2026-10-01', today: '2026-10-08', items: [{ optId: 'planned' }] })
  assert.equal(past.data.done, true, 'a session logged on an earlier day was not done')
  // A day that already has a main: everything is an extra. Tombstones and other days do not count.
  const day = [{ id: `daily-${DATE}`, kind: 'daily', date: DATE, data: { slot: 'main' } },
    { id: `daily-${DATE}-planned`, kind: 'daily', date: DATE, deleted: true, data: { slot: 'extra' } },
    { id: 'daily-2026-10-07', kind: 'daily', date: '2026-10-07', data: { slot: 'main' } }]
  const [d] = placeEntries({ menu, onDay: day, date: DATE, items: [{ optId: 'planned' }] })
  assert.equal(d.id, `daily-${DATE}-planned`)
  assert.equal(placeEntries({ menu, date: DATE, items: [{ optId: 'no-such-card' }] }).length, 0)
})

test('planned for someone: one entry per part, never done, marked, ids against THEIR day', () => {
  const parts = splitPrescription(pres)
  assert.equal(parts.length, 2)
  const theirDay = [{ id: `daily-${DATE}`, kind: 'daily', date: DATE, data: { slot: 'main', optId: 'hers' } }]
  const out = plannedEntriesFor({ parts, theirDay, menu, date: DATE, owner: { id: 'owner', name: 'Alex' } })
  assert.deepEqual(out.map(e => e.id), [`daily-${DATE}-planned`, `daily-${DATE}-planned-2`], 'their own main was claimed')
  for (const e of out) {
    assert.equal(e.data.done, false)
    assert.deepEqual(e.data.plannedBy, { id: 'owner', name: 'Alex' })
    assert.equal(e.data.optId, 'planned')
    assert.ok(e.data.plan?.blocks?.length, 'the prescription is not on the entry')
  }
  assert.deepEqual(out.map(e => e.data.out.category), ['lift', 'run'])
})

test('keeping for someone reads their day, then writes each part through the people endpoint', async () => {
  const calls = []
  const api = {
    async getPersonDay(pid, date) { calls.push(['day', pid, date]); return [] },
    async putPersonEntry(pid, e) { calls.push(['put', pid, e.id]); return e },
  }
  const kept = await keepPlanFor({ person: { id: 'sam' }, parts: splitPrescription(pres), menu, date: DATE, owner: { id: 'owner', name: 'Alex' }, api })
  assert.deepEqual(calls, [['day', 'sam', DATE], ['put', 'sam', `daily-${DATE}`], ['put', 'sam', `daily-${DATE}-planned`]])
  assert.deepEqual(kept, { ids: [`daily-${DATE}`, `daily-${DATE}-planned`], count: 2, first: `daily-${DATE}` })
})

test('a week planned for someone is their quota-<monday>, marked', () => {
  const q = plannedQuotaFor('2026-10-12', { run: 2 }, { why: 'because' }, { id: 'owner', name: 'Alex' })
  assert.deepEqual(q, { id: 'quota-2026-10-12', kind: 'quota', date: '2026-10-12',
    data: { why: 'because', plannedBy: { id: 'owner', name: 'Alex' }, counts: { run: 2 } } })
})

test('"planned by": the owner\'s name for them, "you" for the owner, nothing on anything else', () => {
  const e = { data: { plannedBy: { id: 'owner', name: 'Alex' } } }
  assert.equal(plannedLine(e, SAM_ME), 'planned by Alex')
  assert.equal(plannedLine(e, OWNER_ME), 'planned by you')
  assert.equal(plannedLine(e, ACTING), 'planned by Alex', 'acting as Sam, the owner sees what Sam sees')
  assert.equal(plannedLine({ data: {} }, SAM_ME), null)
})

test('the runner\'s one write: position, outputs, done and a grown plan in a single entry', () => {
  const opt = menu.find(o => o.id === 'planned')
  const entry = { id: 'daily-x', kind: 'daily', date: DATE, data: { optId: 'planned', done: false, plan: pres, out: { notes: 'keep' } } }
  const run = { startedAt: 1, cursor: 's2', sets: { s1: { reps: 5 } } }
  const a = applyRun(entry, opt, run)
  assert.deepEqual(a.data.run, run)
  assert.equal(a.data.out.notes, 'keep', 'a position write touched the outputs')
  assert.equal(a.data.done, false)
  const b = applyRun(entry, opt, run, { out: { notes: 'keep', rpe: 7 }, done: true, plan: { ...pres, title: 'Grown' } })
  assert.deepEqual([b.data.out.rpe, b.data.done, b.data.plan.title], [7, true, 'Grown'])
  assert.ok('level' in b.data && 'minutes' in b.data, 'the outputs did not recompute level and minutes')
  assert.equal(entry.data.run, undefined, 'the entry passed in was mutated')
  assert.equal(applyDone(entry, true).data.done, true)
  // The runner finishing a session marked undone takes the marker off with it.
  const undone = applyDone(entry, false)
  assert.deepEqual([undone.data.done, undone.data.undone], [false, true], '"Mark undone" did not mark it')
  assert.equal('undone' in applyRun(undone, opt, run, { done: true }).data, false, 'finishing left the undo marker')
  assert.equal(applyOut(entry, opt, { rpe: 5 }).data.out.rpe, 5)
})

test('sides: the owner and everyone the entry is shared with; one side for anyone else', () => {
  const shared = { id: 'daily-x', data: { sharedWith: [{ id: 'sam', entryId: 'daily-x' }, { id: 'robin', entryId: 'daily-x-2' }] } }
  const sides = workoutSides(shared, OWNER_ME)
  assert.deepEqual(sides.map(s => [s.id, s.name, s.entryId, s.tone]),
    [[null, 'You', 'daily-x', 0], ['sam', 'Sam', 'daily-x', 1], ['robin', 'Robin', 'daily-x-2', 2]])
  assert.equal(workoutSides({ id: 'daily-x', data: {} }, OWNER_ME).length, 1, 'a side for a workout nobody shares')
  assert.equal(workoutSides(shared, SAM_ME).length, 1, 'someone else got the owner\'s switcher')
  assert.equal(workoutSides(shared, ACTING).length, 1, 'a switcher while acting as someone')
  assert.deepEqual([toneFor(PEOPLE.slice(1), null), toneFor(PEOPLE.slice(1), 'sam'), toneFor(PEOPLE.slice(1), 'robin')], [0, 1, 2])
})

test('someone\'s day: live entries, main first; a row says done, planned by, in progress', () => {
  const entries = [
    { id: `daily-${DATE}-planned`, kind: 'daily', date: DATE, data: { slot: 'extra', name: 'Run', done: false, undone: true, plan: pres, plannedBy: { id: 'owner', name: 'Alex' }, run: { startedAt: 1 } } },
    { id: `daily-${DATE}`, kind: 'daily', date: DATE, data: { slot: 'main', name: 'Climb' } },
    { id: `daily-${DATE}-x`, kind: 'daily', date: DATE, deleted: true, data: {} },
    { id: 'quota-2026-10-05', kind: 'quota', date: DATE, data: {} },
  ]
  const day = dayOf(entries, DATE)
  assert.deepEqual(day.map(e => e.id), [`daily-${DATE}`, `daily-${DATE}-planned`])
  const [main, run] = day.map(e => dayRow(e, menu, OWNER_ME))
  assert.equal(main.done, true, 'an entry with no done flag is done (older entries predate it)')
  assert.deepEqual([run.done, run.plannedBy, run.running], [false, 'planned by you', true])
  // A plan the owner made for them, on a day that has arrived and not marked undone, is done (§4).
  const planned = { ...entries[0], data: { ...entries[0].data, undone: undefined } }
  assert.equal(dayRow(planned, menu, OWNER_ME).done, true, 'their planned session is done once its day has come')
})

test('"Start" while the run has not ended: on today even though it is done, on an earlier day once undone', () => {
  const today = '2026-10-08'
  const on = (date, data = {}) => ({ id: `daily-${date}`, kind: 'daily', date, data: { optId: 'planned', done: true, plan: pres, ...data } })
  assert.equal(canStart(on(today), today), true, 'today\'s session, done by default, lost its Start')
  assert.equal(canStart(on(today, { run: { startedAt: 1, endedAt: 2 } }), today), false, 'a finished run offered Start again')
  assert.equal(canStart(on('2026-10-01'), today), false, 'last week\'s done session offered Start')
  assert.equal(canStart(on('2026-10-01', { done: false, undone: true }), today), true, 'an undone session lost its Start')
  assert.equal(canStart(null, today), false)
})

test('which screen runs a session: the runner for a plan, workout mode for a clock, nothing for lifts only', () => {
  assert.equal(runKind({ data: { plan: pres } }, null), 'runner')
  const liftOnly = { ...pres, blocks: [pres.blocks[0]] }
  assert.equal(runKind({ data: { plan: liftOnly } }, null), null)
  const timed = menu.find(o => o.timer || o.timers)
  if (timed) assert.equal(runKind({ data: {} }, timed), 'mode')
  assert.equal(runKind({ data: {} }, menu.find(o => o.id === 'planned')), null)
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log('  PASS ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n        ', e.message) }
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log(`trainer: ${tests.length} passed`)
