// Shared workouts: one workout, two logs. What is copied, which id the copy
// takes, and when taking someone off asks first. See src/lib/shared.js.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  sharePeople, sharedWithOf, sharedPeopleOn, withLine, sharedOut, hasOwnMarks, copyIdFor,
  sharedCopy, withSharedPerson, addPerson, removePerson, copyExercises, hasExercises,
  isSynced, withSync, openSide, inStep, inStepLine, shareSummary, takeOffWords, undoTakeOff,
  planShown, syncedSides, ownWordsOn, withStoredWords, crossingSet,
} from './src/lib/shared.js'
import { withAck, adoptAcks } from './src/lib/store.js'
import { formOut, categoryOf } from './src/lib/category.js'
import { createCopyQueue, openedCopy } from './src/lib/copyqueue.js'
import { patchSet, dropEmptyBlocks, keepTyped, tickSet } from './src/lib/prescription.js'
import { liftsDone } from './src/lib/lifts.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const PEOPLE = [{ id: 'owner', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
const OWNER_ME = { id: 'owner', acting: false, real: { id: 'owner', admin: true }, people: PEOPLE }
const workoutCard = { id: 'log-workout', nameFrom: 'activity' }
const ride = {
  id: 'daily-2026-10-05', kind: 'daily', date: '2026-10-05', updatedAt: 'z',
  data: {
    optId: 'log-workout', slot: 'main', name: 'Ride', level: 2, minutes: 60, done: true,
    out: { activity: 'bike', distance: 21, minutesSpent: 62, rpe: 7, felt: 3, notes: 'windy', gear: ['b1'],
      strava: { id: 9 }, lifts: [{ name: 'Squat', sets: [{ reps: 5, weight: 100 }] }] },
  },
}

/** A pretend server: Sam's log as a map, with the same not-shared refusal. */
function fakeApi(initial = {}) {
  const log = new Map(Object.entries(initial))
  const calls = []
  return {
    log, calls,
    async getPersonEntry(pid, id) { calls.push(['get', pid, id]); return log.get(id) || null },
    async getPersonDay(pid, date) { calls.push(['day', pid, date]); return [...log.values()].filter(e => e.date === date) },
    async putPersonEntry(pid, entry) {
      calls.push(['put', pid, entry.id])
      const cur = log.get(entry.id)
      if (cur && !cur.deleted && !cur.data?.sharedFrom) { const e = new Error('no'); e.code = 'not-shared'; throw e }
      const data = { ...entry.data, ...(cur && !cur.deleted || entry.deleted ? {} : { done: false }) }
      log.set(entry.id, { ...entry, data })
      return log.get(entry.id)
    },
  }
}

test('only the owner, on the owner\'s own log, with someone else on the install, gets anyone to add', () => {
  assert.deepEqual(sharePeople(OWNER_ME).map(p => p.id), ['sam'])
  assert.deepEqual(sharePeople({ ...OWNER_ME, people: [PEOPLE[0]] }), [], 'one person: nobody to add')
  assert.deepEqual(sharePeople({ ...OWNER_ME, id: 'sam', acting: true }), [], 'acting as someone')
  assert.deepEqual(sharePeople({ id: 'sam', real: { id: 'sam', admin: false }, people: [] }), [], 'not the owner')
})

test('the copy carries the workout and the owner\'s exercises, none of the owner\'s numbers', () => {
  const copy = sharedCopy(ride, { session: workoutCard, owner: { id: 'owner', name: 'Alex' } })
  assert.equal(copy.id, ride.id, 'not the same derivable id')
  assert.equal(copy.data.done, false, 'planning is not completing')
  assert.equal(copy.data.optId, 'log-workout')
  assert.deepEqual(copy.data.out, { activity: 'bike', distance: 21, minutesSpent: 62 })
  for (const k of ['rpe', 'felt', 'notes', 'gear', 'strava', 'lifts']) assert.equal(copy.data.out[k], undefined, `${k} was copied`)
  assert.deepEqual(copy.data.sharedFrom, { id: 'owner', name: 'Alex' })
  assert.deepEqual(sharedOut({ hardest: 5, title: 'Gravel' }, { nameFrom: null }), { title: 'Gravel' })
})

test('the copy takes the owner\'s id unless they logged something of their own there', () => {
  assert.equal(copyIdFor(ride, []), ride.id)
  assert.equal(copyIdFor(ride, [{ id: ride.id, deleted: true, data: {} }]), ride.id, 'a tombstone is free')
  assert.equal(copyIdFor(ride, [{ id: ride.id, data: { sharedFrom: { id: 'owner' } } }]), ride.id, 'the copy itself')
  const theirs = [{ id: ride.id, data: { optId: 'max-hangs' } }]
  assert.equal(copyIdFor(ride, theirs), 'daily-2026-10-05-log-workout')
  assert.equal(copyIdFor(ride, [...theirs, { id: 'daily-2026-10-05-log-workout', data: { optId: 'log-workout' } }]), 'daily-2026-10-05-log-workout-2')
  assert.equal(sharedCopy(ride, { id: 'daily-2026-10-05-log-workout' }).data.slot, 'extra')
})

test('sharedWith is a clean list, and the line on a row names them', () => {
  const e = withSharedPerson(ride, 'sam', ride.id)
  assert.deepEqual(sharedWithOf(e), [{ id: 'sam', entryId: ride.id, sync: true }])
  assert.deepEqual(sharedWithOf(withSharedPerson(e, 'sam', ride.id)), [{ id: 'sam', entryId: ride.id, sync: true }], 'added twice')
  assert.equal(sharedPeopleOn(e, PEOPLE)[0].name, 'Sam')
  assert.equal(withLine(e, PEOPLE), 'with Sam')
  assert.equal(withLine({ data: { sharedFrom: { id: 'owner', name: 'Alex' } } }), 'with Alex')
  assert.equal(withLine(ride, PEOPLE), null)
  assert.equal(withSharedPerson(e, 'sam', null, { remove: true }).data.sharedWith, undefined)
})

test('sync: on when someone is added, off for a share made before it existed, and switchable', () => {
  const added = withSharedPerson(ride, 'sam', ride.id)
  assert.equal(isSynced(added, 'sam'), true, 'someone added is not synced')
  const older = { ...ride, data: { ...ride.data, sharedWith: [{ id: 'sam', entryId: ride.id }] } }
  assert.equal(isSynced(older, 'sam'), false, 'an older share was read as synced')
  const off = withSync(added, 'sam', false)
  assert.deepEqual(off.data.sharedWith, [{ id: 'sam', entryId: ride.id }])
  assert.equal(isSynced(withSync(off, 'sam', true), 'sam'), true)
  assert.equal(withSync(ride, 'sam', true), ride, 'switched sync on for someone not on it')
})

