/* What Bushido is allowed to say, tested as arithmetic:
 *   node server/notify-facts.test.js
 *
 * The risk here is not a crash, it is a notification that is WRONG or merely
 * empty — "nice workout" with nothing after it, a readiness nudge on a day WHOOP
 * was still calibrating, a goal nudge built on a Strava metric nobody could read.
 * Each of those spends trust that is hard to get back, so what is pinned below is
 * mostly restraint.
 */

import {
  workoutLoggedFact, readinessFacts, unloggedFacts, goalPaceFacts, bodyWarningFacts,
  collectScheduledFacts, completedDailyEntries, isRestEntry,
} from './notify-facts.js'

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }

const NOW = Date.parse('2026-09-15T18:00:00Z')
const TODAY = '2026-09-15'

const entry = (over = {}) => ({
  id: 'e1', kind: 'daily', date: TODAY, deleted: false,
  data: { name: 'Zone 2 Ride', family: 'ride', done: true, out: { rpe: 6 } },
  ...over,
})

const goal = (over = {}) => ({
  id: 'g1', title: '50 Miles Biked', complete: false, periodState: 'active', daysLeft: 5,
  progress: { fraction: 0.58, percent: 58 },
  metrics: [{ label: 'Miles Biked', value: 29.2, targetValue: 50, unit: 'miles', available: true }],
  ...over,
})

console.log('\nworkout logged')

check('a logged ride names what it moved toward a goal', () => {
  const fact = workoutLoggedFact({ entry: entry(), goals: [goal()], now: NOW })
  eq(fact.category, 'workout.logged')
  eq(fact.title, 'Nice session — Zone 2 Ride')
  ok(/29.2 of 50 miles on 50 Miles Biked/.test(fact.body), fact.body)
  ok(/20.8 to go with 5 days left/.test(fact.body), fact.body)
})

check('with no matching goal it still says something true and short', () => {
  const fact = workoutLoggedFact({ entry: entry(), goals: [], now: NOW })
  eq(fact.body, 'Logged. RPE 6.')
})

check('a run does not claim credit against a cycling goal', () => {
  const run = entry({ data: { name: 'Easy Run', family: 'run', done: true, out: {} } })
  const fact = workoutLoggedFact({ entry: run, goals: [goal()], now: NOW })
  eq(fact.body, 'Logged.')
})

check('the nearest goal is the one named, not the first', () => {
  const far = goal({ id: 'g2', title: '3600 Miles Biked', metrics: [{ label: 'Miles Biked', value: 260, targetValue: 3600, unit: 'miles', available: true }] })
  const fact = workoutLoggedFact({ entry: entry(), goals: [far, goal()], now: NOW })
  ok(/50 Miles Biked/.test(fact.body), fact.body)
})

check('a goal he has already hit is not what the ride is measured against', () => {
  // Totem leaves completion to them, so a goal at 100% stays active and
  // `complete: false` — and since the nearest goal is the one named, a finished
  // one would win every sort. "0 to go with 14 days left" is arithmetic about a
  // question the user answered last week.
  const done = goal({ id: 'g3', title: 'Go for one mountain bike ride', progress: { fraction: 1, percent: 100 }, daysLeft: 14, metrics: [{ label: 'amount of mtn bike rides', value: 1, targetValue: 1, unit: 'times', available: true }] })
  const fact = workoutLoggedFact({ entry: entry(), goals: [done, goal()], now: NOW })
  ok(/50 Miles Biked/.test(fact.body), fact.body)
  ok(!/0 to go/.test(fact.body), fact.body)
  // And with nothing left to say, it says nothing rather than reading out a 100%.
  eq(workoutLoggedFact({ entry: entry(), goals: [done], now: NOW }).body, 'Logged. RPE 6.')
})

check('a metric Strava could not read is not counted as zero progress', () => {
  const unreadable = goal({ metrics: [{ label: 'Miles Biked', value: 0, targetValue: 50, unit: 'miles', available: false }] })
  eq(workoutLoggedFact({ entry: entry(), goals: [unreadable], now: NOW }).body, 'Logged. RPE 6.')
})

check('planning a session is not completing one', () => {
  // `done: false` is a session put on the day, not one the user did. Congratulating them
  // for planning is the fastest way to make the whole thing feel fake.
  eq(workoutLoggedFact({ entry: entry({ data: { name: 'x', done: false } }), now: NOW }), null)
  eq(workoutLoggedFact({ entry: entry({ deleted: true }), now: NOW }), null)
  eq(workoutLoggedFact({ entry: { kind: 'quota' }, now: NOW }), null)
})

