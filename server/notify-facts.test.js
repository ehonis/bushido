/* What Bushido is allowed to say, tested as arithmetic:
 *   node server/notify-facts.test.js
 *
 * The risk here is not a crash, it is a notification that is WRONG or merely
 * empty — "nice workout" with nothing after it, a readiness nudge on a day WHOOP
 * was still calibrating.
 * Each of those spends trust that is hard to get back, so what is pinned below is
 * mostly restraint.
 */

import {
  workoutLoggedFact, readinessFacts, unloggedFacts, bodyWarningFacts,
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

console.log('\nworkout logged')

check('a logged ride says what was logged, short and true', () => {
  // It used to name the linked Totem goal the ride moved; linked goals were
  // removed on 2026-10-25 (issue #31), and an old goals cache must not bring it back.
  const fact = workoutLoggedFact({ entry: entry(), goals: [{ title: '50 Miles Biked' }], now: NOW })
  eq(fact.category, 'workout.logged')
  eq(fact.title, 'Nice session — Zone 2 Ride')
  eq(fact.body, 'Logged. RPE 6.')
  const run = entry({ data: { name: 'Easy Run', family: 'run', done: true, out: {} } })
  eq(workoutLoggedFact({ entry: run, now: NOW }).body, 'Logged.')
})

check('an entry not marked done is not announced', () => {
  // `done: false` is a session planned ahead or marked undone: no write said the user
  // did it. Congratulating them for a plan is the fastest way to make the whole thing
  // feel fake.
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
const completed = (incoming, before) => completedDailyEntries(incoming, before, TODAY)
// Logged: done, with an effort on it. (Done with nothing on it is a session put on
// today, which is not news yet; see the cases further down.)
const logged = (id, at, done = true) => [id, { id, kind: 'daily', date: TODAY, updatedAt: at, data: { name: id, done, out: { rpe: 6 } } }]
const planned = (id, at) => logged(id, at, false)
const before = { entries: Object.fromEntries([logged('a', '2026-09-15T10:00:00Z'), planned('b', '2026-09-15T11:00:00Z')]) }

check('a full-log re-send announces nothing', () => {
  eq(completed(before, before).length, 0)
})

check('the one entry he actually finished is the only one announced', () => {
  const payload = { entries: { ...before.entries, ...Object.fromEntries([logged('b', '2026-09-15T18:00:00Z')]) } }
  eq(completed(payload, before).map(e => e.id), ['b'])
})

check('a brand new entry is announced, whatever else rode along with it', () => {
  const payload = { entries: { ...before.entries, ...Object.fromEntries([logged('c', '2026-09-15T18:00:00Z')]) } }
  eq(completed(payload, before).map(e => e.id), ['c'])
})

check('a stale copy from the other device is not news either', () => {
  // Exactly what mergeState does with it: nothing. So there is nothing to say.
  const payload = { entries: Object.fromEntries([logged('a', '2026-09-15T09:00:00Z')]) }
  eq(completed(payload, before).length, 0)
})

/* The 2026-09-19 one, and the reason `before` alone was not enough: the ride the user
 * logged at 22:24 was announced again at 09:20 the next morning, when the other
 * device caught up and landed its own slightly newer copy of the same finished
 * entry. A session becomes news once, when it becomes done. */
check('a session already done is never announced again, however new the copy', () => {
  const payload = { entries: Object.fromEntries([logged('a', '2026-09-16T09:20:00Z')]) }
  eq(completed(payload, before).length, 0)
})

check('editing a finished session is not finishing one', () => {
  // Adding the RPE, attaching the ride, correcting the minutes: all of it lands
  // as a newer copy of a session the user has already been congratulated for.
  const corrected = { id: 'a', kind: 'daily', date: TODAY, updatedAt: '2026-09-15T20:00:00Z', data: { name: 'a', done: true, out: { rpe: 7 } } }
  eq(completed({ entries: { a: corrected } }, before).length, 0)
})

check('planning a session announces nothing until it is done', () => {
  const still = { entries: Object.fromEntries([planned('b', '2026-09-15T18:00:00Z')]) }
  eq(completed(still, before).length, 0)
  const d = { entries: Object.fromEntries([logged('b', '2026-09-15T19:00:00Z')]) }
  eq(completed(d, before).map(e => e.id), ['b'])
})

check('an absent done still means done, the way the rest of the app reads it', () => {
  const old = { id: 'z', kind: 'daily', date: TODAY, updatedAt: '2026-09-15T18:00:00Z', data: { name: 'z', out: { rpe: 5 } } }
  eq(completed({ entries: { z: old } }, before).map(e => e.id), ['z'])
  // ...and equally on the copy already stored, so it cannot be announced twice.
  const again = { ...old, updatedAt: '2026-09-15T19:00:00Z' }
  eq(completed({ entries: { z: again } }, { entries: { z: old } }).length, 0)
})

check('deleting a session is not completing one', () => {
  const gone = { id: 'a', kind: 'daily', date: TODAY, updatedAt: '2026-09-15T20:00:00Z', deleted: true, data: { name: 'a', done: true } }
  eq(completed({ entries: { a: gone } }, before).length, 0)
})

check('only daily entries are ever candidates', () => {
  const payload = { entries: { g1: { id: 'g1', kind: 'gear', updatedAt: '2026-09-15T18:00:00Z' } } }
  eq(completed(payload, before).length, 0)
  eq(completed({}, before).length, 0)
  eq(completed(null, before).length, 0)
})

/* Done by default (2026-10-25, AGENTS.md §4). An entry for today is written done,
 * so creating it is the news. One planned for a later day reads as done from its
 * day on WITHOUT a write, and that is never news; a write that marks it done is. */
const ahead = (at, data = {}) => ({ id: 'p', kind: 'daily', date: TODAY, updatedAt: at,
  data: { name: 'p', done: false, ...data } })

check('a planned session\'s day arriving announces nothing, on any re-send', () => {
  // Planned yesterday for today. It is done by the read rule now, and every
  // device re-sends it with a newer stamp as it catches up. Still nothing.
  const stored = { entries: { p: ahead('2026-09-14T20:00:00Z') } }
  eq(completed({ entries: { p: ahead('2026-09-15T07:00:00Z') } }, stored).length, 0)
  eq(completed({ entries: { p: ahead('2026-09-15T08:00:00Z', { out: { rpe: 6 } }) } }, stored).length, 0,
    'logging an effort on it is an edit, not a completion')
})

check('finishing a planned session on its day is announced exactly once', () => {
  const stored = { entries: { p: ahead('2026-09-14T20:00:00Z') } }
  const finished = ahead('2026-09-15T19:00:00Z', { done: true, run: { endedAt: 1 } })
  eq(completed({ entries: { p: finished } }, stored).map(e => e.id), ['p'])
  const resent = { ...finished, updatedAt: '2026-09-15T19:05:00Z' }
  eq(completed({ entries: { p: resent } }, { entries: { p: finished } }).length, 0)
})

check('"Mark undone" announces nothing; "Mark done" after it is one announcement', () => {
  const done = { id: 'u', kind: 'daily', date: TODAY, updatedAt: '2026-09-15T10:00:00Z', data: { name: 'u', done: true, out: { rpe: 6 } } }
  const undone = { ...done, updatedAt: '2026-09-15T11:00:00Z', data: { name: 'u', done: false, undone: true } }
  eq(completed({ entries: { u: undone } }, { entries: { u: done } }).length, 0)
  const redone = { ...done, updatedAt: '2026-09-15T12:00:00Z', data: { name: 'u', done: true, doneAt: '2026-09-15T12:00:00Z' } }
  eq(completed({ entries: { u: redone } }, { entries: { u: undone } }).map(e => e.id), ['u'])
})

/* Owner decision on #27: a session picked for today lands done (AGENTS.md §4) and
 * counts for the habit at once, but the push waits until there is something to
 * say: a set or an effort logged, the run finished, or a "Mark done" tap. A
 * workout logged on an earlier day is the act itself and is announced as it lands. */
const picked = (at, data = {}) => ({ id: 'k', kind: 'daily', date: TODAY, updatedAt: at,
  data: { name: 'k', optId: 'log-workout', done: true, out: { activity: 'run' }, ...data } })

check('picking a session for today announces nothing', () => {
  eq(completed({ entries: { k: picked('2026-09-15T08:00:00Z') } }, { entries: {} }).length, 0)
})

check('...the first thing logged on it is the one announcement, and the run ending after is not another', () => {
  const stored = { entries: { k: picked('2026-09-15T08:00:00Z') } }
  const set = picked('2026-09-15T18:00:00Z', { out: { activity: 'run', distance: 5 } })
  eq(completed({ entries: { k: set } }, stored).map(e => e.id), ['k'])
  const ended = picked('2026-09-15T18:30:00Z', { out: { activity: 'run', distance: 5, rpe: 7 }, run: { endedAt: 1 } })
  eq(completed({ entries: { k: ended } }, { entries: { k: set } }).length, 0)
})

check('...or the run finishing with nothing typed, once', () => {
  const stored = { entries: { k: picked('2026-09-15T08:00:00Z', { plan: { title: 'Legs' } }) } }
  const ended = picked('2026-09-15T19:00:00Z', { plan: { title: 'Legs' }, run: { startedAt: 1, endedAt: 2 }, doneAt: 'x' })
  eq(completed({ entries: { k: ended } }, stored).map(e => e.id), ['k'])
})

check('...or a "Mark done" tap on a session that was undone', () => {
  const undone = picked('2026-09-15T09:00:00Z', { done: false, undone: true })
  const tapped = picked('2026-09-15T10:00:00Z', { doneAt: '2026-09-15T10:00:00Z' })
  eq(completed({ entries: { k: tapped } }, { entries: { k: undone } }).map(e => e.id), ['k'])
})

check('a workout logged on an earlier day is announced as it lands, and only then', () => {
  const past = { id: 'y', kind: 'daily', date: '2026-09-14', updatedAt: '2026-09-15T08:00:00Z',
    data: { name: 'y', optId: 'log-workout', done: true, out: { activity: 'bike' } } }
  eq(completed({ entries: { y: past } }, { entries: {} }).map(e => e.id), ['y'])
  const edited = { ...past, updatedAt: '2026-09-15T09:00:00Z', data: { ...past.data, out: { activity: 'bike', rpe: 5 } } }
  eq(completed({ entries: { y: edited } }, { entries: { y: past } }).length, 0)
})

check('a day turning over does not make yesterday\'s pick look new', () => {
  // Picked yesterday with nothing on it; today it is an earlier day's entry, and
  // the stored copy is judged by the same today, so a re-send is still quiet.
  const yesterday = { ...picked('2026-09-14T08:00:00Z'), date: '2026-09-14' }
  const resent = { ...yesterday, updatedAt: '2026-09-15T07:00:00Z' }
  eq(completed({ entries: { k: resent } }, { entries: { k: yesterday } }).length, 0)
})

check('first boot, with nothing on disk, announces the write', () => {
  const payload = { entries: Object.fromEntries([logged('a', '2026-09-15T10:00:00Z')]) }
  eq(completed(payload, { entries: {} }).map(e => e.id), ['a'])
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

check('a planned session on a day that has arrived is not chased as unlogged', () => {
  const facts = unloggedFacts({
    state: stateWith([ahead('2026-09-14T20:00:00Z')]),
    strava: { activities: [{ date: TODAY, name: 'Evening Ride' }] },
    now: NOW,
  })
  eq(facts.length, 0)
  const skipped = unloggedFacts({
    state: stateWith([ahead('2026-09-15T12:00:00Z', { undone: true })]),
    strava: { activities: [{ date: TODAY, name: 'Evening Ride' }] },
    now: NOW,
  })
  eq(skipped.length, 1, 'one marked undone leaves the ride unlogged')
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
    now: NOW,
  })
  ok(!facts.some((f) => f.category === 'workout.logged'))
  ok(facts.some((f) => f.category === 'readiness.morning'))
  ok(!facts.some((f) => /^goal\./.test(f.category)), 'goal pace is back')
})

check('an empty box produces no facts rather than an error', () => {
  eq(collectScheduledFacts({ now: NOW }).length, 0)
})

console.log(failed ? `\n${failed} notify-facts test(s) FAILED\n` : '\nall notify-facts tests pass\n')
process.exit(failed ? 1 : 0)