test('a shared copy never carries the owner\'s draftId', () => {
  const pres = { title: 'Legs', draftId: 'd-owner-1', blocks: [{ id: 'b0', items: [{ id: 'b0i0', kind: 'lift', name: 'Squat', sets: [{ id: 'b0i0s0', reps: 5, weight: 100 }] }] }] }
  const mine = { ...ride, data: { ...ride.data, optId: 'planned', plan: pres } }
  const copy = sharedCopy(mine, { owner: PEOPLE[0] })
  assert.equal(copy.data.plan.title, 'Legs')
  assert.equal('draftId' in copy.data.plan, false, 'the owner\'s draft id went into Sam\'s log')
  const later = copyExercises({ ...copy, data: { ...copy.data, plan: undefined } }, mine)
  assert.equal('draftId' in later.data.plan, false, 'copying exercises onto a plan-less copy carried the draft id')
  assert.equal(mine.data.plan.draftId, 'd-owner-1', 'the owner\'s own plan lost its draft id')
})

test('a shared copy never carries the owner\'s planner conversation or reasoning', () => {
  const pres = { title: 'Legs', why: 'your recovery was low', notes: ['yours'], changed: 'swapped', thread: [{ role: 'you', text: 'too much' }],
    blocks: [{ id: 'b0', items: [{ id: 'b0i0', kind: 'lift', name: 'Squat', sets: [{ id: 'b0i0s0', reps: 5, weight: 100 }] }] }] }
  const copy = sharedCopy({ ...ride, data: { ...ride.data, optId: 'planned', plan: pres } }, { owner: PEOPLE[0] })
  assert.deepEqual([copy.data.plan.title, copy.data.plan.why, copy.data.plan.notes], ['Legs', '', []])
  assert.equal('thread' in copy.data.plan || 'changed' in copy.data.plan, false, 'the owner\'s planner conversation went into Sam\'s log')
})

test('the sheet reopens on the side last viewed, while that person is still on it', () => {
  const on = [{ id: 'sam', name: 'Sam' }]
  assert.equal(openSide('sam', on), 'sam')
  assert.equal(openSide('robin', on), null, 'opened on someone no longer on the workout')
  assert.equal(openSide(null, on), null)
})

test('their own marks: done, a set, effort or a note count; the shared facts do not', () => {
  const copy = sharedCopy(ride, { session: workoutCard })
  assert.equal(hasOwnMarks(copy, workoutCard), false)
  assert.equal(hasOwnMarks({ ...copy, data: { ...copy.data, done: true } }, workoutCard), true)
  assert.equal(hasOwnMarks({ ...copy, data: { ...copy.data, out: { ...copy.data.out, rpe: 5 } } }, workoutCard), true)
  assert.equal(hasOwnMarks({ ...copy, data: { ...copy.data, out: { ...copy.data.out, sets: [] } } }, workoutCard), false)
  assert.equal(hasOwnMarks({ ...copy, deleted: true, data: { ...copy.data, done: true } }, workoutCard), false)
})

test('adding someone writes their copy, then names them on the owner\'s entry; a second add agrees', async () => {
  const api = fakeApi()
  const { copy, ownerEntry } = await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, owner: PEOPLE[0], api })
  assert.equal(copy.id, ride.id)
  assert.equal(api.log.get(ride.id).data.done, false)
  assert.deepEqual(sharedWithOf(ownerEntry), [{ id: 'sam', entryId: ride.id, sync: true }])
  // She marks a set; the owner (or another device) adds her again: her marks stay.
  api.log.set(ride.id, { ...api.log.get(ride.id), data: { ...api.log.get(ride.id).data, out: { rpe: 4 } } })
  const again = await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, api })
  assert.equal(again.copy.data.out.rpe, 4, 'a second add overwrote what was logged')
  assert.equal(api.calls.filter(c => c[0] === 'put').length, 1, 'a second add wrote again')
})

test('adding over their own session lands as an extra on their day', async () => {
  const api = fakeApi({ [ride.id]: { id: ride.id, date: ride.date, data: { optId: 'max-hangs' } } })
  const { copy, ownerEntry } = await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, api })
  assert.equal(copy.id, 'daily-2026-10-05-log-workout')
  assert.equal(api.log.get(ride.id).data.optId, 'max-hangs', 'their own session was overwritten')
  assert.equal(sharedWithOf(ownerEntry)[0].entryId, 'daily-2026-10-05-log-workout')
})

test('taking them off: an untouched copy goes; a logged one stays in their log, unlinked, never asked about (#96)', async () => {
  const api = fakeApi()
  const added = (await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, api })).ownerEntry
  const quiet = await removePerson({ ownerEntry: added, person: PEOPLE[1], session: workoutCard, api })
  assert.equal(api.log.get(ride.id).deleted, true, 'an untouched copy is not a tombstone')
  assert.equal(quiet.kept, false)
  assert.equal(quiet.ownerEntry.data.sharedWith, undefined)
  assert.equal(takeOffWords(PEOPLE[1], quiet), 'Took Sam off this workout')

  const api2 = fakeApi()
  const added2 = (await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, api: api2 })).ownerEntry
  const logged = { ...api2.log.get(ride.id), data: { ...api2.log.get(ride.id).data, done: true, out: { rpe: 6 } } }
  api2.log.set(ride.id, logged)
  const puts = api2.calls.filter(c => c[0] === 'put').length
  const taken = await removePerson({ ownerEntry: added2, person: PEOPLE[1], session: workoutCard, api: api2 })
  assert.equal(taken.kept, true)
  assert.equal(api2.log.get(ride.id).deleted, undefined, 'their logged workout was deleted from the owner\'s phone')
  assert.equal(api2.log.get(ride.id).data.out.rpe, 6)
  assert.equal(api2.calls.filter(c => c[0] === 'put').length, puts, 'a kept copy was written')
  assert.equal(taken.ownerEntry.data.sharedWith, undefined, 'the link stayed')
  assert.match(takeOffWords(PEOPLE[1], taken), /stays in Sam\u2019s log with what Sam logged/)
  assert.equal(await removePerson({ ownerEntry: taken.ownerEntry, person: PEOPLE[1], api: api2 }), null, 'not on it')
})

test('Undo of taking them off puts back the link as it was, and an untouched copy (#96)', async () => {
  const api = fakeApi()
  const added = (await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, api })).ownerEntry
  const unsynced = withSync(added, 'sam', false)
  const copyBefore = api.log.get(ride.id)
  const taken = await removePerson({ ownerEntry: unsynced, person: PEOPLE[1], session: workoutCard, api })
  assert.equal(api.log.get(ride.id).deleted, true)
  const back = await undoTakeOff({ ownerEntry: taken.ownerEntry, person: PEOPLE[1], taken, api, now: 'zz' })
  assert.deepEqual(sharedWithOf(back), [{ id: 'sam', entryId: ride.id }], 'sync came back on, or the link changed')
  const restored = api.log.get(ride.id)
  assert.equal(restored.deleted, undefined)
  assert.equal(restored.updatedAt, 'zz', 'not stamped past the tombstone')
  assert.deepEqual(restored.data, copyBefore.data)

  // A kept copy is never written by Undo: only the link comes back.
  const api2 = fakeApi()
  const added2 = (await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, api: api2 })).ownerEntry
  api2.log.set(ride.id, { ...api2.log.get(ride.id), data: { ...api2.log.get(ride.id).data, out: { rpe: 6 } } })
  const taken2 = await removePerson({ ownerEntry: added2, person: PEOPLE[1], session: workoutCard, api: api2 })
  const puts = api2.calls.filter(c => c[0] === 'put').length
  const back2 = await undoTakeOff({ ownerEntry: taken2.ownerEntry, person: PEOPLE[1], taken: taken2, api: api2 })
  assert.equal(api2.calls.filter(c => c[0] === 'put').length, puts)
  assert.deepEqual(sharedWithOf(back2), [{ id: 'sam', entryId: ride.id, sync: true }])
})