check('it expires in hours, because it is a response and not a nudge', () => {
  const fact = workoutLoggedFact({ entry: entry(), now: NOW })
  ok(fact.expiresAt > NOW && fact.expiresAt <= NOW + 3 * 3600_000)
  eq(fact.revalidate, null)
})

check('a rest day is not a session', () => {
  // Pinned category, overrides quiet hours, cannot be muted. Twenty-seven of
  // these went out on 2026-09-16.
  eq(workoutLoggedFact({ entry: entry({ data: { name: 'Rest day', done: true } }), now: NOW }), null)
  eq(workoutLoggedFact({ entry: entry({ data: { optId: 'off', name: 'Deliberate rest', done: true } }), now: NOW }), null)
  ok(isRestEntry({ data: { name: 'Deliberate rest' } }))
  ok(!isRestEntry({ data: { optId: 'four-by-four', name: 'Rest between burns' } }), 'optId wins over the name')
})

check('a session from last month is history, not news', () => {
  eq(workoutLoggedFact({ entry: entry({ date: '2026-08-02' }), now: NOW }), null)
  eq(workoutLoggedFact({ entry: entry({ date: 'whenever' }), now: NOW }), null)
  // A day either side survives: the user logs at 9pm their time, which is tomorrow in UTC.
  ok(workoutLoggedFact({ entry: entry({ date: '2026-09-14' }), now: NOW }))
  ok(workoutLoggedFact({ entry: entry({ date: '2026-09-16' }), now: NOW }))
})

check('an entry with no date falls back to when it was written', () => {
  const dateless = { id: 'e9', kind: 'daily', updatedAt: '2026-09-15T17:00:00Z', data: { name: 'Bike', done: true } }
  ok(workoutLoggedFact({ entry: dateless, now: NOW }))
  eq(workoutLoggedFact({ entry: { ...dateless, updatedAt: '2026-06-01T17:00:00Z' }, now: NOW }), null)
  eq(workoutLoggedFact({ entry: { ...dateless, updatedAt: undefined }, now: NOW }), null)
})

console.log('\nwhat a sync is allowed to announce')

/* The 2026-09-16 incident: the client PUTs the whole log on every sync, the
 * server announced the payload rather than the change, and one edit on the
 * desktop put 63 notifications on their phone — four times in ninety seconds. */
const logged = (id, at, done = true) => [id, { id, kind: 'daily', date: TODAY, updatedAt: at, data: { name: id, done } }]
const planned = (id, at) => logged(id, at, false)
const before = { entries: Object.fromEntries([logged('a', '2026-09-15T10:00:00Z'), planned('b', '2026-09-15T11:00:00Z')]) }

check('a full-log re-send announces nothing', () => {
  eq(completedDailyEntries(before, before).length, 0)
})

check('the one entry he actually finished is the only one announced', () => {
  const payload = { entries: { ...before.entries, ...Object.fromEntries([logged('b', '2026-09-15T18:00:00Z')]) } }
  eq(completedDailyEntries(payload, before).map(e => e.id), ['b'])
})

check('a brand new entry is announced, whatever else rode along with it', () => {
  const payload = { entries: { ...before.entries, ...Object.fromEntries([logged('c', '2026-09-15T18:00:00Z')]) } }
  eq(completedDailyEntries(payload, before).map(e => e.id), ['c'])
})

check('a stale copy from the other device is not news either', () => {
  // Exactly what mergeState does with it: nothing. So there is nothing to say.
  const payload = { entries: Object.fromEntries([logged('a', '2026-09-15T09:00:00Z')]) }
  eq(completedDailyEntries(payload, before).length, 0)
})

/* The 2026-09-19 one, and the reason `before` alone was not enough: the ride the user
 * logged at 22:24 was announced again at 09:20 the next morning, when the other
 * device caught up and landed its own slightly newer copy of the same finished
 * entry. A session becomes news once, when it becomes done. */
check('a session already done is never announced again, however new the copy', () => {
  const payload = { entries: Object.fromEntries([logged('a', '2026-09-16T09:20:00Z')]) }
  eq(completedDailyEntries(payload, before).length, 0)
})

check('editing a finished session is not finishing one', () => {
  // Adding the RPE, attaching the ride, correcting the minutes: all of it lands
  // as a newer copy of a session the user has already been congratulated for.
  const corrected = { id: 'a', kind: 'daily', date: TODAY, updatedAt: '2026-09-15T20:00:00Z', data: { name: 'a', done: true, out: { rpe: 7 } } }
  eq(completedDailyEntries({ entries: { a: corrected } }, before).length, 0)
})

