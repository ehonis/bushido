// The owner as trainer: planning into someone else's log with the ids their own
// app would mint, the runner's one write as a pure function, and which sides a
// workout has. See src/lib/trainer.js.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  planPeople, placeEntries, plannedEntriesFor, keepPlanFor, plannedLine,
  applyOut, applyRun, applyPlan, applyDone, canStart, workoutSides, toneFor, dayOf, dayRow, runKind,
  FOR_ME, toggleFor, forOf, whoOfDraft, forWords, namesOf, isGroup, forSomeoneElse, plannedItems, shareKept, keepForEach,
  keepKeyFor, withoutLoads,
} from './src/lib/trainer.js'
import { groupContext, plannerContext } from './src/lib/plannerapi.js'
import { splitPrescription, normalizePrescription, runOutputs, patchItem } from './src/lib/prescription.js'

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

test('one weight mode per exercise on a run entry: the sheet\'s plan and its log write through the same rule (#58)', () => {
  const opt = menu.find(o => o.id === 'planned')
  const liftField = (opt.outputs || []).find(f => f.type === 'lifts')
  const p = normalizePrescription({ title: 'Legs', blocks: [{ name: 'Main', items: [
    { kind: 'lift', exercise: 'bulgarian-split-squat', implement: 'dumbbell', sets: [{ reps: 8, weight: 25 }] }] }] }, { liftField })
  const sid = p.blocks[0].items[0].sets[0].id
  const run = { sets: { [sid]: { reps: 8, weight: 25 } }, endedAt: 2 }
  const entry = { id: 'daily-x', kind: 'daily', date: DATE, data: { optId: 'planned', plan: p, run, out: runOutputs(p, run, { rpe: 7 }) } }
  const id = p.blocks[0].items[0].id
  // The plan editor's switch (savePlan): the log row says the same.
  const a = applyPlan(entry, opt, patchItem(p, id, { weightMode: 'one', weightLabel: 'lb · one dumbbell' }))
  assert.deepEqual([a.data.plan.blocks[0].items[0].weightMode, a.data.out.lifts[0].weightMode, a.data.out.rpe], ['one', 'one', 7])
  assert.equal(a.data.name, 'Legs')
  // The lift log's switch (saveOutputs): the plan item says the same.
  const lifts = a.data.out.lifts.map(({ weightMode: _m, ...l }) => ({ ...l, weightLabel: 'lb per hand' }))
  const b = applyOut(a, opt, { ...a.data.out, lifts })
  assert.equal('weightMode' in b.data.plan.blocks[0].items[0], false)
  assert.equal(b.data.plan.blocks[0].items[0].weightLabel, 'lb per hand')
  // An entry with no plan is written as it always was.
  const plain = { id: 'daily-y', kind: 'daily', date: DATE, data: { optId: 'log-workout', out: {} } }
  assert.equal('plan' in applyOut(plain, menu.find(o => o.id === 'log-workout'), { rpe: 5 }).data, false)
})

/* ------------------------------------------- several people at once (#59) */

const SAM = { id: 'sam', name: 'Sam' }
const ROBIN = { id: 'robin', name: 'Robin' }
const OTHERS = planPeople(OWNER_ME)

test('For is a choice of several: you by default, tap to add, never nobody', () => {
  let who = FOR_ME
  assert.equal(toggleFor(who, { id: null }, OTHERS), who, 'the last one picked was taken off')
  who = toggleFor(who, ROBIN, OTHERS)
  who = toggleFor(who, SAM, OTHERS)
  assert.deepEqual(who.others.map(p => p.id), ['sam', 'robin'], 'not in People order')
  who = toggleFor(who, { id: null }, OTHERS)
  assert.equal(who.me, false)
  who = toggleFor(who, ROBIN, OTHERS)
  assert.deepEqual([who.me, who.others.map(p => p.id)], [false, ['sam']])
  assert.equal(toggleFor(who, SAM, OTHERS), who, 'Sam, the only one left, was taken off')
})

test('what the server is sent: nothing for you, one id for one person, a list for a group', () => {
  assert.equal(forOf(FOR_ME, 'owner'), null)
  assert.equal(forOf({ me: false, others: [SAM] }, 'owner'), 'sam')
  assert.deepEqual(forOf({ me: true, others: [SAM] }, 'owner'), ['owner', 'sam'])
  assert.deepEqual(forOf({ me: false, others: [SAM, ROBIN] }, 'owner'), ['sam', 'robin'])
  assert.equal(isGroup(FOR_ME), false)
  assert.equal(isGroup({ me: false, others: [SAM] }), false)
  assert.equal(forSomeoneElse({ me: false, others: [SAM] }), SAM)
  assert.equal(forSomeoneElse({ me: true, others: [SAM] }), null)
})