/* --------------------------------------------- copying the owner's exercises */

const squat = (sets) => ({ uid: 'squat-1', key: 'squat', name: 'Squat', implement: 'barbell', sets })
const bench = (sets) => ({ uid: 'bench-1', key: 'bench', name: 'Bench', implement: 'barbell', sets })
const gym = (lifts) => ({
  id: 'daily-2026-10-06', kind: 'daily', date: '2026-10-06',
  data: { optId: 'log-workout', done: false, out: { activity: 'lift', lifts, rpe: 8 } },
})
const set = (reps, weight) => ({ reps, weight })
const B = { reps: '', weight: '' }
const liftsOf = (e) => e.data.out.lifts
const editTheirs = (copy, lifts) => ({ ...copy, data: { ...copy.data, out: { ...copy.data.out, lifts } } })

test('logged lifts: their copy gets the owner\'s exercises and set counts, blank, to mark their own', () => {
  let copy = sharedCopy(gym([squat([set(5, 100), set(5, 100)])]), { session: workoutCard })
  assert.deepEqual(liftsOf(copy), [squat([B, B])], 'the owner\'s numbers were copied, or the exercise was not')
  assert.equal(hasOwnMarks(copy, workoutCard), false, 'blank copied exercises counted as theirs')
  copy = editTheirs(copy, [squat([set(5, 60), set(5, 60)])])
  assert.equal(hasOwnMarks(copy, workoutCard), true)
  // The owner goes heavier, adds a set and an exercise, then copies them over.
  const mine = gym([squat([set(5, 110), set(5, 110), set(5, 110)]), bench([set(8, 60)])])
  copy = copyExercises(copy, mine)
  assert.deepEqual(liftsOf(copy), [squat([set(5, 60), set(5, 60), B]), bench([B])])
  assert.equal(copy.data.out.rpe, undefined, 'the owner\'s effort was copied')
  assert.equal(copyExercises(copy, mine), copy, 'nothing left to copy still changed something')
})

test('a hold copies as a hold: blank seconds, and seconds they hold are their marks (#63)', () => {
  const plank = (sets) => ({ uid: 'plank-1', key: 'plank', name: 'Plank', group: 'Core', implement: 'bodyweight', sets })
  let copy = sharedCopy(gym([plank([{ seconds: '45', weight: '' }, { seconds: '45', weight: '' }])]), { session: workoutCard })
  assert.deepEqual(liftsOf(copy)[0].sets, [{ seconds: '', weight: '' }, { seconds: '', weight: '' }])
  assert.equal(hasOwnMarks(copy, workoutCard), false)
  copy = editTheirs(copy, [plank([{ seconds: '30', weight: '' }, { seconds: '', weight: '' }])])
  assert.equal(hasOwnMarks(copy, workoutCard), true, 'seconds held were not counted as theirs')
  const more = copyExercises(copy, gym([plank([{ seconds: '45', weight: '' }, { seconds: '45', weight: '' }, { seconds: '60', weight: '' }])]))
  assert.deepEqual(liftsOf(more)[0].sets, [{ seconds: '30', weight: '' }, { seconds: '', weight: '' }, { seconds: '', weight: '' }])
  // A plank logged as reps copies as reps.
  const old = sharedCopy(gym([plank([{ reps: '60', weight: '' }])]), { session: workoutCard })
  assert.deepEqual(liftsOf(old)[0].sets, [B])
})

test('copying only adds: what they took out of a set count, and their own lifts, stay as they are', () => {
  const copy = editTheirs(sharedCopy(gym([squat([set(5, 100)])]), { session: workoutCard }),
    [squat([set(5, 60), set(5, 60), set(5, 60)]), { uid: 'row-1', name: 'Row', sets: [set(10, 40)] }])
  const next = copyExercises(copy, gym([squat([set(5, 100)]), bench([set(8, 60)])]))
  assert.deepEqual(liftsOf(next).map(l => `${l.uid}x${l.sets.length}`), ['squat-1x3', 'row-1x1', 'bench-1x1'])
})

const item = (id, name, weights) => ({ id, kind: 'lift', name, sets: weights.map((w, i) => ({ id: `${id}s${i}`, reps: 10, weight: w })) })
const planned = (items, extra = {}) => ({
  id: 'daily-2026-10-13', kind: 'daily', date: '2026-10-13',
  data: { optId: 'planned', done: false, out: {}, plan: { title: 'Legs', blocks: [{ id: 'b0', items }] }, ...extra },
})
const plannedCard = { id: 'planned' }
const names = (e) => e.data.plan.blocks.flatMap(b => b.items.map(i => `${i.name}x${i.sets.length}`))

test('a planned workout: their copy has the same exercises, without the owner\'s weights', () => {
  const mine = planned([item('b0i0', 'Goblet squat', [55, 55, 55]), item('b0i1', 'Leg press', [180, 180])])
  const copy = sharedCopy(mine, { session: plannedCard })
  assert.deepEqual(names(copy), ['Goblet squatx3', 'Leg pressx2'])
  assert.ok(copy.data.plan.blocks[0].items.every(i => i.sets.every(s => s.weight === null && s.reps === 10)),
    'the owner\'s weights went into their plan')
  assert.equal(copy.data.plan.title, 'Legs')
  assert.equal(hasExercises(mine), true)
  assert.equal(hasExercises(ride), false, 'a ride has exercises to copy')
})

test('a planned workout: copying adds the owner\'s new exercises and sets; their weights and logged sets stay', () => {
  const mine = planned([item('b0i0', 'Goblet squat', [55, 55])])
  let copy = sharedCopy(mine, { session: plannedCard })
  // They set their weights and log the first squat set.
  copy = { ...copy, data: { ...copy.data, plan: planned([item('b0i0', 'Goblet squat', [30, 30])]).data.plan,
    run: { startedAt: 1, sets: { b0i0s0: { reps: 10, weight: 30 } }, cursor: 'b0i0s1' } } }
  // The owner adds lunges first and a third squat set, then copies them over.
  const next = planned([item('b0i0', 'Lunge', [20]), item('b0i1', 'Goblet squat', [60, 60, 60])])
  copy = copyExercises(copy, next)
  assert.deepEqual(names(copy), ['Goblet squatx3', 'Lungex1'], 'new exercises go after theirs, nothing of theirs moves')
  assert.deepEqual(copy.data.plan.blocks[0].items[0].sets.map(s => s.weight), [30, 30, 30], 'their weight was not kept or carried to the new set')
  assert.equal(copy.data.plan.blocks[0].items[1].sets[0].weight, null, 'the owner\'s new exercise came with the owner\'s weight')
  assert.deepEqual(copy.data.run.sets, { b0i0s0: { reps: 10, weight: 30 } }, 'their logged set was lost')
  assert.equal(copy.data.run.cursor, 'b0i0s1')
  assert.equal(copyExercises(copy, next), copy, 'a second copy of the same plan changed something')
  assert.equal(copy.data.done, false)
})