check('planning a session announces nothing until it is done', () => {
  const still = { entries: Object.fromEntries([planned('b', '2026-09-15T18:00:00Z')]) }
  eq(completedDailyEntries(still, before).length, 0)
  const d = { entries: Object.fromEntries([logged('b', '2026-09-15T19:00:00Z')]) }
  eq(completedDailyEntries(d, before).map(e => e.id), ['b'])
})

check('an absent done still means done, the way the rest of the app reads it', () => {
  const old = { id: 'z', kind: 'daily', date: TODAY, updatedAt: '2026-09-15T18:00:00Z', data: { name: 'z' } }
  eq(completedDailyEntries({ entries: { z: old } }, before).map(e => e.id), ['z'])
  // ...and equally on the copy already stored, so it cannot be announced twice.
  const again = { ...old, updatedAt: '2026-09-15T19:00:00Z' }
  eq(completedDailyEntries({ entries: { z: again } }, { entries: { z: old } }).length, 0)
})

check('deleting a session is not completing one', () => {
  const gone = { id: 'a', kind: 'daily', date: TODAY, updatedAt: '2026-09-15T20:00:00Z', deleted: true, data: { name: 'a', done: true } }
  eq(completedDailyEntries({ entries: { a: gone } }, before).length, 0)
})

check('only daily entries are ever candidates', () => {
  const payload = { entries: { g1: { id: 'g1', kind: 'gear', updatedAt: '2026-09-15T18:00:00Z' } } }
  eq(completedDailyEntries(payload, before).length, 0)
  eq(completedDailyEntries({}, before).length, 0)
  eq(completedDailyEntries(null, before).length, 0)
})

check('first boot, with nothing on disk, announces the write', () => {
  const payload = { entries: Object.fromEntries([logged('a', '2026-09-15T10:00:00Z')]) }
  eq(completedDailyEntries(payload, { entries: {} }).map(e => e.id), ['a'])
})

console.log('\nreadiness')

const whoopWith = (rows) => ({ recovery: rows })

check('a green morning reads as permission, a red one as a brake', () => {
  eq(readinessFacts({ whoop: whoopWith([{ date: TODAY, recovery: 72 }]), now: NOW })[0].kind, 'readiness.green')
  eq(readinessFacts({ whoop: whoopWith([{ date: TODAY, recovery: 50 }]), now: NOW })[0].kind, 'readiness.yellow')
  const red = readinessFacts({ whoop: whoopWith([{ date: TODAY, recovery: 25 }]), now: NOW })[0]
  eq(red.kind, 'readiness.red')
  ok(red.salience > 60, 'a red day should outrank a green one')
})

check('a calibrating or missing score says nothing at all', () => {
  eq(readinessFacts({ whoop: whoopWith([{ date: TODAY, recovery: 40, calibrating: true }]), now: NOW }).length, 0)
  eq(readinessFacts({ whoop: whoopWith([{ date: TODAY }]), now: NOW }).length, 0)
  eq(readinessFacts({ whoop: whoopWith([{ date: '2026-09-14', recovery: 70 }]), now: NOW }).length, 0)
  eq(readinessFacts({ whoop: null, now: NOW }).length, 0)
})

console.log('\nunlogged workouts')

const stateWith = (entries) => ({ entries: Object.fromEntries(entries.map((e) => [e.id, e])) })

