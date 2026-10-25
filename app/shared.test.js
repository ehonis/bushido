// Shared workouts: one workout, two logs. What is copied, which id the copy
// takes, and when taking someone off asks first. See src/lib/shared.js.
import assert from 'node:assert/strict'
import {
  sharePeople, sharedWithOf, sharedPeopleOn, withLine, sharedOut, hasOwnMarks, copyIdFor,
  sharedCopy, withSharedPerson, addPerson, removePerson, copyExercises, hasExercises,
  isSynced, withSync, openSide,
} from './src/lib/shared.js'

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

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok    ${name}`) } catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`) }
}
if (failed) { console.log(`\n${failed} shared test(s) failed`); process.exit(1) }
console.log('\nall shared tests pass')