test('a planned workout: copying never takes out what they removed or added', () => {
  const copy = sharedCopy(planned([item('b0i0', 'Goblet squat', [55])]), { session: plannedCard })
  const own = { ...copy, data: { ...copy.data, plan: planned([item('b0i0', 'Goblet squat', [30]), item('b0i1', 'Calf raise', [20])]).data.plan } }
  assert.deepEqual(names(copyExercises(own, planned([item('b0i0', 'Goblet squat', [60]), item('b0i1', 'Leg press', [200])]))),
    ['Goblet squatx1', 'Calf raisex1', 'Leg pressx1'])
  // A copy with no plan yet (added before the owner planned it) takes the whole plan.
  const bare = { id: 'x', kind: 'daily', date: '2026-10-13', data: { optId: 'planned', done: false, out: {}, sharedFrom: { id: 'owner' } } }
  assert.deepEqual(names(copyExercises(bare, planned([item('b0i0', 'Hip thrust', [100, 100])]))), ['Hip thrustx2'])
})

test('what a weight means is the owner\'s: no copy carries their mode, first share, Copy my exercises or a plan (#58)', () => {
  const one = { implement: 'dumbbell', implementLabel: 'Dumbbell', weightMode: 'one', weightLabel: 'lb · one dumbbell' }
  const hasMode = (x) => 'weightMode' in x || x.weightLabel === 'lb · one dumbbell'
  // The first share of a logged workout.
  const bss = (sets, extra = {}) => ({ uid: 'bss-1', key: 'bss', name: 'Bulgarian split squat', ...one, sets, ...extra })
  let copy = sharedCopy(gym([bss([set(8, 25)])]), { session: workoutCard })
  assert.equal(liftsOf(copy)[0].implement, 'dumbbell', 'the exercise did not arrive, so this proves nothing')
  assert.ok(!hasMode(liftsOf(copy)[0]), 'the owner\'s mode crossed on the first share')
  // Copy my exercises, onto a copy that has one exercise already.
  copy = copyExercises(editTheirs(copy, []), gym([bss([set(8, 25)]), { ...bss([set(10, 30)]), uid: 'row-1', key: 'row', name: 'Row' }]))
  assert.deepEqual(liftsOf(copy).map(l => [l.uid, hasMode(l)]), [['bss-1', false], ['row-1', false]], 'Copy my exercises carried the mode')
  // Their own mode on a lift they already have stays theirs.
  const theirs = editTheirs(copy, [{ ...liftsOf(copy)[0], weightMode: 'pair', weightLabel: 'lb per hand', sets: [set(10, 20)] }])
  assert.equal(liftsOf(copyExercises(theirs, gym([bss([set(8, 25), set(8, 25)])])))[0].weightMode, 'pair')
  // A planned share, and Copy my exercises on a plan.
  const mine = planned([{ ...item('b0i0', 'Bulgarian split squat', [25, 25]), exercise: 'bss', ...one }])
  const pcopy = sharedCopy(mine, { session: plannedCard })
  assert.ok(!hasMode(pcopy.data.plan.blocks[0].items[0]), 'the owner\'s mode crossed on a planned share')
  const more = planned([mine.data.plan.blocks[0].items[0], { ...item('b0i1', 'Goblet squat', [40]), exercise: 'goblet', ...one }])
  const grown = copyExercises(pcopy, more)
  assert.deepEqual(grown.data.plan.blocks[0].items.map(i => hasMode(i)), [false, false], 'Copy my exercises carried a planned mode')
})

/* ---------------------------------------- receipts and one write at a time */

const base1 = { of: 'daily-2026-11-07', rev: 1, plan: [] }
const ack2 = { of: 'daily-2026-11-07', rev: 2, plan: [{ uid: 'B', items: [] }] }
const copyOf = (sets, syncBase = base1, at = 'a') => ({ id: 'daily-2026-11-07', kind: 'daily', updatedAt: at, data: { plan: { sets }, syncBase } })

test('withAck: a copy edited again while its write was out takes that write\'s receipt as its base', () => {
  const sent = copyOf(3)
  const local = copyOf(4, base1, 'b')
  assert.deepEqual(withAck(local, sent, ack2).data, { plan: { sets: 4 }, syncBase: ack2 }, 'kept its edits and took the receipt')
  assert.equal(withAck(sent, sent, ack2), sent, 'the copy that was sent is replaced by the answer, not re-based')
  assert.equal(withAck(local, sent, null), local, 'no receipt: left as it is')
  const other = copyOf(4, { ...base1, rev: 5 }, 'b')
  assert.equal(withAck(other, sent, ack2), other, 'a copy on another base since is left alone')
  const gone = { ...local, deleted: true }
  assert.equal(withAck(gone, sent, ack2), gone, 'a tombstone is left alone')
  assert.equal(withAck({ ...local, id: 'x' }, sent, ack2).data.syncBase, base1, 'another entry is left alone')
})

test('adoptAcks: only entries the push answered for, only where this device went on editing', () => {
  const sentState = { entries: { a: copyOf(3), b: copyOf(1) } }
  const now = { entries: { a: copyOf(4, base1, 'b'), b: sentState.entries.b, c: copyOf(9) } }
  const out = adoptAcks(now, sentState, { a: ack2, b: ack2, zz: ack2 })
  assert.equal(out.entries.a.data.syncBase, ack2)
  assert.equal(out.entries.b, now.entries.b, 'an entry not edited since was re-based')
  assert.equal(out.entries.c, now.entries.c)
  assert.ok(!('zz' in out.entries), 'a receipt for an entry this device lacks made one up')
  assert.equal(adoptAcks(now, sentState, undefined), now, 'an older server sends no receipts')
})

test('createCopyQueue: one write at a time, the newest edit sent next, every caller told how it went', async () => {
  const sent = []
  const gates = []
  const send = (pid, e) => { sent.push([pid, e.data.n]); return new Promise((res, rej) => gates.push({ res, rej })) }
  let latest = null
  const landedWith = []
  const q = createCopyQueue({
    send,
    current: (pid, e) => (latest && latest.id === e.id ? latest : e),
    landed: (pid, e, reply) => landedWith.push([e.data.n, reply.ack]),
    failed: () => {},
  })
  const edit = (n) => { latest = { id: 'c', data: { n } }; return q.push('sam', latest) }
  const tick = () => new Promise(r => setTimeout(r, 0))
  const a = edit(1)
  const b = edit(2)
  const c = edit(3)
  await tick()
  assert.deepEqual(sent, [['sam', 1]], 'more than one write went out at once')
  assert.ok(q.busy)
  gates[0].res({ entry: {}, ack: 'r1' })
  await tick(); await tick()
  assert.deepEqual(sent, [['sam', 1], ['sam', 3]], 'the edits made meanwhile went as one write of the newest copy')
  gates[1].res({ entry: {}, ack: 'r2' })
  assert.deepEqual(await Promise.all([a, b, c]), [true, true, true])
  assert.deepEqual(landedWith, [[1, 'r1'], [3, 'r2']])
  assert.ok(!q.busy)
  // A failure says false to the edits it carried; the next edit is tried afresh.
  const d = edit(4)
  await tick()
  gates[2].rej(new Error('offline'))
  assert.equal(await d, false)
  const e = edit(5)
  await tick()
  gates[3].res({ entry: {}, ack: null })
  assert.equal(await e, true)
  assert.deepEqual(sent.map(x => x[1]), [1, 3, 4, 5])
})