check('a recorded workout with no entry for that day is one fact, not one each', () => {
  const facts = unloggedFacts({
    state: stateWith([]),
    strava: { activities: [{ date: TODAY, name: 'Evening Ride' }, { date: '2026-09-14', name: 'Morning Run' }] },
    whoop: { workouts: [{ date: TODAY, sport: 'cycling' }] },
    now: NOW,
  })
  eq(facts.length, 1)
  ok(/3 workouts aren't logged/.test(facts[0].title), facts[0].title)
})

check('a day that has a logged session is not chased', () => {
  const facts = unloggedFacts({
    state: stateWith([entry()]),
    strava: { activities: [{ date: TODAY, name: 'Evening Ride' }] },
    now: NOW,
  })
  eq(facts.length, 0)
})

check('old recordings fall out of the window rather than nagging forever', () => {
  const facts = unloggedFacts({
    state: stateWith([]),
    strava: { activities: [{ date: '2026-09-01', name: 'Ancient Ride' }] },
    now: NOW,
  })
  eq(facts.length, 0)
})

console.log('\ngoal pace')

check('a goal within reach gets a concrete ask, not a percentage', () => {
  const near = goal({ progress: { fraction: 0.8, percent: 80 }, metrics: [{ label: 'Miles Biked', value: 40, targetValue: 50, unit: 'miles', available: true }] })
  const [fact] = goalPaceFacts({ goals: [near], now: NOW })
  eq(fact.title, '10 miles from 50 Miles Biked')
  ok(/one session/i.test(fact.body), fact.body)
})

check('a goal behind with the window closing says what per day it needs', () => {
  const behind = goal({ daysLeft: 2, progress: { fraction: 0.2, percent: 20 }, metrics: [{ label: 'Miles Biked', value: 10, targetValue: 50, unit: 'miles', available: true }] })
  const [fact] = goalPaceFacts({ goals: [behind], now: NOW })
  eq(fact.title, '50 Miles Biked needs 20 miles a day')
})

check('a goal that is merely in progress says nothing', () => {
  eq(goalPaceFacts({ goals: [goal()], now: NOW }).length, 0)
})

check('completed, expired and unreadable goals are all silent', () => {
  eq(goalPaceFacts({ goals: [goal({ complete: true })], now: NOW }).length, 0)
  eq(goalPaceFacts({ goals: [goal({ periodState: 'expired' })], now: NOW }).length, 0)
  eq(goalPaceFacts({ goals: [goal({ progress: { fraction: null, percent: null } })], now: NOW }).length, 0)
  eq(goalPaceFacts({ goals: null, now: NOW }).length, 0)
})

check('a goal whose numbers are on its steps is still read', () => {
  // The shape this exists for: "complete cardio goals", with "2 bike rides (10+
  // miles)" under it. Reading `goal.metrics` alone made the goals most worth saying
  // something about the ones that never had anything said.
  const cardio = goal({
    title: 'Complete cardio goals', daysLeft: 2, progress: { fraction: 0.25, percent: 25 },
    metrics: [],
    subGoals: [{
      id: 's1', title: '2 bike rides (10+ miles)', complete: false, abandoned: false,
      metrics: [{ label: 'bike miles', value: 5, targetValue: 20, unit: 'miles', available: true }],
    }],
  })
  const [fact] = goalPaceFacts({ goals: [cardio], now: NOW })
  eq(fact.title, 'Complete cardio goals needs 7.5 miles a day')

  // And a ride announces itself against it, naming the step's number.
  const moved = workoutLoggedFact({ entry: entry(), goals: [cardio], now: NOW })
  ok(/5 of 20 miles on Complete cardio goals/.test(moved.body), moved.body)
})

check('a step already done, or decided against, is not something to chase', () => {
  const withSteps = (over) => goal({
    metrics: [], daysLeft: 2, progress: { fraction: 0.2, percent: 20 },
    subGoals: [{ id: 's1', title: 'ride', metrics: [{ label: 'bike miles', value: 5, targetValue: 20, unit: 'miles', available: true }], ...over }],
  })
  eq(goalPaceFacts({ goals: [withSteps({ abandoned: true })], now: NOW }).length, 0)
  eq(goalPaceFacts({ goals: [withSteps({ complete: true })], now: NOW }).length, 0)
})

console.log('\nbody warning')

check('three days under 40% is worth interrupting for; two is not', () => {
  const low = [{ date: '2026-09-15', recovery: 30 }, { date: '2026-09-14', recovery: 28 }, { date: '2026-09-13', recovery: 35 }]
  eq(bodyWarningFacts({ whoop: { recovery: low }, now: NOW }).length, 1)
  const mixed = [{ date: '2026-09-15', recovery: 30 }, { date: '2026-09-14', recovery: 55 }, { date: '2026-09-13', recovery: 35 }]
  eq(bodyWarningFacts({ whoop: { recovery: mixed }, now: NOW }).length, 0)
})

console.log('\ncollection')

check('the scheduled collection never includes the workout-logged fact', () => {
  // That one is event-driven: it fires on the write, while the user is still getting
  // their shoes off. Planning it would make it a report.
  const facts = collectScheduledFacts({
    state: stateWith([entry()]),
    whoop: { recovery: [{ date: TODAY, recovery: 72 }] },
    goals: [goal()],
    now: NOW,
  })
  ok(!facts.some((f) => f.category === 'workout.logged'))
  ok(facts.some((f) => f.category === 'readiness.morning'))
})

check('an empty box produces no facts rather than an error', () => {
  eq(collectScheduledFacts({ now: NOW }).length, 0)
})

console.log(failed ? `\n${failed} notify-facts test(s) FAILED\n` : '\nall notify-facts tests pass\n')
process.exit(failed ? 1 : 0)