test('a draft reopens for the people it was for, and an old one with a single `for` still does', () => {
  assert.deepEqual(whoOfDraft({ for: { id: 'sam', name: 'Sam' } }, OTHERS), { me: false, others: [SAM] })
  assert.deepEqual(whoOfDraft({ people: [{ id: 'owner', name: 'Alex', owner: true }, { id: 'sam', name: 'Sam' }] }, OTHERS), { me: true, others: [SAM] })
  assert.deepEqual(whoOfDraft({}, OTHERS), FOR_ME)
  assert.deepEqual(whoOfDraft({ for: { id: 'gone', name: 'Kim' } }, OTHERS).others, [{ id: 'gone', name: 'Kim' }])
})

test('the words for who it is for agree with each other', () => {
  assert.equal(namesOf([SAM, ROBIN, { name: 'Kim' }]), 'Sam, Robin and Kim')
  assert.equal(forWords(FOR_ME).keep, 'Put it on today')
  assert.equal(forWords(FOR_ME).line, null)
  assert.equal(forWords({ me: false, others: [SAM] }).line, 'Planning for Sam · it goes in Sam’s log')
  assert.equal(forWords({ me: true, others: [SAM] }).keep, 'Put it on today with Sam')
  assert.equal(forWords({ me: true, others: [SAM] }).line, 'You and Sam · one shared workout')
  assert.equal(forWords({ me: false, others: [SAM, ROBIN] }).title, 'On Sam and Robin’s days')
})

test('several people\'s context: a paragraph each, under their name, from their own log', () => {
  const mine = [{ id: 'm', kind: 'daily', date: DATE, data: { optId: 'log-workout', name: 'Ride', level: 2, done: true } }]
  const text = groupContext({ iso: DATE, people: [
    { name: 'Alex', entries: mine, plan, readiness: { recovery: 80 } },
    { name: 'Sam', entries: [], plan },
  ] })
  const [today, alex, sam] = text.split('\n')
  assert.equal(today, `Today is ${DATE}.`)
  assert.match(alex, /^Alex: WHOOP this morning: recovery 80%.*Ride/)
  assert.match(sam, /^Sam: Nothing logged in the last 7 days\.$/)
  // One person's context is exactly what it always was.
  assert.match(plannerContext({ iso: DATE, plan, entries: mine }), new RegExp(`^Today is ${DATE}\\. Logged in the last 7 days`))
})

test('you and Sam: your entries are kept, then each is shared with Sam, sync on, copy first', async () => {
  const parts = splitPrescription({ ...pres, draftId: 'dkeep1' })
  const mine = placeEntries({ menu, onDay: [], items: plannedItems(parts), date: DATE })
  const writes = []
  const saved = []
  const api = {
    getPersonDay: async () => [],
    getPersonEntry: async () => null,
    putPersonEntry: async (pid, e) => { writes.push([pid, e]); return e },
  }
  const r = await shareKept({ entries: mine, people: [SAM], menu, owner: { id: 'owner', name: 'Alex' }, api, save: (e) => saved.push(e) })
  assert.deepEqual(r.failed, [])
  assert.equal(writes.length, mine.length, 'not one copy per part')
  for (const [pid, copy] of writes) {
    assert.equal(pid, 'sam')
    assert.equal(copy.data.done, false)
    assert.equal(copy.data.plan.draftId, undefined, 'the owner\'s draft id went into Sam\'s log')
    assert.ok(copy.data.plan.blocks.flatMap(b => b.items).flatMap(i => i.sets).every(s => s.weight == null), 'a weight was copied')
  }
  assert.equal(saved.length, mine.length)
  for (const e of r.entries) assert.deepEqual(e.data.sharedWith, [{ id: 'sam', entryId: e.id, sync: true }])
  assert.equal(r.entries[0].data.plan.draftId, 'dkeep1', 'the owner\'s entry lost its draft id')
})

test('one person failing does not stop the next, and is said', async () => {
  const mine = placeEntries({ menu, onDay: [], items: plannedItems(splitPrescription(pres)), date: DATE })
  const api = {
    getPersonDay: async () => [],
    getPersonEntry: async () => null,
    putPersonEntry: async (pid, e) => { if (pid === 'sam') throw new Error('offline'); return e },
  }
  const saved = []
  const r = await shareKept({ entries: mine, people: [SAM, ROBIN], menu, owner: { id: 'owner' }, api, save: (e) => saved.push(e) })
  assert.deepEqual(r.failed.map(f => [f.person.id, f.error]), [['sam', 'offline']])
  for (const e of r.entries) assert.deepEqual(e.data.sharedWith.map(l => l.id), ['robin'])
})