test('createCopyQueue: a copy of someone else\'s queued meanwhile is not lost or merged into another\'s', async () => {
  const sent = []
  const gates = []
  const q = createCopyQueue({
    send: (pid, e) => { sent.push([pid, e.id]); return new Promise(res => gates.push(res)) },
    current: (pid, e) => e,
    landed: () => {},
    failed: () => {},
  })
  const tick = () => new Promise(r => setTimeout(r, 0))
  q.push('sam', { id: 'x', data: {} })
  q.push('sam', { id: 'x', data: {} })
  q.push('kim', { id: 'x', data: {} })
  await tick()
  gates[0]({ entry: {} }); await tick(); await tick()
  gates[1]({ entry: {} }); await tick(); await tick()
  gates[2]?.({ entry: {} }); await tick()
  assert.deepEqual(sent, [['sam', 'x'], ['sam', 'x'], ['kim', 'x']])
})

test('createCopyQueue: a write waiting when the sheet switched sides still takes the receipt (council r1)', async () => {
  // Sam at 2 sets: one write out (3), one waiting (4), then the sheet shows You.
  const sent = []
  const gates = []
  const q = createCopyQueue({
    send: (pid, e) => { sent.push(e); return new Promise(res => gates.push(res)) },
    current: (pid, e) => e, // the screen is someone else's now: the queued copy is all there is
    landed: () => {},
    failed: () => {},
  })
  const tick = () => new Promise(r => setTimeout(r, 0))
  const w1 = copyOf(3)
  q.push('sam', w1)
  q.push('sam', copyOf(4, base1, 'b'))
  await tick()
  gates[0]({ entry: {}, ack: ack2 }); await tick(); await tick()
  assert.equal(sent.length, 2)
  assert.deepEqual(sent[1].data, { plan: { sets: 4 }, syncBase: ack2 }, 'the waiting write went with the old base')
  gates[1]({ entry: {}, ack: null })
})

test('a number typed on the sheet marks its set; a plan kept from the planner, and a share, carry no mark', () => {
  const pres = { blocks: [{ id: 'b0', name: 'Main', items: [{ id: 'b0i0', kind: 'lift', name: 'Row', sets: [{ id: 'b0i0s0', reps: 10, weight: null }] }] }] }
  const typed = patchSet(pres, 'b0i0', 'b0i0s0', { weight: 40 })
  assert.equal(typed.blocks[0].items[0].sets[0].typed, true, 'a typed weight was not marked')
  assert.equal(patchSet(pres, 'b0i0', 'b0i0s0', { note: 'slow' }).blocks[0].items[0].sets[0].typed, undefined, 'a note is not a number')
  assert.equal(dropEmptyBlocks(typed).blocks[0].items[0].sets[0].typed, undefined, 'numbers typed while planning were kept as typed')
  const owner = { id: 'daily-2026-11-07', kind: 'daily', date: '2026-11-07', updatedAt: 'z',
    data: { optId: 'planned', slot: 'main', done: true, plan: typed, out: {} } }
  const copy = sharedCopy(owner, { session: { id: 'planned' } })
  assert.deepEqual(copy.data.plan.blocks[0].items[0].sets.map(x => [x.weight, x.typed]), [[null, undefined]], 'the owner\'s typing crossed in a share')
  const more = { ...owner, data: { ...owner.data, plan: { blocks: [{ ...typed.blocks[0], items: [{ ...typed.blocks[0].items[0],
    sets: [...typed.blocks[0].items[0].sets, { id: 'b0i0s1', reps: 10, weight: 45, typed: true }] }] }] } } }
  const theirs = copyExercises({ ...copy, data: { ...copy.data, plan: { blocks: [{ ...copy.data.plan.blocks[0], items: [{ ...copy.data.plan.blocks[0].items[0], sets: [] }] }] } } }, more)
  assert.ok(theirs.data.plan.blocks[0].items[0].sets.every(x => x.typed === undefined && x.weight === null), 'Copy my exercises carried the owner\'s typing')
})

test('createCopyQueue.newest: a copy reopened while its edit waits shows the edit, not an older read (council r2)', async () => {
  const gates = []
  const sent = []
  const q = createCopyQueue({
    send: (pid, e) => { sent.push(e.data.plan.sets); return new Promise(res => gates.push(res)) },
    current: (pid, e) => e,
    landed: () => {},
    failed: () => {},
  })
  const tick = () => new Promise(r => setTimeout(r, 0))
  const w1 = copyOf(3)
  const w2 = copyOf(4, base1, 'b')
  q.push('sam', w1)
  q.push('sam', w2)
  await tick()
  assert.equal(q.newest('sam', w1.id), w2, 'the waiting edit is the newest')
  assert.equal(q.newest('kim', w1.id), null)
  gates[0]({ entry: {}, ack: ack2 }); await tick(); await tick()
  assert.equal(q.newest('sam', w1.id).data.plan.sets, 4, 'the edit on its way is the newest')
  gates[1]({ entry: {}, ack: null }); await tick(); await tick()
  assert.equal(q.newest('sam', w1.id), null, 'nothing unanswered')
  assert.deepEqual(sent, [3, 4])
})

test('keepTyped: a model revision keeps the mark on a set it left as typed, nowhere else (council r2)', () => {
  const before = { blocks: [{ items: [{ uid: 'R', kind: 'lift', sets: [{ reps: 10, weight: 40, typed: true }, { reps: 10, weight: 40, typed: true }, { reps: 10, weight: null }] }] }] }
  const after = { blocks: [{ items: [
    { uid: 'R', kind: 'lift', sets: [{ reps: 10, weight: 40 }, { reps: 8, weight: 45 }, { reps: 10, weight: null }, { reps: 10, weight: 40 }] },
    { uid: 'N', kind: 'lift', sets: [{ reps: 10, weight: 40 }] },
  ] }] }
  const got = keepTyped(before, after).blocks[0].items
  assert.deepEqual(got[0].sets.map(x => x.typed === true), [true, false, false, false])
  assert.deepEqual(got[1].sets.map(x => x.typed === true), [false])
  // A reply that dropped the uid: matched by exercise, as reviseWeightModes matches (council r3).
  const named = keepTyped({ blocks: [{ items: [{ uid: 'R', kind: 'lift', exercise: 'row', sets: [{ reps: 10, weight: 40, typed: true }] }] }] },
    { blocks: [{ items: [{ kind: 'lift', exercise: 'row', sets: [{ reps: 10, weight: 40 }] }] }] })
  assert.equal(named.blocks[0].items[0].sets[0].typed, true)
})

test('openedCopy: a sheet reopened mid-save opens on the save, never an older read (council r3)', () => {
  const read = copyOf(2, base1, '2026-11-07T17:00:00.000Z')
  const saved = copyOf(3, ack2, '2026-11-07T17:00:05.000Z')
  const waiting = copyOf(4, base1, '2026-11-07T17:00:06.000Z')
  assert.equal(openedCopy(read, waiting, saved), waiting, 'an edit still unanswered comes first')
  assert.equal(openedCopy(read, null, saved), saved, 'the read left before the save landed: it is older')
  assert.equal(openedCopy(saved, null, read), saved, 'a read newer than what landed stands')
  assert.equal(openedCopy(read, null, null), read)
  assert.equal(openedCopy(null, null, saved), saved, 'a copy the read did not find, just saved')
})

