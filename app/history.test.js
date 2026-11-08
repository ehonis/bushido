/* "The last N times you did this": which earlier entries are this workout (#74):
 *   node app/history.test.js
 *
 * Every planned workout is the `planned` card and every free-form one
 * `log-workout`, so history by card id listed a Pull day's Core & hips and Leg
 * day, and a Lift's walks and rides. Containers are matched by what they are.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { priorSessions, priorIdsOf, samePlanned } from './src/lib/history.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const card = (id) => plan.dailyMenu.find(m => m.id === id)
const PLANNED = card('planned')
const LOG = card('log-workout')

let failed = 0
let passed = 0
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  PASS  ${name}`) } catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}

const planned = (date, title, exercises, data = {}) => ({
  id: `daily-${date}-${title}`, kind: 'daily', date,
  data: { optId: 'planned', name: title, done: true, out: { activity: 'lift', category: 'lift' },
    plan: { title, blocks: [{ id: 'b0', name: title, items: exercises.map((x, i) => ({ id: `b0i${i}`, kind: 'lift', name: x, exercise: x, sets: [{ id: `b0i${i}s0`, reps: 10, weight: 50 }] })) }] },
    ...data },
})
const logged = (date, activity, data = {}) => ({ id: `daily-${date}-${activity}`, kind: 'daily', date,
  data: { optId: 'log-workout', name: activity, done: true, out: { activity }, ...data } })

// The owner's own pull days, as the seed log has them.
const PULL = planned('2026-11-07', 'Pull', ['bent-over-row', 'preacher-curl', 'pull-up', 'dumbbell-curl', 'face-pull', 'seated-cable-row'])
const LOGBOOK = [
  PULL,
  planned('2026-11-07', 'Core & hips', ['crunch', 'hanging-leg-raise', 'torso-rotation-machine']),
  planned('2026-11-04', 'Leg day', ['leg-press', 'hip-adduction', 'hip-abduction', 'hip-thrust']),
  planned('2026-10-24', 'Push', ['bench-press', 'seated-shoulder-press', 'chest-fly', 'lateral-raise', 'triceps-dip']),
  planned('2026-10-20', 'Pull day', ['bent-over-row', 'dumbbell-curl', 'pull-up', 'wrist-curl', 'reverse-wrist-curl']),
  planned('2026-10-16', 'Push/Pull — full upper body', ['bench-press', 'overhead-press', 'triceps-pushdown', 'bent-over-row', 'face-pull']),
  planned('2026-10-10', 'Pull day', ['lat-pulldown', 'bent-over-row', 'dumbbell-curl', 'seated-cable-row']),
  logged('2026-11-05', 'walk'), logged('2026-11-03', 'bike'), logged('2026-11-01', 'lift'), logged('2026-10-28', 'lift'),
]
const dates = (list) => list.map(e => `${e.date} ${e.data.name}`)

test('a planned workout’s history is the same workout: by title, or mostly the same exercises', () => {
  assert.deepEqual(dates(priorSessions(LOGBOOK, PLANNED, PULL.id)), ['2026-10-20 Pull day', '2026-10-10 Pull day'])
})

test('...not the other plans that day, a push day that shares a bench, or the free-form logs', () => {
  const names = dates(priorSessions(LOGBOOK, PLANNED, PULL.id)).join(',')
  for (const no of ['Core & hips', 'Leg day', 'Push', 'Push/Pull', 'walk', 'lift']) assert.ok(!names.includes(no), `${no} in a Pull's history`)
})

test('the same title is the same workout, whatever its exercises; one shared exercise is not', () => {
  const core = LOGBOOK[1]
  const older = planned('2026-10-16', 'Core & Hips', ['dead-bug'])
  assert.deepEqual(dates(priorSessions([core, older], PLANNED, core.id)), ['2026-10-16 Core & Hips'])
  assert.equal(samePlanned(planned('2026-01-01', 'A', ['crunch', 'plank']), planned('2026-01-02', 'B', ['crunch', 'squat'])), false)
})

test('a free-form workout’s history is the same card logged as the same activity', () => {
  const now = logged('2026-11-08', 'lift')
  assert.deepEqual(dates(priorSessions([...LOGBOOK, now], LOG, now.id)), ['2026-11-01 lift', '2026-10-28 lift'])
  // With no activity to go on there is no history, never somebody else's.
  const bare = { ...logged('2026-11-08', 'x'), data: { optId: 'log-workout', done: true, out: {} } }
  assert.deepEqual(priorSessions([...LOGBOOK, bare], LOG, bare.id), [])
})

test('the entry is found by its id when it is not passed, and can be passed for someone else’s log', () => {
  assert.equal(priorSessions(LOGBOOK, PLANNED, PULL.id, PULL).length, 2)
  assert.equal(priorSessions(LOGBOOK, PLANNED, 'not-in-the-log').length, 0, 'a container with no entry guessed')
})

test('times you DID it: not a plan still to come or untouched today, not one marked undone', () => {
  const ahead = planned('2999-01-01', 'Pull day', ['bent-over-row', 'dumbbell-curl'], { done: false })
  const undone = planned('2026-10-30', 'Pull day', ['bent-over-row', 'dumbbell-curl'], { done: false, undone: true })
  assert.deepEqual(dates(priorSessions([...LOGBOOK, ahead, undone], PLANNED, PULL.id)), ['2026-10-20 Pull day', '2026-10-10 Pull day'])
})

test('a past workout’s last times are the ones before it, never after (#96)', () => {
  const oct20 = LOGBOOK.find(e => e.date === '2026-10-20')
  assert.deepEqual(dates(priorSessions(LOGBOOK, PLANNED, oct20.id)), ['2026-10-10 Pull day'], 'Nov 7’s Pull listed as an earlier time')
  // The same day, in the day list's order: the main session, then the extras by id.
  const day = (id, slot, name) => ({ ...planned('2026-11-12', name, ['bent-over-row', 'dumbbell-curl', 'pull-up'], {}), id,
    data: { ...planned('2026-11-12', name, ['bent-over-row', 'dumbbell-curl', 'pull-up']).data, slot } })
  const am = day('daily-2026-11-12', 'main', 'Pull AM')
  const pm = day('daily-2026-11-12-planned', 'extra', 'Pull PM')
  const late = day('daily-2026-11-12-planned-2', 'extra', 'Pull late')
  const log = [...LOGBOOK, am, pm, late]
  assert.deepEqual(dates(priorSessions(log, PLANNED, pm.id)).slice(0, 2), ['2026-11-12 Pull AM', '2026-11-07 Pull'], 'earlier today is gone, or not first')
  assert.deepEqual(dates(priorSessions(log, PLANNED, late.id)).slice(0, 3), ['2026-11-12 Pull PM', '2026-11-12 Pull AM', '2026-11-07 Pull'])
  assert.equal(dates(priorSessions(log, PLANNED, am.id)).some(d => d.startsWith('2026-11-12')), false, 'a later session of the same day listed as before')
  // Where both say when they started, that decides: an extra done at seven beats the main one at six in the evening.
  const at = (e, iso, how) => ({ ...e, data: { ...e.data, ...(how === 'run' ? { run: { startedAt: Date.parse(iso) } } : { out: { ...e.data.out, whoop: { start: iso } } }) } })
  const timed = [...LOGBOOK, at(am, '2026-11-12T18:00:00Z', 'run'), at(pm, '2026-11-12T07:00:00Z', 'whoop'), late]
  assert.deepEqual(dates(priorSessions(timed, PLANNED, am.id)).slice(0, 2), ['2026-11-12 Pull PM', '2026-11-07 Pull'], 'the earlier start is not "before"')
  assert.equal(dates(priorSessions(timed, PLANNED, pm.id)).some(d => d.startsWith('2026-11-12')), false)
  // Untimed itself, the late extra still comes after both by the day list; between them, their times say
  // the main one (18:00) is the newer.
  assert.deepEqual(dates(priorSessions(timed, PLANNED, late.id)).slice(0, 3), ['2026-11-12 Pull AM', '2026-11-12 Pull PM', '2026-11-07 Pull'])
  // A card with no entry to stand on is not bounded.
  const board = { id: 'board' }
  const e = (date) => ({ id: date, kind: 'daily', date, data: { optId: 'board', done: true, out: {} } })
  assert.equal(priorSessions([e('2026-11-01'), e('2026-10-01')], board, null).length, 2)
  assert.deepEqual(priorSessions([e('2026-11-01'), e('2026-10-01')], board, '2026-10-01').map(x => x.date), [])
})

test('a card that is not a container is still its own history, renames and splits included', () => {
  const board = { id: 'board', aka: ['old-board'], priorIds: ['hard-home'] }
  assert.deepEqual(priorIdsOf(board), ['board', 'old-board', 'hard-home'])
  const e = (date, optId) => ({ id: `${date}-${optId}`, kind: 'daily', date, data: { optId, done: true, out: {} } })
  const log = [e('2026-11-01', 'board'), e('2026-10-01', 'old-board'), e('2026-09-01', 'hard-home'), e('2026-08-01', 'max-hangs')]
  assert.deepEqual(priorSessions(log, board, null).map(x => x.date), ['2026-11-01', '2026-10-01', '2026-09-01'])
})

test('the phone runs the same lift and history readers: its copies are the web\u2019s, byte for byte', () => {
  // mobile/AGENTS.md: src/lib/ is app/src/lib/ at the same paths. These are the
  // readers #74 changed, and a copy that drifts is "last time" disagreeing by device.
  for (const f of ['history', 'lifts', 'metrics', 'scope', 'category', 'shared', 'prescription', 'trainer']) {
    const web = readFileSync(new URL(`./src/lib/${f}.js`, import.meta.url), 'utf8')
    const phone = readFileSync(new URL(`../mobile/src/lib/${f}.js`, import.meta.url), 'utf8')
    assert.equal(phone, web, `mobile/src/lib/${f}.js drifted from the web's`)
  }
})

console.log(`history: ${passed} passed${failed ? `, ${failed} failed` : ''}`)
process.exit(failed ? 1 : 0)
