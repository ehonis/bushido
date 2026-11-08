// Shared workouts: one workout, two logs. What is copied, which id the copy
// takes, and when taking someone off asks first. See src/lib/shared.js.
import assert from 'node:assert/strict'
import {
  sharePeople, sharedWithOf, sharedPeopleOn, withLine, sharedOut, hasOwnMarks, copyIdFor,
  sharedCopy, withSharedPerson, addPerson, removePerson, copyExercises, hasExercises,
  isSynced, withSync, openSide,
} from './src/lib/shared.js'
import { withAck, adoptAcks } from './src/lib/store.js'
import { createCopyQueue, openedCopy } from './src/lib/copyqueue.js'
import { patchSet, dropEmptyBlocks, keepTyped } from './src/lib/prescription.js'

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

test('taking them off: quiet when they have marked nothing, asks first when they have', async () => {
  const api = fakeApi()
  const added = (await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, api })).ownerEntry
  let asked = 0
  const no = async () => { asked++; return false }
  const quiet = await removePerson({ ownerEntry: added, person: PEOPLE[1], session: workoutCard, api, confirmFn: no })
  assert.equal(asked, 0, 'asked about an untouched copy')
  assert.equal(api.log.get(ride.id).deleted, true, 'not a tombstone')
  assert.equal(quiet.data.sharedWith, undefined)

  const api2 = fakeApi()
  const added2 = (await addPerson({ ownerEntry: ride, person: PEOPLE[1], session: workoutCard, api: api2 })).ownerEntry
  api2.log.set(ride.id, { ...api2.log.get(ride.id), data: { ...api2.log.get(ride.id).data, done: true } })
  assert.equal(await removePerson({ ownerEntry: added2, person: PEOPLE[1], session: workoutCard, api: api2, confirmFn: no }), null)
  assert.equal(asked, 1)
  assert.equal(api2.log.get(ride.id).deleted, undefined, 'a no still removed their done session')
  const yes = await removePerson({ ownerEntry: added2, person: PEOPLE[1], session: workoutCard, api: api2, confirmFn: async () => true })
  assert.equal(api2.log.get(ride.id).deleted, true)
  assert.equal(yes.data.sharedWith, undefined)
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

for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok    ${name}`) } catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`) }
}
if (failed) { console.log(`\n${failed} shared test(s) failed`); process.exit(1) }
console.log('\nall shared tests pass')