let failed = 0
/* ------------------------------------------------------------ #74 */

const planCard = { id: 'planned' }
const pullPres = { title: 'Pull', category: 'lift', activity: 'lift', blocks: [{ id: 'b0', uid: 'B0', name: 'Pull', category: 'lift', items: [
  { id: 'b0i0', uid: 'I0', kind: 'lift', name: 'Row', exercise: 'bent-over-row', sets: [{ id: 'b0i0s0', reps: 10, weight: 90 }, { id: 'b0i0s1', reps: 10, weight: 90 }] }] }] }
const pull = { id: 'daily-2026-11-07', kind: 'daily', date: '2026-11-07', updatedAt: 'z',
  data: { optId: 'planned', slot: 'main', name: 'Pull', level: 2, done: true, plan: pullPres, out: { activity: 'lift', category: 'lift' } } }

test('a shared planned workout carries what KIND of workout it is, so their log files it (#74)', () => {
  const copy = sharedCopy(pull, { session: planCard, owner: PEOPLE[0] })
  assert.deepEqual(copy.data.out, { activity: 'lift', category: 'lift' }, 'their copy files under nothing')
  assert.equal(hasOwnMarks(copy, planCard), false, 'the kind of workout counted as their own mark')
})

test('an older copy names no activity; its form shows the one its plan files it under, nothing written (#96)', () => {
  const old = { ...pull, data: { ...pull.data, sharedFrom: { id: 'owner', name: 'Alex' }, out: { rpe: 6 } } }
  assert.deepEqual(formOut(old), { rpe: 6, activity: 'lift' })
  assert.deepEqual(old.data.out, { rpe: 6 }, 'reading the form rewrote the copy')
  assert.equal(categoryOf(old, []), 'lift', 'and it files where the form says')
  // Its own answer always wins; nothing to read from, nothing made up.
  assert.equal(formOut({ ...old, data: { ...old.data, out: { activity: 'run' } } }).activity, 'run')
  assert.deepEqual(formOut({ id: 'x', data: { out: { rpe: 2 } } }), { rpe: 2 })
  assert.deepEqual(formOut(null), {})
})

test('a copy whose plan names only the lifting category reads Lift too; support alone still asks (#96 review)', () => {
  const fixture = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
  const card = fixture.dailyMenu.find(m => m.id === 'planned')
  // daily-2026-10-16's shape: plan category lift, no activity anywhere, nothing in out.
  const oct16 = { id: 'daily-2026-10-16', kind: 'daily', date: '2026-10-16', data: { optId: 'planned', done: false,
    sharedFrom: { id: 'owner', name: 'Alex' }, out: {},
    plan: { title: 'Push/Pull', category: 'lift', activity: null, blocks: [
      { id: 'b0', name: 'Push', category: 'lift', activity: null, items: [] },
      { id: 'b1', name: 'Pull', category: 'lift', activity: null, items: [] },
      { id: 'b2', name: 'Accessory', category: null, activity: null, items: [] }] } } }
  assert.equal(formOut(oct16, card).activity, 'lift')
  assert.deepEqual(oct16.data.out, {}, 'reading the form rewrote the copy')
  assert.equal(formOut(oct16).activity, undefined, 'no card, nothing made up')
  const support = { ...oct16, data: { ...oct16.data, plan: { ...oct16.data.plan, category: 'support', blocks: [] } } }
  assert.equal(formOut(support, card).activity, undefined, 'support names no one activity')
})

test('a number they typed into their plan is their own mark; a target is not', () => {
  const copy = sharedCopy(pull, { session: planCard, owner: PEOPLE[0] })
  assert.equal(hasOwnMarks(copy, planCard), false)
  const typed = { ...copy, data: { ...copy.data, plan: patchSet(copy.data.plan, 'b0i0', 'b0i0s0', { weight: 40 }) } }
  assert.equal(hasOwnMarks(typed, planCard), true, 'taking them off would tombstone what they typed')
})

test('copying the owner\'s extra sets copies their own last set\'s numbers, not its typed mark', () => {
  const copy = sharedCopy({ ...pull, data: { ...pull.data, plan: { ...pullPres, blocks: [{ ...pullPres.blocks[0], items: [{ ...pullPres.blocks[0].items[0], sets: [pullPres.blocks[0].items[0].sets[0]] }] }] } } },
    { session: planCard, owner: PEOPLE[0] })
  const theirs = { ...copy, data: { ...copy.data, plan: patchSet(copy.data.plan, 'b0i0', 'b0i0s0', { reps: 8, weight: 40 }) } }
  const more = copyExercises(theirs, pull).data.plan.blocks[0].items[0].sets
  assert.equal(more.length, 2)
  assert.equal(more[0].typed, true, 'their own set lost its mark')
  assert.deepEqual([more[1].reps, more[1].weight, 'typed' in more[1]], [8, 40, false], 'the copied set reads as typed into')
})

test('a copy says it is in step from the server\'s flag, else from a sync base (#80)', () => {
  const copy = (from, extra = {}) => ({ id: 'c', data: { sharedFrom: from, ...extra } })
  assert.equal(inStep(copy({ id: 'owner', name: 'Alex', sync: true })), true)
  assert.equal(inStep(copy({ id: 'owner', name: 'Alex', sync: false }, { syncBase: { of: 'c', rev: 3, plan: [] } })), false, 'the flag must beat an old base')
  assert.equal(inStep(copy({ id: 'owner', name: 'Alex' }, { syncBase: { of: 'c', rev: 3, plan: [] } })), true, 'a copy from before the flag, stamped by sync')
  assert.equal(inStep(copy({ id: 'owner', name: 'Alex' })), false, 'a copy shared before sync existed')
  assert.equal(inStep({ id: 'o', data: { syncBase: { of: 'o', rev: 2, plan: [] } } }), false, 'the owner\'s own entry is no copy')
  assert.equal(inStepLine(copy({ id: 'owner', name: 'Alex', sync: true })), 'Exercises stay in step with Alex\u2019s')
  assert.equal(inStepLine(copy({ id: 'owner', name: 'Alex', sync: false })), null)
})

test('the owner\'s one sharing row: who, and whether they are in sync (#80)', () => {
  const e = (links) => ({ id: 'o', data: { sharedWith: links } })
  assert.deepEqual(shareSummary(e([]), []), { title: 'Add someone', sync: null })
  const sam = [{ id: 'sam', name: 'Sam' }]
  assert.deepEqual(shareSummary(e([{ id: 'sam', sync: true }]), sam), { title: 'with Sam', sync: 'in sync' })
  assert.deepEqual(shareSummary(e([{ id: 'sam' }]), sam), { title: 'with Sam', sync: 'not in sync' })
  const two = [{ id: 'sam', name: 'Sam' }, { id: 'jo', name: 'Jo' }]
  assert.deepEqual(shareSummary(e([{ id: 'sam', sync: true }, { id: 'jo' }]), two), { title: 'with Sam and Jo', sync: 'Sam in sync' })
})