test('others only, kept for some of them: who it landed for, who it missed, and a retry that fills the gap', async () => {
  let robinDown = true
  const keep = async (person) => {
    if (person.id === 'robin' && robinDown) throw new Error('read-only')
    return { ids: [`daily-${DATE}`], count: 1, first: `daily-${DATE}` }
  }
  const r = await keepForEach({ people: [SAM, ROBIN], keep })
  assert.deepEqual([r.landed.map(p => p.id), r.failed.map(f => [f.person.id, f.error]), r.first.first], [['sam'], [['robin', 'read-only']], `daily-${DATE}`])
  // The last screen is worded from where it landed, not from what was asked.
  assert.equal(forWords({ me: false, others: r.landed }).title, 'On Sam’s day')
  robinDown = false
  const again = await keepForEach({ people: r.failed.map(f => f.person), keep })
  assert.deepEqual([again.landed.map(p => p.id), again.failed], [['robin'], []])
})

/* "Try again for Robin" never writes a part twice (#59 review): an in-memory people API. */
const memoryApi = ({ failOn = () => false } = {}) => {
  const logs = {}
  let n = 0
  return {
    logs,
    live: (pid) => Object.values(logs[pid] || {}).filter(e => !e.deleted),
    getPersonDay: async (pid, date) => Object.values(logs[pid] || {}).filter(e => e.date === date),
    getPersonEntry: async (pid, id) => logs[pid]?.[id] || null,
    putPersonEntry: async (pid, e) => {
      const call = ++n
      const fail = failOn(pid, call)
      if (fail === 'before') throw new Error('offline')
      logs[pid] = { ...(logs[pid] || {}), [e.id]: e }
      if (fail === 'after') throw new Error('timeout')  // it landed; the answer did not
      return e
    },
  }
}
const twoParts = splitPrescription({ ...pres, draftId: 'dretry1' })
const keepFor = (api) => (person, key) => keepPlanFor({ person, parts: twoParts, menu, date: DATE, owner: { id: 'owner', name: 'Alex' }, api, key })

test('a keep that failed part-way says how much landed, and its retry writes only the missing part', async () => {
  assert.equal(twoParts.length, 2)
  let robinPuts = 0
  const api = memoryApi({ failOn: (pid) => (pid === 'robin' && ++robinPuts === 2 ? 'before' : false) })
  const key = keepKeyFor({ draftId: 'dretry1' })
  const r = await keepForEach({ people: [SAM, ROBIN], keep: (p) => keepFor(api)(p, key) })
  assert.deepEqual(r.failed.map(f => [f.person.id, f.written, f.of]), [['robin', 1, 2]])
  const again = await keepForEach({ people: r.failed.map(f => f.person), keep: (p) => keepFor(api)(p, key) })
  assert.deepEqual(again.failed, [])
  for (const pid of ['sam', 'robin']) {
    const live = api.live(pid)
    assert.equal(live.length, 2, `${pid} has ${live.length} entries, not one per part`)
    assert.deepEqual(live.map(e => e.data.keepKey).sort(), ['dretry1:0', 'dretry1:1'])
  }
  assert.deepEqual(again.first.ids.length, 2, 'the retry does not count the part already there')
})

test('a write that landed but whose answer was lost is not written again by the retry', async () => {
  const api = memoryApi({ failOn: (pid, call) => (pid === 'sam' && call === 1 ? 'after' : false) })
  const key = keepKeyFor({})
  assert.match(key, /^k/)
  const r = await keepForEach({ people: [SAM, ROBIN], keep: (p) => keepFor(api)(p, key) })
  assert.deepEqual(r.failed.map(f => f.person.id), ['sam'])
  await keepForEach({ people: [SAM], keep: (p) => keepFor(api)(p, key) })
  assert.equal(api.live('sam').length, 2, `sam has ${api.live('sam').length} entries`)
  assert.equal(api.live('robin').length, 2)
})

test('a hand-built plan for several people goes in without loads', () => {
  const loaded = { ...pres, blocks: [{ ...pres.blocks[0], items: [{ ...pres.blocks[0].items[0], sets: [{ id: 's1', reps: 5, weight: 100 }] }] }] }
  const out = withoutLoads(loaded)
  assert.equal(out.blocks[0].items[0].sets[0].weight, null)
  assert.equal(out.blocks[0].items[0].sets[0].reps, 5)
  assert.equal(loaded.blocks[0].items[0].sets[0].weight, 100, 'the editor\'s plan was changed in place')
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log('  PASS ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n        ', e.message) }
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log(`trainer: ${tests.length} passed`)
