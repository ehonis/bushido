// Shared workouts: one workout, two logs. What is copied, which id the copy
// takes, and when taking someone off asks first. See src/lib/shared.js.
import assert from 'node:assert/strict'
import {
  sharePeople, sharedWithOf, sharedPeopleOn, withLine, sharedOut, hasOwnMarks, copyIdFor,
  sharedCopy, withSharedPerson, addPerson, removePerson,
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

test('the copy carries the workout and none of the owner\'s own numbers', () => {
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
  assert.deepEqual(sharedWithOf(e), [{ id: 'sam', entryId: ride.id }])
  assert.deepEqual(sharedWithOf(withSharedPerson(e, 'sam', ride.id)), [{ id: 'sam', entryId: ride.id }], 'added twice')
  assert.equal(sharedPeopleOn(e, PEOPLE)[0].name, 'Sam')
  assert.equal(withLine(e, PEOPLE), 'with Sam')
  assert.equal(withLine({ data: { sharedFrom: { id: 'owner', name: 'Alex' } } }), 'with Alex')
  assert.equal(withLine(ride, PEOPLE), null)
  assert.equal(withSharedPerson(e, 'sam', null, { remove: true }).data.sharedWith, undefined)
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
  assert.deepEqual(sharedWithOf(ownerEntry), [{ id: 'sam', entryId: ride.id }])
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

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok    ${name}`) } catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`) }
}
if (failed) { console.log(`\n${failed} shared test(s) failed`); process.exit(1) }
console.log('\nall shared tests pass')