test('a weight on their copy is their mark, typed or not: taking them off keeps it (#80, #96)', () => {
  const plan = (sets) => ({ blocks: [{ id: 'b0', items: [{ id: 'b0i0', kind: 'lift', name: 'Hip thrust', sets }] }] })
  const copy = (sets) => ({ id: 'daily-2026-11-04', data: { optId: 'planned', done: false, sharedFrom: { id: 'owner' }, plan: plan(sets), out: {} } })
  assert.equal(hasOwnMarks(copy([{ reps: 10, weight: null }])), false, 'the share\'s target reps are not theirs')
  assert.equal(hasOwnMarks(copy([{ reps: 10, weight: 50 }])), true, 'Sam\'s weight, typed before the mark, is not a mark')
  const own = { id: 'x', data: { optId: 'planned', done: false, plan: plan([{ reps: 10, weight: 50 }]), out: {} } }
  assert.equal(hasOwnMarks(own), false, 'an unmarked weight on an entry that is no copy may be a target')
})

/* ------------------------------------------- what a copy shows its person (#96) */

// The shape of a copy shared before `theirPlan` stripped the planner's words: the
// owner's reasoning, notes (the owner's recovery and weights), request and conversation.
const oldCopy = {
  id: 'daily-2026-10-13', kind: 'daily', date: '2026-10-13',
  data: {
    optId: 'planned', done: false, sharedFrom: { id: 'owner', name: 'Alex' },
    out: { activity: 'lift' },
    plan: {
      v: 1, title: 'Legs', category: 'lift', activity: 'lift', focus: null, minutes: 50,
      why: 'Your recovery is 51% today, so loads stay flat.', changed: 'Swapped the squat.',
      notes: ['Yellow/red recovery today (51%): holding loads flat.', 'Row has sat at 50 lb for two sessions.'],
      ask: 'legs, my knee is sore', thread: [{ role: 'you', text: 'easier please' }, { role: 'model', text: 'Done.' }],
      createdAt: 'x', model: 'm',
      blocks: [{ id: 'b0', name: 'Main', note: 'Chest and shoulders.', items: [
        { id: 'b0i0', kind: 'lift', name: 'Squat', note: '3x10 at 95 was RPE 6 last time — bump up 5 lb.',
          sets: [{ id: 's0', reps: 5, weight: null, note: 'Last logged 125/125/150, hold it.' }] }] }],
    },
  },
}

test('a copy never shows the owner\'s notes, reasoning, request or conversation, older copies included (#96)', () => {
  const shown = planShown(oldCopy)
  assert.deepEqual(shown.notes, [])
  assert.equal(shown.why, '')
  for (const k of ['ask', 'thread', 'changed']) assert.equal(k in shown, false, `${k} shown on a copy`)
  const it = shown.blocks[0].items[0]
  assert.equal(it.note, '', 'the planner\'s note on an exercise shown on a copy')
  assert.equal(it.sets[0].note, '', 'the planner\'s note on a set shown on a copy')
  assert.deepEqual([it.name, it.sets[0].reps], ['Squat', 5], 'the exercises are the copy\'s own')
  assert.equal(shown.blocks[0].note, 'Chest and shoulders.', 'a block\'s own prose is the workout, shared structure')
  assert.equal(planShown(oldCopy), shown, 'a new object every render')
  assert.equal(oldCopy.data.plan.notes.length, 2, 'the stored copy was rewritten')
  assert.match(oldCopy.data.plan.blocks[0].items[0].note, /RPE 6/, 'the stored copy was rewritten')
  // Words the person wrote with the model on their own copy are theirs.
  const theirs = ownWordsOn(oldCopy, { ...oldCopy.data.plan, why: 'Sam\'s own reasoning' })
  assert.equal(planShown({ ...oldCopy, data: { ...oldCopy.data, plan: theirs } }).why, 'Sam\'s own reasoning')
  assert.equal(ownWordsOn({ id: 'x', data: {} }, oldCopy.data.plan), oldCopy.data.plan, 'stamped on the owner\'s own plan')
  // The owner's own plan, and one planned for them alone (written from their own log), show as they are.
  const { sharedFrom: _f, ...own } = oldCopy.data
  assert.equal(planShown({ ...oldCopy, data: own }), own.plan)
  assert.equal(planShown({ ...oldCopy, data: { ...own, plannedBy: { id: 'owner', name: 'Alex' } } }).notes.length, 2)
  assert.equal(planShown({ id: 'x', data: {} }), null)
})

test('the filter is display only: an edit from her sheet lands on the stored plan, every hidden note byte for byte (#96 review 2)', () => {
  // daily-2026-10-20-planned's shape: an older copy, no uids, notes on the plan, each exercise and some sets.
  const set = (id, note = '') => ({ id, reps: 12, weight: 10, seconds: null, distance: null, restSec: null, unit: null, note })
  const item = (i, name, note, notes) => ({ id: `b0i${i}`, kind: 'lift', name, note, exercise: name.toLowerCase(), group: 'core',
    implement: 'dumbbell', implementLabel: 'Dumbbell', weightLabel: 'per hand', unit: null,
    sets: notes.map((n, j) => set(`b0i${i}s${j}`, n)) })
  const stored = {
    v: 1, title: 'Core & hips', category: 'support', activity: null, focus: null, minutes: 25,
    why: 'Your recovery was 48% this morning.', notes: ['Keep it light after Saturday.'], changed: null,
    createdAt: '2026-10-20T07:00:00Z', model: 'm', ask: 'something easy',
    blocks: [{ id: 'b0', name: 'Core', note: 'Slow and controlled.', category: 'support', activity: null, items: [
      item(0, 'Dead bug', 'Last logged 3x12 at bodyweight; add the 10 lb plate.', ['Owner: slow on the way down.', 'Owner: slow on the way down.', 'Owner: slow on the way down.']),
      item(1, 'Side plank', 'You skipped these on 10-16.', ['', '', '']),
      item(2, 'Bird dog', 'RPE 4 last time, go 2 more reps.', ['', '', '']),
    ] }],
  }
  const copy = { id: 'daily-2026-10-20-planned', kind: 'daily', date: '2026-10-20',
    data: { optId: 'planned', slot: 'extra', done: false, out: {}, sharedFrom: { id: 'owner', name: 'Alex' }, plan: stored } }
  const before = JSON.stringify(stored)
  // Her sheet shows the filtered plan; she edits a weight on it, and the sheet writes.
  const shown = planShown(copy)
  const edited = patchSet(shown, 'b0i1', 'b0i1s0', { weight: 15 })
  const written = withStoredWords(copy, edited)
  assert.equal(JSON.stringify(stored), before, 'the stored plan object was mutated')
  assert.deepEqual(written, patchSet(stored, 'b0i1', 'b0i1s0', { weight: 15 }), 'the write is not the stored plan with her edit')
  const notesOf = (p) => JSON.stringify(p.blocks.map(b => b.items.map(i => [i.note, i.sets.map(x => x.note)])))
  assert.equal(notesOf(written), notesOf(stored), 'an exercise or set note was lost')
  for (const k of ['why', 'notes', 'changed', 'ask']) assert.equal(JSON.stringify(written[k]), JSON.stringify(stored[k]), `${k} lost`)
  assert.equal('thread' in written, false, 'a key the stored plan never had was added')
  assert.equal(written.blocks[0].items[1].sets[0].weight, 15)
  // And what she sees after it is still the filtered plan.
  const after = planShown({ ...copy, data: { ...copy.data, plan: written } })
  assert.equal(notesOf(after), JSON.stringify([[['', ['', '', '']], ['', ['', '', '']], ['', ['', '', '']]]]))
  assert.equal(after.why, '')
  // Moved, removed and added: each stored note follows its own exercise; a new one has nothing to take.
  const moved = { ...shown, blocks: [{ ...shown.blocks[0], items: [shown.blocks[0].items[2], shown.blocks[0].items[0],
    { ...shown.blocks[0].items[0], id: 'new', name: 'Plank', exercise: 'plank' }] }] }
  const w2 = withStoredWords(copy, moved)
  assert.deepEqual(w2.blocks[0].items.map(i => i.note), ['RPE 4 last time, go 2 more reps.', 'Last logged 3x12 at bodyweight; add the 10 lb plate.', ''])
  // Not a copy, or words that are hers: nothing put back.
  const { sharedFrom: _f, ...own } = copy.data
  assert.equal(withStoredWords({ ...copy, data: own }, edited), edited)
  const hers = { ...edited, ownWords: true, why: 'Sam\'s own' }
  assert.equal(withStoredWords(copy, hers), hers)
})

