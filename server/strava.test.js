/* The Strava matching and snapshot logic, tested as arithmetic:
 *   node server/strava.test.js
 *
 * Same stakes as whoop.test.js: a wrong match writes somebody else's ride, or
 * the commute rather than the training ride, into the log with nothing on screen
 * to say so. And one new thing to pin — attaching FILLS the Other-training card's
 * blank fields, so what gets filled, what does not, and what detaching puts back
 * are all here.
 */

import {
  familyMatches, activityWindow, activitiesOn, snapshotOf, attachedMinutes, attachTo, detachFrom,
  attachedIds, rankForSession, weeklyTotals, weekOf, choiceForFamily,
} from './strava.js'
import { readFileSync } from 'node:fs'

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const eq = (got, want, what = '') => {
  const a = JSON.stringify(got); const b = JSON.stringify(want)
  if (a !== b) throw new Error(`${what || 'value'}: got ${a}, wanted ${b}`)
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

/* Saturday: a 20-mile gravel ride at 10:47 local, and a 3-mile dog walk at 17:00. */
const at = (hhmm, mins) => {
  const start = Date.parse(`2026-09-06T${hhmm}:00.000Z`)
  return { start: new Date(start).toISOString(), end: new Date(start + mins * 60000).toISOString(), elapsedMin: mins }
}
const ride = {
  id: 1234, name: 'Example loop', sport: 'GravelRide', family: 'ride', date: '2026-09-06', startLocal: '2026-09-06T10:47',
  ...at('14:47', 95), movingMin: 82, distanceMi: 18.3, distanceKm: 29.45, elevationFt: 512, avgMph: 13.9, maxMph: 29.5,
  avgHr: 142, maxHr: 172, avgWatts: 156, weightedAvgWatts: 171, kilojoules: 769, avgCadence: 78.4, sufferScore: 61, prCount: 2,
  gearId: 'b1234', deviceName: 'Garmin Edge 540', url: 'https://www.strava.com/activities/1234',
}
const walk = {
  id: 5678, name: 'Evening walk', sport: 'Walk', family: 'walk', date: '2026-09-06', startLocal: '2026-09-06T17:00',
  ...at('21:00', 40), movingMin: 38, distanceMi: 3.0, elevationFt: 40, avgMph: 4.7, paceMinPerMi: 12.7, paceLabel: '12:40 /mi',
}
const cache = { fetchedAt: '2026-09-06T22:00:00.000Z', activities: [ride, walk], gear: { b1234: { id: 'b1234', name: 'Test Gravel Bike', distanceMi: 1234.5 } } }

// The Other training card, as plan.json declares it.
/*
 * The *Log a workout* card, from the REAL plan.json rather than faked — the
 * family mapping is read off the catalog it carries, so a fixture would be
 * testing a vocabulary the app does not have.
 */
const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const other = plan.dailyMenu.find(m => m.id === 'log-workout')
const activityField = other.outputs.find(f => f.type === 'activity')
const climbing = { id: 'four-by-four', minutes: 96, sched: { whoopSport: 'climbing' }, outputs: [] }
const entryOf = (out, extra = {}) => ({ id: 'daily-2026-09-06', date: '2026-09-06', data: { optId: 'log-workout', name: 'Log a workout', out, ...extra } })

/* ------------------------------------------------------------------ sports */

check('a family maps onto the catalog, and climbing onto nothing', () => {
  eq(choiceForFamily(activityField, 'ride'), 'bike')
  eq(choiceForFamily(activityField, 'run'), 'run')
  eq(choiceForFamily(activityField, 'swim'), 'swim')
  eq(choiceForFamily(activityField, 'hike'), 'hike')
  // Not a special case any more: the catalog simply has no climbing entry,
  // because the climbing cards are what ask the hard-finger question.
  eq(choiceForFamily(activityField, 'climbing'), null)
  eq(choiceForFamily(activityField, 'something-new'), null, 'no opinion, not a guess')
})

check('the sport fits only once he has said what the session was', () => {
  eq(familyMatches(other, {}, ride), null, 'nothing picked yet')
  eq(familyMatches(other, { activity: 'bike' }, ride), true)
  eq(familyMatches(other, { activity: 'run' }, ride), false)
  eq(familyMatches(other, { activity: 'walk' }, walk), true)
})

check('a climbing session rejects a ride outright, via the existing whoopSport declaration', () => {
  eq(familyMatches(climbing, {}, ride), false)
  eq(familyMatches({ sched: { stravaSport: 'ride' } }, {}, ride), true)
  eq(familyMatches({ id: 'x' }, {}, ride), null, 'an undeclared session has no opinion')
})

/* ----------------------------------------------------------------- windows */

check('an activity window is start to end, falling back to elapsed minutes', () => {
  const w = activityWindow(ride)
  eq(Math.round((w[1] - w[0]) / 60000), 95)
  const noEnd = activityWindow({ start: ride.start, elapsedMin: 30 })
  eq(Math.round((noEnd[1] - noEnd[0]) / 60000), 30)
  eq(activityWindow({}), null)
})

check('activitiesOn buckets by the LOCAL date the bridge put on the record', () => {
  eq(activitiesOn(cache, '2026-09-06').map(a => a.id), [1234, 5678])
  eq(activitiesOn(cache, '2026-09-07'), [])
  eq(activitiesOn(null, '2026-09-06'), [])
})

/* ------------------------------------------------------------ the snapshot */

check('the snapshot carries every stat and the gear name from the cache', () => {
  const s = snapshotOf(ride, { gear: cache.gear })
  eq(s.minutes, 82, 'moving minutes are the headline')
  eq(s.elapsedMinutes, 95)
  eq(s.distanceMi, 18.3)
  eq(s.elevationFt, 512)
  eq(s.avgMph, 13.9)
  eq(s.avgHr, 142)
  eq(s.avgWatts, 156)
  eq(s.sufferScore, 61)
  eq(s.gear, { id: 'b1234', name: 'Test Gravel Bike', distanceMi: 1234.5 })
  eq(s.url, 'https://www.strava.com/activities/1234')
  eq(s.calories, null, 'summaries have no calories')
  eq(s.laps, undefined, 'no detail, no laps')
  eq(s.attachedAt, null, 'the caller stamps the clock')
  eq(snapshotOf(null), null)
})

check('a detail adds calories, description, laps and splits — clipped', () => {
  const detail = {
    id: 1234, calories: 812, description: 'windy', gear: { id: 'b1234', name: 'Test Gravel Bike', distanceMi: 1234.5 },
    laps: Array.from({ length: 50 }, (_, i) => ({ index: i + 1, distanceMi: 1, movingMin: 4, avgMph: 15, avgHr: 140 })),
    splitsStandard: Array.from({ length: 70 }, (_, i) => ({ index: i + 1, distanceMi: 1, movingMin: 4 })),
    bestEfforts: [{ name: '400m', elapsedSec: 60, prRank: 1 }],
  }
  const s = snapshotOf(ride, { detail })
  eq(s.calories, 812)
  eq(s.description, 'windy')
  eq(s.laps.length, 40)
  eq(s.splits.length, 60)
  eq(s.laps[0], { index: 1, distanceMi: 1, movingMin: 4, avgMph: 15, paceMinPerMi: null, avgHr: 140, maxHr: null, avgWatts: null, elevationFt: null })
  eq(s.bestEfforts, [{ name: '400m', elapsedSec: 60, prRank: 1 }])
  // A detail for a DIFFERENT activity is ignored rather than trusted.
  eq(snapshotOf(ride, { detail: { ...detail, id: 999 } }).calories, null)
})

check('attached minutes prefer moving time and fall back to elapsed', () => {
  eq(attachedMinutes({ minutes: 82, elapsedMinutes: 95 }), 82)
  eq(attachedMinutes({ minutes: null, elapsedMinutes: 95 }), 95)
  eq(attachedMinutes(null), null)
})

/* ---------------------------------------------------------- filling the card */

check('attaching fills the blank card fields, in the card\'s own units, and remembers which', () => {
  const snap = snapshotOf(ride, { gear: cache.gear })
  const out = attachTo(other, { rpe: 6 }, snap, { now: 'T' })
  eq(out.activity, 'bike')
  eq(out.duration, 82)
  eq(out.distance, 18.3)
  eq(out.speed, 13.9)
  eq(out.elevation, 512)
  eq(out.rpe, 6, 'what he typed is untouched')
  eq(out.strava.attachedAt, 'T')
  eq(out.strava.filled, { activity: 'bike', duration: 82, distance: 18.3, speed: 13.9, elevation: 512 })
})

check('a field he already filled is never overwritten', () => {
  const snap = snapshotOf(ride)
  const out = attachTo(other, { activity: 'run', distance: 19 }, snap)
  eq(out.activity, 'run')
  eq(out.distance, 19)
  eq(out.duration, 82, 'the blanks still fill')
  eq(Object.keys(out.strava.filled).sort(), ['duration', 'elevation', 'speed'])
})

check('a session that declares none of those fields gets only the snapshot', () => {
  const out = attachTo(climbing, { rpe: 7 }, snapshotOf(ride))
  eq(Object.keys(out).sort(), ['rpe', 'strava'])
  eq(out.strava.filled, undefined)
})

check('a climbing activity does not pick an Other-training choice', () => {
  const climb = { ...ride, id: 77, sport: 'RockClimbing', family: 'climbing', distanceMi: 0 }
  const out = attachTo(other, {}, snapshotOf(climb))
  eq(out.activity, undefined)
  eq(out.duration, 82, 'time is still time')
})

check('detaching clears exactly what was filled, and keeps what he typed over', () => {
  const snap = snapshotOf(ride)
  const attached = attachTo(other, { rpe: 6 }, snap)
  const edited = { ...attached, distance: 21 } // he corrected the distance
  const out = detachFrom(edited)
  eq(out.strava, undefined)
  eq(out.activity, undefined)
  eq(out.duration, undefined)
  eq(out.speed, undefined)
  eq(out.elevation, undefined)
  eq(out.distance, 21, 'his correction survives')
  eq(out.rpe, 6)
  eq(detachFrom({ a: 1 }), { a: 1 }, 'nothing attached, nothing changes')
})

/* --------------------------------------------------------------- ranking */

check('with nothing declared and two activities, the app makes no claim', () => {
  const ranked = rankForSession({ activities: [ride, walk], entry: entryOf({}), session: other, date: '2026-09-06' })
  eq(ranked.length, 2)
  eq(ranked.filter(c => c.likely).length, 0)
})

check('once he picks Bike, the ride is likely and the walk sinks', () => {
  const ranked = rankForSession({ activities: [walk, ride], entry: entryOf({ activity: 'bike' }), session: other, date: '2026-09-06' })
  eq(ranked[0].activity.id, 1234)
  eq(ranked[0].likely, true)
  eq(ranked[1].fit, false)
  eq(ranked[1].likely, false)
})

check('a timed session is matched by overlap before anything else', () => {
  const timed = entryOf({ startedAt: '2026-09-06T21:05:00.000Z', elapsedMin: 35 }, { minutes: 35 })
  const ranked = rankForSession({ activities: [ride, walk], entry: timed, session: other, date: '2026-09-06' })
  eq(ranked[0].activity.id, 5678)
  eq(ranked[0].likely, true)
  ok(ranked[0].overlapMin > 30, 'the overlap should be most of the walk')
})

check('the only unattached activity on the day is offered as likely', () => {
  const ranked = rankForSession({ activities: [ride], entry: entryOf({}), session: other, date: '2026-09-06' })
  eq(ranked[0].likely, true)
})

check('a mismatched sport is never likely, even alone', () => {
  const ranked = rankForSession({ activities: [ride], entry: entryOf({}), session: climbing, date: '2026-09-06' })
  eq(ranked[0].fit, false)
  eq(ranked[0].likely, false)
})

check('an activity already on another session is shown, marked, and not claimed', () => {
  const otherEntry = { id: 'e2', date: '2026-09-06', data: { name: 'Morning spin', out: { strava: { id: 1234 } } } }
  const ranked = rankForSession({ activities: [ride, walk], entry: entryOf({ activity: 'bike' }), session: other, date: '2026-09-06', entries: [otherEntry] })
  const r = ranked.find(c => c.activity.id === 1234)
  eq(r.attachedTo.name, 'Morning spin')
  eq(r.likely, false)
  eq(attachedIds([otherEntry]).get(1234)[0].name, 'Morning spin')
})

check('activities from another day are not candidates', () => {
  const ranked = rankForSession({ activities: [{ ...ride, date: '2026-09-05' }], entry: entryOf({}), session: other, date: '2026-09-06' })
  eq(ranked, [])
})

/* ---------------------------------------------------------------- digest */

check('weeks start on Monday, like the quotas, and totals are per family with a weighted speed', () => {
  eq(weekOf('2026-09-07'), '2026-09-07') // a Monday keys its own week
  eq(weekOf('2026-09-09'), '2026-09-07')
  eq(weekOf('2026-09-06'), '2026-08-31') // a Sunday is the LAST day of its week, not the first of the next
  // ride and walk are both on Sunday the 6th, so they close the week of the 31st.
  const totals = weeklyTotals([ride, walk, { ...ride, id: 2, date: '2026-08-26', distanceMi: 10, movingMin: 60, elevationFt: 100 }], { weeks: 4 })
  eq(totals.length, 2)
  eq(totals[0].weekOf, '2026-08-31')
  eq(totals[0].families.ride.distanceMi, 18.3)
  eq(totals[0].families.walk.count, 1)
  eq(totals[1].weekOf, '2026-08-24')
  eq(totals[1].families.ride.avgMph, 10)
})

if (failed) { console.error(`\n${failed} strava check(s) failed`); process.exit(1) }
console.log('\nall strava tests pass')