test('a new share leaves out the owner\'s request too, not only the reasoning (#96)', () => {
  const { sharedFrom: _f, ...data } = oldCopy.data
  const copy = sharedCopy({ ...oldCopy, data }, { owner: PEOPLE[0] })
  for (const k of ['ask', 'thread', 'changed', 'draftId']) assert.equal(k in copy.data.plan, false, `${k} copied`)
  assert.equal(copy.data.plan.blocks[0].items[0].note, '', 'the planner\'s note on an exercise copied')
  assert.equal(copy.data.plan.blocks[0].items[0].sets[0].note, '', 'the planner\'s note on a set copied')
  assert.equal(copy.data.plan.why, '')
  assert.deepEqual(copy.data.plan.notes, [])
})

test('who a removal says the exercises stay in step with, from where the sheet stands (#96)', () => {
  const owners = { id: 'daily-2026-11-08', data: { sharedWith: [{ id: 'sam', entryId: 'daily-2026-11-08', sync: true }, { id: 'jo', entryId: 'x' }] } }
  const on = [{ id: 'sam', name: 'Sam' }, { id: 'jo', name: 'Jo' }]
  assert.deepEqual(syncedSides(owners, on, null), ['Sam'], 'the owner\'s side: only those in sync')
  assert.deepEqual(syncedSides(owners, on, on[0]), ['you'], 'Sam\'s side, from the owner\'s phone')
  assert.equal(syncedSides(owners, on, on[1]), null, 'Jo is not in sync')
  // Sam's own phone: the copy names nobody, and its removal reaches the owner's log too.
  const theirs = { id: 'daily-2026-11-08', data: { sharedFrom: { id: 'owner', name: 'Alex', sync: true } } }
  assert.deepEqual(syncedSides(theirs, [], null), ['Alex'])
  assert.equal(syncedSides({ ...theirs, data: { sharedFrom: { id: 'owner', name: 'Alex', sync: false } } }, [], null), null)
  assert.equal(syncedSides({ id: 'x', data: {} }, [], null), null)
})

test('#111 D F1: a set the owner typed crosses blank, by the first share and by Copy my exercises', () => {
  let mine = { blocks: [{ id: 'b0', name: 'Main', items: [{ id: 'b0i0', uid: 'u1', kind: 'lift', name: 'Bench press', exercise: 'bench-press',
    sets: [{ id: 'b0i0s0', reps: 8, weight: 135 }, { id: 'b0i0s1', reps: 8, weight: 135 }, { id: 'b0i0s2', reps: 8, weight: 135 }] }] }] }
  mine = patchSet(mine, 'b0i0', 'b0i0s0', { reps: 10 })
  mine = tickSet(mine, 'b0i0', 'b0i0s1', true)
  const owner = { id: 'daily-2026-11-08', kind: 'daily', date: '2026-11-08', data: { optId: 'planned', done: false, plan: mine } }
  const TODAY = '2026-11-08'
  const first = sharedCopy(owner, { owner: { id: 'owner', name: 'Alex' }, today: TODAY }).data.plan.blocks[0].items[0].sets
  const empty = (o) => { const c = sharedCopy(o, { today: TODAY }); return { ...c, data: { ...c.data, plan: { blocks: [] } } } }
  const copied = copyExercises(empty(owner), owner, TODAY).data.plan.blocks[0].items[0].sets
  for (const [how, sets] of [['the first share', first], ['Copy my exercises', copied]]) {
    assert.equal(sets[0].reps, null, `${how} carried the owner's typed 10 reps`)
    assert.equal(sets[1].reps, null, `${how} carried a set the owner ticked`)
    assert.equal(sets[2].reps, 8, `${how} lost an untouched target`)
    assert.ok(sets.every(x => x.weight === null && !x.typed && !x.ticked), `${how} carried a weight or a mark`)
  }
  // So nothing of the owner's reads as theirs the next day (D11).
  const theirs = { id: 'c', kind: 'daily', date: '2026-11-08', data: { done: false, plan: { blocks: [{ name: 'Main', items: [{ kind: 'lift', exercise: 'bench-press', sets: first }] }] } } }
  assert.deepEqual(liftsDone(theirs, '2026-11-09').flatMap(r => r.sets.map(x => x.reps)), [8], 'only the plan\'s target reads as done as written')
  // An interval's numbers are its shape, typed or not (server/sharedsync.js keeps them).
  assert.equal(crossingSet('interval', { seconds: 60, typed: true }).seconds, 60)
  // A plan for a LATER day: nothing is lifted yet, so a number typed there is planning
  // (patchSet marks every edit) and crosses as a target (#111 review). Wednesday's Row
  // set 1 edited to 6 reps on Tuesday: Sam gets 6, by either path; never the weight.
  const wednesday = { ...owner, id: 'daily-2026-11-11', date: '2026-11-11' }
  const later = sharedCopy(wednesday, { today: TODAY }).data.plan.blocks[0].items[0].sets
  const laterCopied = copyExercises(empty(wednesday), wednesday, TODAY).data.plan.blocks[0].items[0].sets
  for (const [how, sets] of [['the first share', later], ['Copy my exercises', laterCopied]]) {
    assert.deepEqual(sets.map(x => x.reps), [10, 8, 8], `${how} blanked a planned target on a later day`)
    assert.ok(sets.every(x => x.weight === null && !x.typed && !x.ticked), `${how} carried a weight or a mark`)
  }
  // The same workout once its day has come is the owner's log again.
  assert.equal(sharedCopy(wednesday, { today: '2026-11-11' }).data.plan.blocks[0].items[0].sets[0].reps, null)
})

for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok    ${name}`) } catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`) }
}
if (failed) { console.log(`\n${failed} shared test(s) failed`); process.exit(1) }
console.log('\nall shared tests pass')
